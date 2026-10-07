import { AnimationClip } from '../AnimationClip';
import { Pose, PoseLayout } from '../Pose';
import { blendPoses } from '../PoseOps';
import { sampleChannel } from '../AnimationSampler';
import type { AnimationParams } from './AnimationParams';

/** Root bone displacement over a time step, in the root's PARENT (model) space. */
export class RootDelta {
  readonly t = new Float32Array(3);
  readonly r = new Float32Array([0, 0, 0, 1]);
  reset(): this { this.t.fill(0); this.r[0] = this.r[1] = this.r[2] = 0; this.r[3] = 1; return this; }
  copyFrom(o: RootDelta): this { this.t.set(o.t); this.r.set(o.r); return this; }
}

/** out = lerp(a, b, w) for root deltas (translation linear, rotation nlerp - exact enough for per-frame steps). */
export function blendRootDelta(out: RootDelta, a: RootDelta, b: RootDelta, w: number): void {
  for (let c = 0; c < 3; c++) out.t[c] = a.t[c] + (b.t[c] - a.t[c]) * w;
  let dot = 0; for (let c = 0; c < 4; c++) dot += a.r[c] * b.r[c];
  const sg = dot < 0 ? -1 : 1;
  let l = 0;
  for (let c = 0; c < 4; c++) { out.r[c] = a.r[c] + (b.r[c] * sg - a.r[c]) * w; l += out.r[c] * out.r[c]; }
  l = Math.sqrt(l) || 1;
  for (let c = 0; c < 4; c++) out.r[c] /= l;
}

export interface MotionContext {
  layout: PoseLayout;
  /** Rest pose: nodes a clip does not animate keep these values. */
  rest: Pose;
  params: AnimationParams;
  /** Node whose motion is extracted as root motion. */
  rootNode: number;
}

/**
 * A motion produces a pose from normalized time u in [0,1) (so differently timed clips can be synchronized
 * inside blend trees) and its root displacement between two normalized times.
 */
export abstract class Motion {
  /** Duration in seconds at speed 1 (parameter dependent for blend trees). */
  abstract duration(params: AnimationParams): number;
  /**
   * Called exactly ONCE per frame for every motion that is evaluated this frame, before sample()/rootDelta().
   * Stateful motions (motion matching) advance their own playhead here; clip motions need nothing.
   */
  update(_dt: number, _ctx: MotionContext): void {}
  abstract sample(ctx: MotionContext, u: number, out: Pose): void;
  /** Add every node index this motion may write to `out` (used to know which ECS nodes a controller drives). */
  abstract collectNodes(out: Set<number>): void;
  /** Root displacement going from normalized time u0 to u1; if `wrapped`, playback looped past the end in between. */
  abstract rootDelta(ctx: MotionContext, u0: number, u1: number, wrapped: boolean, out: RootDelta): void;
}

// Module-level scratch: rootDelta runs every frame and must not allocate.
const qa = new Float32Array(4), qb = new Float32Array(4);
const ta = new Float32Array(3), tb = new Float32Array(3);
const t0s = new Float32Array(3), r0s = new Float32Array(4), tes = new Float32Array(3), res = new Float32Array(4);
const firstQ = new Float32Array(4), secondQ = new Float32Array(4);

function sampleRoot(clip: AnimationClip, node: number, time: number, t: Float32Array, r: Float32Array, rest: Pose): void {
  t[0] = rest.t[node * 3]; t[1] = rest.t[node * 3 + 1]; t[2] = rest.t[node * 3 + 2];
  r[0] = rest.r[node * 4]; r[1] = rest.r[node * 4 + 1]; r[2] = rest.r[node * 4 + 2]; r[3] = rest.r[node * 4 + 3];
  for (const c of clip.channels) {
    if (c.node !== node) continue;
    if (c.path === 'translation') sampleChannel(c.times, c.values, 3, c.interpolation, false, time, t, 0);
    else if (c.path === 'rotation') sampleChannel(c.times, c.values, 4, c.interpolation, true, time, r, 0);
  }
}

/** out = a * conj(b) (rotation that takes b to a, expressed in the parent frame). */
function qDelta(out: Float32Array, a: Float32Array, b: Float32Array): void {
  const bx = -b[0], by = -b[1], bz = -b[2], bw = b[3];
  out[0] = a[3] * bx + a[0] * bw + a[1] * bz - a[2] * by;
  out[1] = a[3] * by - a[0] * bz + a[1] * bw + a[2] * bx;
  out[2] = a[3] * bz + a[0] * by - a[1] * bx + a[2] * bw;
  out[3] = a[3] * bw - a[0] * bx - a[1] * by - a[2] * bz;
}
function qMul(out: Float32Array, a: Float32Array, b: Float32Array): void {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  out[0] = aw * b[0] + ax * b[3] + ay * b[2] - az * b[1];
  out[1] = aw * b[1] - ax * b[2] + ay * b[3] + az * b[0];
  out[2] = aw * b[2] + ax * b[1] - ay * b[0] + az * b[3];
  out[3] = aw * b[3] - ax * b[0] - ay * b[1] - az * b[2];
}

export class ClipMotion extends Motion {
  constructor(readonly clip: AnimationClip) { super(); }

  duration(): number { return this.clip.duration; }

  collectNodes(out: Set<number>): void { for (const n of this.clip.animatedNodes) out.add(n); }

  sample(ctx: MotionContext, u: number, out: Pose): void {
    out.copyFrom(ctx.rest);
    this.clip.sample(u * this.clip.duration, out);
  }

  rootDelta(ctx: MotionContext, u0: number, u1: number, wrapped: boolean, out: RootDelta): void {
    const d = this.clip.duration, n = ctx.rootNode;
    out.reset();
    if (d <= 0 || n < 0) return;
    const t0 = t0s, r0 = r0s;
    sampleRoot(this.clip, n, u0 * d, t0, r0, ctx.rest);
    const t1 = ta, r1 = qa;
    sampleRoot(this.clip, n, u1 * d, t1, r1, ctx.rest);
    if (!wrapped) {
      for (let c = 0; c < 3; c++) out.t[c] = t1[c] - t0[c];
      qDelta(out.r, r1, r0);
    } else {
      // played past the end and looped: (end - t0) + (t1 - start)
      const ts = tb, rs = qb, te = tes, re = res;
      sampleRoot(this.clip, n, 0, ts, rs, ctx.rest);
      sampleRoot(this.clip, n, d, te, re, ctx.rest);
      for (let c = 0; c < 3; c++) out.t[c] = (te[c] - t0[c]) + (t1[c] - ts[c]);
      qDelta(firstQ, re, r0); qDelta(secondQ, r1, rs);
      qMul(out.r, secondQ, firstQ);
    }
  }
}

export interface BlendTreeEntry { motion: Motion; threshold: number; }

/**
 * 1D blend tree: blends the two entries bracketing the parameter value (clamped at the ends). Children can be
 * clips or other blend trees. Children are time-synchronized through normalized time, and the tree's duration is the
 * weighted average of its children's durations (so walk->run blends keep foot phase).
 */
export class BlendTree1D extends Motion {
  readonly entries: BlendTreeEntry[];
  private poseA: Pose;
  private poseB: Pose;
  private deltaA = new RootDelta();
  private deltaB = new RootDelta();

  constructor(layout: PoseLayout, readonly param: number, entries: BlendTreeEntry[]) {
    super();
    if (entries.length === 0) throw new Error('Blend tree needs at least one entry');
    this.entries = [...entries].sort((a, b) => a.threshold - b.threshold);
    this.poseA = new Pose(layout);
    this.poseB = new Pose(layout);
  }

  collectNodes(out: Set<number>): void { for (const e of this.entries) e.motion.collectNodes(out); }

  /** Forward the per-frame hook to every child (stateful children advance regardless of their current weight). */
  override update(dt: number, ctx: MotionContext): void { for (const e of this.entries) e.motion.update(dt, ctx); }

  /** Index of the lower bracket entry and the blend factor toward the next one. */
  select(value: number): { i: number; w: number } {
    const e = this.entries;
    if (value <= e[0].threshold) return { i: 0, w: 0 };
    const last = e.length - 1;
    if (value >= e[last].threshold) return { i: last, w: 0 };
    let i = 0;
    while (value >= e[i + 1].threshold) i++;
    return { i, w: (value - e[i].threshold) / (e[i + 1].threshold - e[i].threshold) };
  }

  duration(params: AnimationParams): number {
    const { i, w } = this.select(params.values[this.param]);
    const d0 = this.entries[i].motion.duration(params);
    if (w === 0 || i + 1 >= this.entries.length) return d0;
    return d0 + (this.entries[i + 1].motion.duration(params) - d0) * w;
  }

  sample(ctx: MotionContext, u: number, out: Pose): void {
    const { i, w } = this.select(ctx.params.values[this.param]);
    if (w === 0) { this.entries[i].motion.sample(ctx, u, out); return; }
    this.entries[i].motion.sample(ctx, u, this.poseA);
    this.entries[i + 1].motion.sample(ctx, u, this.poseB);
    blendPoses(out, this.poseA, this.poseB, w);
  }

  rootDelta(ctx: MotionContext, u0: number, u1: number, wrapped: boolean, out: RootDelta): void {
    const { i, w } = this.select(ctx.params.values[this.param]);
    if (w === 0) { this.entries[i].motion.rootDelta(ctx, u0, u1, wrapped, out); return; }
    this.entries[i].motion.rootDelta(ctx, u0, u1, wrapped, this.deltaA);
    this.entries[i + 1].motion.rootDelta(ctx, u0, u1, wrapped, this.deltaB);
    for (let c = 0; c < 3; c++) out.t[c] = this.deltaA.t[c] + (this.deltaB.t[c] - this.deltaA.t[c]) * w;
    // nlerp of the two delta rotations (small steps => accurate)
    let dot = 0; for (let c = 0; c < 4; c++) dot += this.deltaA.r[c] * this.deltaB.r[c];
    const s = dot < 0 ? -1 : 1;
    let l = 0;
    for (let c = 0; c < 4; c++) { out.r[c] = this.deltaA.r[c] + (this.deltaB.r[c] * s - this.deltaA.r[c]) * w; l += out.r[c] * out.r[c]; }
    l = Math.sqrt(l) || 1; for (let c = 0; c < 4; c++) out.r[c] /= l;
  }
}
