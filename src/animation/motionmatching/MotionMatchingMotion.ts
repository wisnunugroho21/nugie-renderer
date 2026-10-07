import { Pose } from '../Pose';
import { sampleChannel } from '../AnimationSampler';
import type { AnimationParams } from '../graph/AnimationParams';
import { Motion, RootDelta, type MotionContext } from '../graph/Motion';
import { Inertializer } from './Inertialization';
import { MotionMatcher, type DesiredMotion } from './MotionMatcher';
import type { MotionDatabase } from './MotionDatabase';

export interface MotionMatchingOptions {
  /** Seconds between searches (default 0.1). */
  searchInterval?: number;
  /** A candidate must be at least this fraction cheaper than the current frame to trigger a switch (default 0.1). */
  switchMargin?: number;
  /** Cost bonus for continuing the current clip (default 0.4, in normalized-feature units). */
  continuationBias?: number;
  /** Inertialization half-life in seconds (default 0.1). */
  halfLife?: number;
  /** Minimum jump (in frames) from the current position for a switch to be considered (default 4). */
  minJumpFrames?: number;
}

// Scratch (module-level): update() runs every frame and must not allocate.
const ROOT_T = new Float32Array(3), ROOT_R = new Float32Array(4);
const A_T = new Float32Array(3), A_R = new Float32Array(4), E_T = new Float32Array(3), E_R = new Float32Array(4);
const S_T = new Float32Array(3), S_R = new Float32Array(4), FIRST = new Float32Array(4), SECOND = new Float32Array(4);

/**
 * Motion matching as an animation SOURCE: a `Motion` that can be a state of the state machine, a blend-tree child
 * or a layer. Each frame it advances a playhead through the database, periodically searches for the frame whose
 * features best match the desired motion, and on a switch hides the discontinuity with inertialization.
 * Root motion comes from the database clips' root channels (the playhead's per-frame root displacement).
 */
export class MotionMatchingMotion extends Motion {
  readonly matcher: MotionMatcher;
  /** Gameplay input; set every frame (e.g. from stick input). */
  readonly desired: DesiredMotion = { vx: 0, vz: 0, yawRate: 0 };
  /** Playhead. */
  clip = 0;
  time = 0;
  frame = 0;
  /** Diagnostics. */
  switches = 0;
  searches = 0;
  lastCost = 0;

  private opts: Required<MotionMatchingOptions>;
  private inert: Inertializer;
  private timer = 0;
  private delta = new RootDelta();
  private lastOut: Pose;
  private prevOut: Pose;
  private next: Pose;
  private nextAhead: Pose;
  private haveHistory = false;
  private lastDt = 1 / 60;

  constructor(readonly db: MotionDatabase, readonly layout: Pose['layout'], rest: Pose, opts: MotionMatchingOptions = {}) {
    super();
    this.matcher = new MotionMatcher(db);
    this.opts = { searchInterval: 0.1, switchMargin: 0.1, continuationBias: 0.4, halfLife: 0.1, minJumpFrames: 4, ...opts };
    this.inert = new Inertializer(layout, this.opts.halfLife);
    this.lastOut = rest.clone(); this.prevOut = rest.clone(); this.next = rest.clone(); this.nextAhead = rest.clone();
    // start at the first selectable frame
    this.frame = Math.max(0, Array.prototype.indexOf.call(db.valid, 1));
    this.clip = db.clipOfFrame[this.frame]; this.time = db.timeOfFrame[this.frame];
  }

  duration(_params: AnimationParams): number { return 1; } // time is driven internally, not by the state machine's u

  collectNodes(out: Set<number>): void { for (const c of this.db.clips) for (const n of c.clip.animatedNodes) out.add(n); }

  private poseAt(ctx: MotionContext, clipIndex: number, time: number, out: Pose): void {
    out.copyFrom(ctx.rest);
    const clip = this.db.clips[clipIndex].clip;
    clip.sample(Math.min(Math.max(time, 0), clip.duration), out);
  }

  private rootAt(ctx: MotionContext, clipIndex: number, time: number, t: Float32Array, r: Float32Array): void {
    const n = ctx.rootNode, clip = this.db.clips[clipIndex].clip;
    t[0] = ctx.rest.t[n * 3]; t[1] = ctx.rest.t[n * 3 + 1]; t[2] = ctx.rest.t[n * 3 + 2];
    r[0] = ctx.rest.r[n * 4]; r[1] = ctx.rest.r[n * 4 + 1]; r[2] = ctx.rest.r[n * 4 + 2]; r[3] = ctx.rest.r[n * 4 + 3];
    for (const c of clip.channels) {
      if (c.node !== n) continue;
      if (c.path === 'translation') sampleChannel(c.times, c.values, 3, c.interpolation, false, time, t, 0);
      else if (c.path === 'rotation') sampleChannel(c.times, c.values, 4, c.interpolation, true, time, r, 0);
    }
  }

  override update(dt: number, ctx: MotionContext): void {
    this.lastDt = dt;
    const db = this.db, src = db.clips[this.clip], dur = src.clip.duration;
    // --- advance the playhead (loop or clamp) and record the root displacement of this step
    const t0 = this.time;
    let t1 = t0 + dt, wrapped = false;
    if (src.loop && dur > 0) { if (t1 >= dur) { t1 -= Math.floor(t1 / dur) * dur; wrapped = true; } }
    else t1 = Math.min(t1, dur);
    this.delta.reset();
    if (ctx.rootNode >= 0) this.rootDelta0(ctx, t0, t1, wrapped);
    this.time = t1;
    this.frame = db.frameOf(this.clip, this.time);

    // --- periodic search (also when the playhead ran off the end of a non-looping clip)
    this.timer += dt;
    const atEnd = !src.loop && this.time >= dur - 1e-6;
    if (this.timer >= this.opts.searchInterval || atEnd || db.valid[this.frame] === 0) {
      this.timer = 0;
      this.searches++;
      const m = this.matcher;
      m.buildQuery(this.desired, this.frame);
      const here = m.costOf(this.frame);
      const best = m.search(this.frame, this.opts.continuationBias);
      this.lastCost = here;
      const jump = best.frame < 0 ? 0 : (db.clipOfFrame[best.frame] !== this.clip ? Infinity : Math.abs(best.frame - this.frame));
      const better = best.frame >= 0 && best.cost < here * (1 - this.opts.switchMargin);
      const forced = atEnd || db.valid[this.frame] === 0;
      if (best.frame >= 0 && (forced || (better && jump >= this.opts.minJumpFrames)) && best.frame !== this.frame) this.switchTo(ctx, best.frame, dt);
    }
  }

  /** Root displacement of the playhead step t0 -> t1 (optionally wrapped), in the root's parent space. */
  private rootDelta0(ctx: MotionContext, t0: number, t1: number, wrapped: boolean): void {
    const dur = this.db.clips[this.clip].clip.duration;
    const aT = A_T, aR = A_R;
    this.rootAt(ctx, this.clip, t0, aT, aR);
    if (!wrapped) {
      this.rootAt(ctx, this.clip, t1, ROOT_T, ROOT_R);
      for (let c = 0; c < 3; c++) this.delta.t[c] = ROOT_T[c] - aT[c];
      deltaQuat(this.delta.r, ROOT_R, aR);
    } else {
      const eT = E_T, eR = E_R, sT = S_T, sR = S_R;
      this.rootAt(ctx, this.clip, dur, eT, eR); this.rootAt(ctx, this.clip, 0, sT, sR); this.rootAt(ctx, this.clip, t1, ROOT_T, ROOT_R);
      for (let c = 0; c < 3; c++) this.delta.t[c] = (eT[c] - aT[c]) + (ROOT_T[c] - sT[c]);
      deltaQuat(FIRST, eR, aR); deltaQuat(SECOND, ROOT_R, sR);
      mulQuat(this.delta.r, SECOND, FIRST);
    }
  }

  private switchTo(ctx: MotionContext, frame: number, dt: number): void {
    const db = this.db;
    const clip = db.clipOfFrame[frame], time = db.timeOfFrame[frame];
    // poses for inertialization: what is on screen now vs the new animation (and one step ahead for its velocity)
    this.poseAt(ctx, clip, time, this.next);
    this.poseAt(ctx, clip, time + dt, this.nextAhead);
    if (this.haveHistory) this.inert.capture(this.lastOut, this.prevOut, this.next, this.nextAhead, dt);
    this.clip = clip; this.time = time; this.frame = frame; this.switches++;
  }

  sample(ctx: MotionContext, _u: number, out: Pose): void {
    this.poseAt(ctx, this.clip, this.time, out);
    this.inert.apply(out, this.lastDt);
    this.prevOut.copyFrom(this.lastOut); this.lastOut.copyFrom(out);
    this.haveHistory = true;
  }

  rootDelta(_ctx: MotionContext, _u0: number, _u1: number, _wrapped: boolean, out: RootDelta): void { out.copyFrom(this.delta); }
}

function deltaQuat(out: Float32Array, a: Float32Array, b: Float32Array): void {
  const bx = -b[0], by = -b[1], bz = -b[2], bw = b[3];
  out[0] = a[3] * bx + a[0] * bw + a[1] * bz - a[2] * by; out[1] = a[3] * by - a[0] * bz + a[1] * bw + a[2] * bx;
  out[2] = a[3] * bz + a[0] * by - a[1] * bx + a[2] * bw; out[3] = a[3] * bw - a[0] * bx - a[1] * by - a[2] * bz;
}
function mulQuat(out: Float32Array, a: Float32Array, b: Float32Array): void {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  out[0] = aw * b[0] + ax * b[3] + ay * b[2] - az * b[1]; out[1] = aw * b[1] - ax * b[2] + ay * b[3] + az * b[0];
  out[2] = aw * b[2] + ax * b[1] - ay * b[0] + az * b[3]; out[3] = aw * b[3] - ax * b[0] - ay * b[1] - az * b[2];
}
