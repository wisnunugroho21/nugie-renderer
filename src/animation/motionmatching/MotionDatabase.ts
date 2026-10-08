import type { AnimationClip } from '../AnimationClip';
import { Pose, PoseLayout } from '../Pose';
import { Xform, modelTransform } from '../ik/IK';

export interface MotionClipSource { clip: AnimationClip; loop: boolean; name?: string; }

export interface FeatureWeights {
  velocity?: number; angularVelocity?: number; trajectoryPosition?: number; trajectoryFacing?: number;
  jointPosition?: number; jointVelocity?: number; contact?: number;
}

export interface MotionDatabaseConfig {
  /** Root bone: its horizontal motion and yaw define the character frame (forward = +Z). */
  rootNode: number;
  /** Joints whose character-space position and velocity are matched (feet, hands, hips...). */
  featureJoints: number[];
  /** Subset of featureJoints (by joint node index) that produce foot-contact flags. */
  footJoints?: number[];
  fps?: number;
  /** Seconds into the future at which the root trajectory (position + facing) is matched. */
  trajectoryTimes?: number[];
  weights?: FeatureWeights;
  contactHeight?: number;
  contactSpeed?: number;
}

/** Offsets of each feature group inside a feature vector. */
export interface FeatureLayout {
  dim: number;
  velocity: number;          // 3 (character space)
  angularVelocity: number;   // 1 (yaw rate, rad/s)
  trajectoryPosition: number; // 2 per time (x, z)
  trajectoryFacing: number;   // 2 per time (sin, cos of yaw delta)
  jointPosition: number;     // 3 per joint
  jointVelocity: number;     // 3 per joint
  contact: number;           // 1 per foot
  groups: { start: number; count: number; name: string }[];
}

const DEFAULTS: Required<FeatureWeights> = {
  velocity: 1, angularVelocity: 0.5, trajectoryPosition: 1, trajectoryFacing: 0.7, jointPosition: 0.75, jointVelocity: 0.5, contact: 0.5,
};

/** Rotation about +Y of the root's forward (+Z) axis. */
function yawOf(r: ArrayLike<number>): number {
  // forward = r * (0,0,1) => (2(xz + wy), ., 1 - 2(x² + y²))
  const x = r[0], y = r[1], z = r[2], w = r[3];
  const fx = 2 * (x * z + w * y), fz = 1 - 2 * (x * x + y * y);
  return Math.atan2(fx, fz);
}

/**
 * Searchable pose database for motion matching. Built OFFLINE from clips by sampling at a fixed rate; every frame
 * stores a normalized, weighted feature vector expressed in the CHARACTER FRAME (root position on the ground + yaw),
 * so matching is independent of where/which way the character stands.
 */
export class MotionDatabase {
  readonly dim: number;
  readonly frameCount: number;
  readonly layout: FeatureLayout;
  /** Normalized + weighted features, frameCount x dim. */
  readonly features: Float32Array;
  /** Per-dimension raw mean and scale (weight / group std): normalized = (raw - mean) * scale. */
  readonly mean: Float32Array;
  readonly scale: Float32Array;
  readonly clipOfFrame: Uint16Array;
  readonly timeOfFrame: Float32Array;
  /** 0 = not selectable (non-looping clip end lacks the future trajectory). */
  readonly valid: Uint8Array;
  readonly clipStart: Int32Array;
  readonly clipFrames: Int32Array;
  readonly fps: number;
  readonly trajectoryTimes: number[];

  /** Private: use `MotionDatabase.build`. */
  private constructor(
    readonly clips: MotionClipSource[], readonly config: Required<Pick<MotionDatabaseConfig, 'rootNode'>> & MotionDatabaseConfig,
    layout: FeatureLayout, frameCount: number, features: Float32Array, mean: Float32Array, scale: Float32Array,
    clipOfFrame: Uint16Array, timeOfFrame: Float32Array, valid: Uint8Array, clipStart: Int32Array, clipFrames: Int32Array, fps: number, traj: number[],
  ) {
    this.layout = layout; this.dim = layout.dim; this.frameCount = frameCount; this.features = features; this.mean = mean; this.scale = scale;
    this.clipOfFrame = clipOfFrame; this.timeOfFrame = timeOfFrame; this.valid = valid; this.clipStart = clipStart; this.clipFrames = clipFrames;
    this.fps = fps; this.trajectoryTimes = traj;
  }

  /** Describe where each feature group (velocity, trajectory, joint positions / velocities, foot contacts) lives in the feature vector. */
  static makeLayout(featureJoints: number, feet: number, trajectoryTimes: number): FeatureLayout {
    let o = 0;
    /** Reserve `n` consecutive floats in the feature vector and return their start offset. */
    const take = (n: number) => { const s = o; o += n; return s; };
    const velocity = take(3), angularVelocity = take(1), trajectoryPosition = take(2 * trajectoryTimes), trajectoryFacing = take(2 * trajectoryTimes);
    const jointPosition = take(3 * featureJoints), jointVelocity = take(3 * featureJoints), contact = take(feet);
    return {
      dim: o, velocity, angularVelocity, trajectoryPosition, trajectoryFacing, jointPosition, jointVelocity, contact,
      groups: [
        { name: 'velocity', start: velocity, count: 3 }, { name: 'angularVelocity', start: angularVelocity, count: 1 },
        { name: 'trajectoryPosition', start: trajectoryPosition, count: 2 * trajectoryTimes }, { name: 'trajectoryFacing', start: trajectoryFacing, count: 2 * trajectoryTimes },
        { name: 'jointPosition', start: jointPosition, count: 3 * featureJoints }, { name: 'jointVelocity', start: jointVelocity, count: 3 * featureJoints },
        { name: 'contact', start: contact, count: feet },
      ].filter((g) => g.count > 0),
    };
  }

  /** Sample every clip at `fps`, extract a feature vector per frame (velocity, future trajectory, joint pose, contacts), normalise the features and return the searchable database. */
  static build(layout: PoseLayout, rest: Pose, clips: MotionClipSource[], cfg: MotionDatabaseConfig): MotionDatabase {
    const fps = cfg.fps ?? 30, dt = 1 / fps;
    const trajT = cfg.trajectoryTimes ?? [0.2, 0.4, 0.6];
    const J = cfg.featureJoints.length;
    const footIdx = (cfg.footJoints ?? []).map((n) => {
      const i = cfg.featureJoints.indexOf(n);
      if (i < 0) throw new Error(`footJoints must be a subset of featureJoints (node ${n})`);
      return i;
    });
    const fl = MotionDatabase.makeLayout(J, footIdx.length, trajT.length);
    const W = { ...DEFAULTS, ...cfg.weights };
    const contactH = cfg.contactHeight ?? 0.08, contactV = cfg.contactSpeed ?? 0.4;
    const maxTraj = Math.max(0, ...trajT);

    const pose = rest.clone(), x = new Xform();
    // per-clip analysis state at arbitrary time t (loops handled by the caller)
    const stateAt = (clip: AnimationClip, t: number, out: { rp: number[]; yaw: number; jp: number[] }): void => {
      pose.copyFrom(rest);
      clip.sample(Math.min(Math.max(t, 0), clip.duration), pose);
      modelTransform(layout, pose, cfg.rootNode, x);
      out.rp = [x.p[0], x.p[1], x.p[2]]; out.yaw = yawOf(x.r);
      out.jp = [];
      for (const n of cfg.featureJoints) { modelTransform(layout, pose, n, x); out.jp.push(x.p[0], x.p[1], x.p[2]); }
    };
    /** A scratch analysis state: root position, yaw and joint positions. */
    const mkState = () => ({ rp: [0, 0, 0], yaw: 0, jp: [] as number[] });
    const s0 = mkState(), s1 = mkState(), sT = mkState(), sC = mkState();

    const raws: number[][] = [];
    const clipOf: number[] = [], timeOf: number[] = [], valid: number[] = [];
    const clipStart = new Int32Array(clips.length), clipFrames = new Int32Array(clips.length);

    clips.forEach((src, ci) => {
      const clip = src.clip, K = Math.max(1, Math.floor(clip.duration * fps + 1e-6));
      // horizontal travel / yaw per loop (to extend the trajectory across the loop point)
      const a = { rp: [0, 0, 0], yaw: 0, jp: [] as number[] }, b = { rp: [0, 0, 0], yaw: 0, jp: [] as number[] };
      stateAt(clip, 0, a); stateAt(clip, clip.duration, b);
      const loopDx = b.rp[0] - a.rp[0], loopDz = b.rp[2] - a.rp[2];
      let loopDyaw = b.yaw - a.yaw; loopDyaw = Math.atan2(Math.sin(loopDyaw), Math.cos(loopDyaw));
      clipStart[ci] = raws.length; clipFrames[ci] = K;

      for (let k = 0; k < K; k++) {
        const t = k * dt;
        const raw = new Array<number>(fl.dim).fill(0);
        // central difference for velocities (wrapping around loops, clamping at ends otherwise)
        const sample = (tt: number, out: typeof s0): void => {
          let loops = 0;
          if (src.loop && clip.duration > 0) { loops = Math.floor(tt / clip.duration); tt -= loops * clip.duration; }
          stateAt(clip, tt, out);
          if (loops !== 0) { out.rp[0] += loops * loopDx; out.rp[2] += loops * loopDz; out.yaw += loops * loopDyaw; }
        };
        sample(t, sC);
        const yaw = sC.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
        /** Rotate a world-space vector into the root's yaw frame (Ry(-yaw)), so features are independent of heading. */
        const toLocal = (dx: number, dy: number, dz: number): [number, number, number] => [c * dx - s * dz, dy, s * dx + c * dz]; // Ry(-yaw)
        const tA = src.loop ? t - dt : Math.max(0, t - dt), tB = src.loop ? t + dt : Math.min(clip.duration, t + dt);
        sample(tA, s0); sample(tB, s1);
        const span = tB - tA || dt;
        const v = toLocal((s1.rp[0] - s0.rp[0]) / span, (s1.rp[1] - s0.rp[1]) / span, (s1.rp[2] - s0.rp[2]) / span);
        raw[fl.velocity] = v[0]; raw[fl.velocity + 1] = v[1]; raw[fl.velocity + 2] = v[2];
        let dyaw = s1.yaw - s0.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
        raw[fl.angularVelocity] = dyaw / span;
        // future root trajectory, relative to the current character frame
        trajT.forEach((tau, i) => {
          sample(src.loop ? t + tau : Math.min(clip.duration, t + tau), sT);
          const p = toLocal(sT.rp[0] - sC.rp[0], 0, sT.rp[2] - sC.rp[2]);
          raw[fl.trajectoryPosition + i * 2] = p[0]; raw[fl.trajectoryPosition + i * 2 + 1] = p[2];
          let dy = sT.yaw - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          raw[fl.trajectoryFacing + i * 2] = Math.sin(dy); raw[fl.trajectoryFacing + i * 2 + 1] = Math.cos(dy);
        });
        // joints in the character frame; velocities are RELATIVE to the root's own motion so a planted foot reads ~0 while walking
        for (let j = 0; j < J; j++) {
          const p = toLocal(sC.jp[j * 3] - sC.rp[0], sC.jp[j * 3 + 1], sC.jp[j * 3 + 2] - sC.rp[2]);
          raw[fl.jointPosition + j * 3] = p[0]; raw[fl.jointPosition + j * 3 + 1] = p[1]; raw[fl.jointPosition + j * 3 + 2] = p[2];
          const jv = toLocal((s1.jp[j * 3] - s0.jp[j * 3]) / span, (s1.jp[j * 3 + 1] - s0.jp[j * 3 + 1]) / span, (s1.jp[j * 3 + 2] - s0.jp[j * 3 + 2]) / span);
          raw[fl.jointVelocity + j * 3] = jv[0] - v[0]; raw[fl.jointVelocity + j * 3 + 1] = jv[1] - v[1]; raw[fl.jointVelocity + j * 3 + 2] = jv[2] - v[2];
        }
        footIdx.forEach((j, i) => {
          const h = sC.jp[j * 3 + 1];
          // planted = close to the ground AND (nearly) stationary in the WORLD (model space of the skeleton root)
          const speed = Math.hypot(s1.jp[j * 3] - s0.jp[j * 3], s1.jp[j * 3 + 2] - s0.jp[j * 3 + 2]) / span;
          raw[fl.contact + i] = h < contactH && speed < contactV ? 1 : 0;
        });
        raws.push(raw);
        clipOf.push(ci); timeOf.push(t);
        valid.push(src.loop || t + maxTraj <= clip.duration + 1e-6 ? 1 : 0);
      }
    });

    // --- normalization: per-dimension mean, per-GROUP std (so x/y/z of a group share a scale), group weight baked in
    const F = raws.length, D = fl.dim;
    const mean = new Float32Array(D), scale = new Float32Array(D);
    const groupWeight: Record<string, number> = {
      velocity: W.velocity, angularVelocity: W.angularVelocity, trajectoryPosition: W.trajectoryPosition, trajectoryFacing: W.trajectoryFacing,
      jointPosition: W.jointPosition, jointVelocity: W.jointVelocity, contact: W.contact,
    };
    let usable = 0; for (const v of valid) usable += v;
    for (let d = 0; d < D; d++) { let m = 0; for (let f = 0; f < F; f++) if (valid[f]) m += raws[f][d]; mean[d] = usable ? m / usable : 0; }
    for (const g of fl.groups) {
      let variance = 0, n = 0;
      for (let d = g.start; d < g.start + g.count; d++) for (let f = 0; f < F; f++) if (valid[f]) { const e = raws[f][d] - mean[d]; variance += e * e; n++; }
      const std = Math.max(Math.sqrt(n ? variance / n : 1), 1e-3);
      for (let d = g.start; d < g.start + g.count; d++) scale[d] = groupWeight[g.name] / std;
    }
    const features = new Float32Array(F * D);
    for (let f = 0; f < F; f++) for (let d = 0; d < D; d++) features[f * D + d] = (raws[f][d] - mean[d]) * scale[d];

    return new MotionDatabase(clips, { ...cfg, rootNode: cfg.rootNode }, fl, F, features, mean, scale, Uint16Array.from(clipOf), Float32Array.from(timeOf), Uint8Array.from(valid), clipStart, clipFrames, fps, trajT);
  }

  /** Frame index of (clip, time), clamped into the clip. */
  frameOf(clip: number, time: number): number {
    const k = Math.min(this.clipFrames[clip] - 1, Math.max(0, Math.round(time * this.fps)));
    return this.clipStart[clip] + k;
  }
}
