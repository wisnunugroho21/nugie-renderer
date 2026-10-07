import { describe, expect, it } from 'vitest';
import { AnimationClip, AnimationChannel } from '../src/animation/AnimationClip';
import { Pose, PoseLayout } from '../src/animation/Pose';
import { MotionDatabase, type MotionClipSource } from '../src/animation/motionmatching/MotionDatabase';
import { MotionMatcher } from '../src/animation/motionmatching/MotionMatcher';
import { Inertializer } from '../src/animation/motionmatching/Inertialization';
import { MotionMatchingMotion } from '../src/animation/motionmatching/MotionMatchingMotion';
import { StateMachine } from '../src/animation/graph/StateMachine';
import { AnimationController } from '../src/animation/graph/AnimationController';
import { AnimationParams } from '../src/animation/graph/AnimationParams';
import { Xform, modelTransform } from '../src/animation/ik/IK';
import { Quat } from '../src/math/Quat';

const close = (a: number, b: number, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(eps);

// ---- synthetic rig: 0 root (on the ground), 1 left foot, 2 right foot (children of the root) ------------------------
const LAYOUT = new PoseLayout(3, undefined, [-1, 0, 0]);
function restPose(): Pose { const p = new Pose(LAYOUT); p.t.set([-0.15, 0, 0], 3); p.t.set([0.15, 0, 0], 6); return p; }

interface ClipSpec { name: string; vx?: number; vz?: number; yawRate?: number; yaw0?: number; duration?: number; stepHz?: number; moving?: boolean; footOffsetZ?: number }
/** Locomotion clip sampled at 30 fps: root translates with (vx, vz), yaws at yawRate; feet swing/lift in anti-phase. */
function makeClip(s: ClipSpec): AnimationClip {
  const fps = 30, dur = s.duration ?? 2, K = Math.round(dur * fps) + 1;
  const times = new Float32Array(K), rootT = new Float32Array(K * 3), rootR = new Float32Array(K * 4), fl = new Float32Array(K * 3), fr = new Float32Array(K * 3);
  const vx = s.vx ?? 0, vz = s.vz ?? 0, yr = s.yawRate ?? 0, y0 = s.yaw0 ?? 0, hz = s.stepHz ?? 1.5, moving = s.moving ?? (vx !== 0 || vz !== 0);
  const c0 = Math.cos(y0), s0 = Math.sin(y0);
  for (let k = 0; k < K; k++) {
    const t = k / fps; times[k] = t;
    // world root position: Ry(y0) * (v * t)
    rootT.set([c0 * vx * t + s0 * vz * t, 0, -s0 * vx * t + c0 * vz * t], k * 3);
    rootR.set(Quat.fromAxisAngle(Quat.create(), 0, 1, 0, y0 + yr * t), k * 4);
    // Physically plausible gait: during STANCE (60% of the cycle) the foot slides backward in the root frame at exactly the
    // ground speed (so it is stationary in the world); during SWING it returns forward and lifts.
    const speed = Math.hypot(vx, vz), T = 1 / hz, stride = speed * 0.6 * T;
    const gx = speed > 0 ? vx / speed : 0, gz = speed > 0 ? vz / speed : 0;
    const gait = (phase: number): [number, number] => {
      const f = ((t / T + phase) % 1 + 1) % 1;
      if (f < 0.6) return [stride / 2 - stride * (f / 0.6), 0];
      const u = (f - 0.6) / 0.4;
      return [-stride / 2 + stride * u, 0.15 * Math.sin(Math.PI * u)];
    };
    const [dl, ll] = moving ? gait(0) : [0, 0], [dr, lr] = moving ? gait(0.5) : [0, 0];
    const fz = s.footOffsetZ ?? 0;
    fl.set([-0.15 + gx * dl, ll, gz * dl + fz], k * 3);
    fr.set([0.15 + gx * dr, lr, gz * dr + fz], k * 3);
  }
  return new AnimationClip(s.name, [
    new AnimationChannel(0, 'translation', 'LINEAR', times, rootT, 3), new AnimationChannel(0, 'rotation', 'LINEAR', times, rootR, 4),
    new AnimationChannel(1, 'translation', 'LINEAR', times, fl, 3), new AnimationChannel(2, 'translation', 'LINEAR', times, fr, 3),
  ]);
}

const CLIPS: ClipSpec[] = [
  { name: 'idle' },
  { name: 'walkF', vz: 1.5 },
  { name: 'walkR', vx: 1.5, stepHz: 1.5 },
  { name: 'run', vz: 3, stepHz: 2.5 },
  { name: 'turn', vz: 0.8, yawRate: 1.2 },
];

function buildDB(specs = CLIPS, extra: Partial<Parameters<typeof MotionDatabase.build>[3]> = {}, loop = true): MotionDatabase {
  const clips: MotionClipSource[] = specs.map((s) => ({ clip: makeClip(s), loop, name: s.name }));
  return MotionDatabase.build(LAYOUT, restPose(), clips, { rootNode: 0, featureJoints: [1, 2], footJoints: [1, 2], ...extra });
}

const raw = (db: MotionDatabase, frame: number, dim: number) => db.features[frame * db.dim + dim] / db.scale[dim] + db.mean[dim];
const frameIn = (db: MotionDatabase, clip: string, t: number) => db.frameOf(CLIPS.findIndex((c) => c.name === clip), t);

describe('MotionDatabase', () => {
  const db = buildDB();

  it('samples every clip at the database rate; loops are fully selectable', () => {
    expect(db.frameCount).toBe(CLIPS.length * 60);
    expect(db.dim).toBe(db.layout.dim);
    expect(Array.from(db.valid).every((v) => v === 1)).toBe(true);
    expect(db.clipFrames[0]).toBe(60);
  });

  it('feature groups are normalized: zero mean, RMS = group weight', () => {
    const weights: Record<string, number> = { velocity: 1, angularVelocity: 0.5, trajectoryPosition: 1, trajectoryFacing: 0.7, jointPosition: 0.75, jointVelocity: 0.5, contact: 0.5 };
    for (const g of db.layout.groups) {
      let sum = 0, sq = 0, n = 0;
      for (let f = 0; f < db.frameCount; f++) for (let d = g.start; d < g.start + g.count; d++) { const v = db.features[f * db.dim + d]; sum += v; sq += v * v; n++; }
      expect(Math.abs(sum / n)).toBeLessThan(1e-3);
      expect(Math.sqrt(sq / n)).toBeCloseTo(weights[g.name], 2);
    }
  });

  it('root velocity feature (character space): walking forward at 1.5 m/s = (0, 0, 1.5); sideways = (1.5, 0, 0)', () => {
    const f = frameIn(db, 'walkF', 0.7), r = frameIn(db, 'walkR', 0.7);
    close(raw(db, f, db.layout.velocity), 0, 1e-2); close(raw(db, f, db.layout.velocity + 2), 1.5, 1e-2);
    close(raw(db, r, db.layout.velocity), 1.5, 1e-2); close(raw(db, r, db.layout.velocity + 2), 0, 1e-2);
  });

  it('future trajectory: after 0.4 s of 1.5 m/s forward motion the root is 0.6 m ahead (character space)', () => {
    const f = frameIn(db, 'walkF', 0.5), L = db.layout, i = db.trajectoryTimes.indexOf(0.4);
    close(raw(db, f, L.trajectoryPosition + i * 2), 0, 1e-2); close(raw(db, f, L.trajectoryPosition + i * 2 + 1), 0.6, 1e-2);
    close(raw(db, f, L.trajectoryFacing + i * 2), 0, 1e-2); close(raw(db, f, L.trajectoryFacing + i * 2 + 1), 1, 1e-2); // facing unchanged
  });

  it('turning: yaw rate feature and facing trajectory (sin/cos of the future yaw delta)', () => {
    const f = frameIn(db, 'turn', 0.5), L = db.layout, i = db.trajectoryTimes.indexOf(0.4);
    close(raw(db, f, L.angularVelocity), 1.2, 2e-2);
    close(raw(db, f, L.trajectoryFacing + i * 2), Math.sin(1.2 * 0.4), 2e-2);
    close(raw(db, f, L.trajectoryFacing + i * 2 + 1), Math.cos(1.2 * 0.4), 2e-2);
  });

  it('features are in the CHARACTER frame: the same motion with a different world heading gives identical features', () => {
    const a = buildDB([{ name: 'w', vz: 1.5 }]), b = buildDB([{ name: 'w', vz: 1.5, yaw0: 2.1 }]);
    for (let f = 0; f < a.frameCount; f++) for (let d = 0; d < a.dim; d++) expect(Math.abs(a.features[f * a.dim + d] - b.features[f * a.dim + d])).toBeLessThan(6e-3); // float32 noise only
  });

  it('foot contacts: both feet planted when idle, alternating while walking', () => {
    const c = db.layout.contact;
    for (let t = 0; t < 1.9; t += 0.2) { close(raw(db, frameIn(db, 'idle', t), c), 1, 1e-6); close(raw(db, frameIn(db, 'idle', t), c + 1), 1, 1e-6); }
    let both = 0, any = 0, n = 0;
    for (let k = 0; k < 60; k++) { const l = raw(db, frameIn(db, 'walkF', k / 30), c) > 0.5, r = raw(db, frameIn(db, 'walkF', k / 30), c + 1) > 0.5; if (l && r) both++; if (l || r) any++; n++; }
    expect(any).toBeGreaterThanOrEqual(n * 0.95);   // at least one foot is always planted
    expect(both).toBeGreaterThan(n * 0.05);          // double support exists (60% stance, 50% phase offset => ~20%)
    expect(both).toBeLessThan(n * 0.5);
  });

  it('non-looping clips lose their last frames (no future trajectory to match)', () => {
    const d = buildDB([{ name: 'once', vz: 1.5 }], {}, false);
    expect(d.valid[0]).toBe(1);
    expect(d.valid[d.frameCount - 1]).toBe(0);
    const firstInvalid = Array.from(d.valid).indexOf(0);
    expect(firstInvalid).toBeGreaterThan(30);
    expect(d.timeOfFrame[firstInvalid] + 0.6).toBeGreaterThan(2 - 1e-6);
  });

  it('validates footJoints', () => {
    expect(() => MotionDatabase.build(LAYOUT, restPose(), [{ clip: makeClip({ name: 'a' }), loop: true }], { rootNode: 0, featureJoints: [1], footJoints: [2] })).toThrow();
  });
});

describe('MotionMatcher', () => {
  const db = buildDB();
  const best = (vx: number, vz: number, yawRate = 0, current = -1) => {
    const m = new MotionMatcher(db);
    m.buildQuery({ vx, vz, yawRate }, current);
    const r = m.search();
    return { clip: CLIPS[db.clipOfFrame[r.frame]].name, ...r };
  };

  it('selects the clip whose motion matches the desired velocity', () => {
    expect(best(0, 0).clip).toBe('idle');
    expect(best(0, 1.5).clip).toBe('walkF');
    expect(best(1.5, 0).clip).toBe('walkR');
    expect(best(0, 3).clip).toBe('run');
    expect(best(0, 0.8, 1.2).clip).toBe('turn');
  });

  it('is exact: matches a naive scan over all frames (early-out never changes the result)', () => {
    const m = new MotionMatcher(db);
    let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let n = 0; n < 40; n++) {
      m.buildQuery({ vx: (rnd() - 0.5) * 4, vz: rnd() * 4, yawRate: (rnd() - 0.5) * 3 }, Math.floor(rnd() * db.frameCount));
      const r = m.search();
      let bf = -1, bc = Infinity;
      for (let f = 0; f < db.frameCount; f++) { if (!db.valid[f]) continue; const c = m.costOf(f); if (c < bc) { bc = c; bf = f; } }
      expect(r.frame).toBe(bf);
      expect(r.cost).toBeCloseTo(bc, 4);
    }
  });

  it('continuation bias keeps the current clip when two candidates are nearly equal', () => {
    const m = new MotionMatcher(db);
    m.buildQuery({ vx: 0, vz: 1.5, yawRate: 0 }, frameIn(db, 'walkF', 0.4));
    const cur = frameIn(db, 'walkF', 0.4);
    const r = m.search(cur, 0.5);
    expect(db.clipOfFrame[r.frame]).toBe(db.clipOfFrame[cur]);
    expect(r.frame).toBeGreaterThanOrEqual(cur);
    expect(r.frame).toBeLessThanOrEqual(cur + 6);
  });

  it('never returns an invalid frame', () => {
    const d = buildDB([{ name: 'once', vz: 1.5 }], {}, false);
    const m = new MotionMatcher(d);
    for (const v of [0, 1.5, 3]) { m.buildQuery({ vx: 0, vz: v, yawRate: 0 }, d.frameCount - 1); expect(d.valid[m.search().frame]).toBe(1); }
  });

  it('query dims for the pose come from the current frame (so the current pose is a zero-cost match for itself)', () => {
    const m = new MotionMatcher(db), f = frameIn(db, 'walkF', 0.5);
    // query: the current frame's own desired velocity/trajectory (1.5 m/s forward)
    m.buildQuery({ vx: 0, vz: 1.5, yawRate: 0 }, f);
    expect(m.costOf(f)).toBeLessThan(0.15);
  });
});

describe('Inertializer', () => {
  const mk = (x: number, yawA = 0) => { const p = new Pose(LAYOUT); p.t.set([x, 0, 0], 3); p.r.set(Quat.fromAxisAngle(Quat.create(), 0, 1, 0, yawA), 4); return p; };

  it('output equals the OLD pose at the switch instant, then decays smoothly to the new animation', () => {
    const inert = new Inertializer(LAYOUT, 0.1);
    const cur = mk(1.0, 0.5), prev = mk(1.0, 0.5), next = mk(3.0, 1.5), ahead = mk(3.0, 1.5);
    inert.capture(cur, prev, next, ahead, 1 / 60);
    const out = next.clone();
    inert.apply(out, 0);
    close(out.t[3], 1.0, 1e-5);
    const q = Quat.fromAxisAngle(Quat.create(), 0, 1, 0, 0.5);
    for (let i = 0; i < 4; i++) close(out.r[4 + i], q[i], 1e-4);
    let last = Infinity;
    for (let i = 0; i < 90; i++) { const o = next.clone(); inert.apply(o, 1 / 60); const err = Math.abs(o.t[3] - 3.0); expect(err).toBeLessThanOrEqual(last + 1e-9); last = err; }
    expect(last).toBeLessThan(5e-3);   // ~ 1.5 s = 15 half-lives
  });

  it('halves the offset after one half-life when the offset velocity is zero (critically damped spring)', () => {
    const inert = new Inertializer(LAYOUT, 0.2);
    const cur = mk(2.0), next = mk(0.0);
    inert.capture(cur, cur, next, next, 1 / 60);        // both stationary => v0 = 0
    const o = next.clone(); inert.apply(o, 0.2);
    // x(t) = x0 (1 + y t) e^{-y t}, y = 2 ln2 / halfLife  => at t = halfLife: x0 * (1 + 2ln2) / 4
    close(o.t[3], 2.0 * (1 + 2 * Math.LN2) / 4, 1e-3);
  });

  it('is velocity-continuous: the output keeps moving at the old animation\'s velocity when the new one is static', () => {
    const dt = 1 / 120, inert = new Inertializer(LAYOUT, 0.15);
    const prev = mk(0.9), cur = mk(1.0), next = mk(5.0);                  // old animation moving at +12 units/s, new one static
    inert.capture(cur, prev, next, next, dt);
    const a = next.clone(); inert.apply(a, 0);
    const b = next.clone(); inert.apply(b, dt);
    const v = (b.t[3] - a.t[3]) / dt;
    expect(v).toBeGreaterThan(8); expect(v).toBeLessThan(14);
  });

  it('rotation offsets take the shortest arc even when quaternions are in opposite hemispheres', () => {
    const inert = new Inertializer(LAYOUT, 0.1);
    const cur = mk(0, 0.2), next = mk(0, 0.1);
    const q = next.r.slice(4, 8); for (let i = 0; i < 4; i++) next.r[4 + i] = -q[i];     // same rotation, flipped sign
    inert.capture(cur, cur, next, next, 1 / 60);
    const o = next.clone(); inert.apply(o, 0);
    const want = Quat.fromAxisAngle(Quat.create(), 0, 1, 0, 0.2);
    const dot = Math.abs(o.r[4] * want[0] + o.r[5] * want[1] + o.r[6] * want[2] + o.r[7] * want[3]);
    expect(dot).toBeCloseTo(1, 4);
  });

  it('deactivates once fully decayed and does nothing when inactive', () => {
    const inert = new Inertializer(LAYOUT, 0.05);
    const o = mk(1);
    inert.apply(o, 1); expect(o.t[3]).toBe(1);           // never captured
    inert.capture(mk(2), mk(2), mk(0), mk(0), 1 / 60);
    for (let i = 0; i < 200; i++) inert.apply(mk(0), 1 / 60);
    expect(inert.active).toBe(false);
  });
});

describe('MotionMatchingMotion (an animation source for the state machine)', () => {
  function rig(opts: { halfLife?: number; searchInterval?: number } = {}) {
    const rest = restPose(), db = buildDB();
    const mm = new MotionMatchingMotion(db, LAYOUT, rest, { searchInterval: 0.05, ...opts });
    const params = new AnimationParams();
    const sm = new StateMachine(LAYOUT, rest, [{ name: 'locomotion', motion: mm }], [], 0);
    const c = new AnimationController(LAYOUT, rest, params, [{ name: 'base', stateMachine: sm }], 0);
    c.rootMotion = { mode: 'translation' };
    return { mm, c, db };
  }
  const clipName = (r: ReturnType<typeof rig>) => CLIPS[r.mm.clip].name;
  const footPos = (c: AnimationController) => { const x = new Xform(); modelTransform(LAYOUT, c.pose, 1, x); return Array.from(x.p); };

  it('switches to the clip matching the desired velocity and its root motion follows', () => {
    const r = rig();
    r.mm.desired.vz = 1.5;
    for (let i = 0; i < 60; i++) r.c.update(1 / 60);
    expect(clipName(r)).toBe('walkF');
    let z = 0;
    for (let i = 0; i < 30; i++) { r.c.update(1 / 60); z += r.c.rootDelta.t[2]; }
    close(z, 0.75, 0.03);                                    // 0.5 s at 1.5 m/s
    r.mm.desired.vz = 3;
    for (let i = 0; i < 60; i++) r.c.update(1 / 60);
    expect(clipName(r)).toBe('run');
    z = 0; for (let i = 0; i < 30; i++) { r.c.update(1 / 60); z += r.c.rootDelta.t[2]; }
    close(z, 1.5, 0.05);
    r.mm.desired.vz = 0; r.mm.desired.vx = 0;
    for (let i = 0; i < 90; i++) r.c.update(1 / 60);
    expect(clipName(r)).toBe('idle');
    expect(r.mm.switches).toBeGreaterThanOrEqual(3);
  });

  it('hides switches with inertialization: a 0.8 m foot discontinuity becomes a smooth glide instead of a one-frame jump', () => {
    // 'still' = standing, feet at z=0.  'far' = a clip whose feet are 0.8 m away from where 'still' has them.
    const specs: ClipSpec[] = [{ name: 'still' }, { name: 'far', vz: 1.5, moving: false, footOffsetZ: 0.8 }];
    const maxJump = (halfLife: number) => {
      const rest = restPose();
      const db = MotionDatabase.build(LAYOUT, rest, specs.map((c) => ({ clip: makeClip(c), loop: true })), { rootNode: 0, featureJoints: [1, 2], footJoints: [1, 2] });
      const mm = new MotionMatchingMotion(db, LAYOUT, rest, { searchInterval: 0.05, halfLife });
      const c = new AnimationController(LAYOUT, rest, new AnimationParams(), [{ name: 'b', stateMachine: new StateMachine(LAYOUT, rest, [{ name: 'mm', motion: mm }], [], 0) }], 0);
      mm.desired.vz = 0;
      for (let i = 0; i < 40; i++) c.update(1 / 60);
      expect(mm.clip).toBe(0);
      let prev = footPos(c), worst = 0;
      mm.desired.vz = 1.5;
      for (let i = 0; i < 40; i++) { c.update(1 / 60); const p = footPos(c); worst = Math.max(worst, Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])); prev = p; }
      expect(mm.clip).toBe(1);                       // it did switch
      return worst;
    };
    const hardCut = maxJump(0.0002), smooth = maxJump(0.1);
    expect(hardCut).toBeGreaterThan(0.7);            // no inertialization: the foot teleports ~0.8 m in one frame
    expect(smooth).toBeLessThan(0.25);               // inertialized: the same change is spread over many frames
    expect(smooth).toBeLessThan(hardCut * 0.4);
  });

  it('is deterministic', () => {
    const run = () => {
      const r = rig(); const trace: number[] = [];
      for (let i = 0; i < 240; i++) { r.mm.desired.vz = i < 80 ? 1.5 : i < 160 ? 3 : 0.4; r.mm.desired.yawRate = i > 200 ? 1 : 0; r.c.update(1 / 60); trace.push(r.mm.clip, r.mm.time); }
      return trace;
    };
    expect(run()).toEqual(run());
  });

  it('does not search every frame (respects the search interval)', () => {
    const r = rig({ searchInterval: 0.2 });
    for (let i = 0; i < 120; i++) r.c.update(1 / 60);       // 2 s
    expect(r.mm.searches).toBeGreaterThanOrEqual(8); expect(r.mm.searches).toBeLessThanOrEqual(12);
  });

  it('forced search + switch when a non-looping clip runs off its end', () => {
    const rest = restPose();
    const db = buildDB([{ name: 'once', vz: 1.5 }, { name: 'idle' }], {}, false);
    const mm = new MotionMatchingMotion(db, LAYOUT, rest, { searchInterval: 10 });
    const sm = new StateMachine(LAYOUT, rest, [{ name: 'mm', motion: mm }], [], 0);
    const c = new AnimationController(LAYOUT, rest, new AnimationParams(), [{ name: 'base', stateMachine: sm }], 0);
    mm.desired.vz = 0;
    for (let i = 0; i < 60 * 3; i++) c.update(1 / 60);
    expect(db.valid[mm.frame]).toBe(1);                      // never stuck on an invalid tail frame
  });
});
