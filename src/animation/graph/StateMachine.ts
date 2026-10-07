import { Pose } from '../Pose';
import { blendPoses } from '../PoseOps';
import { evaluateCondition, type AnimationParams, type Condition } from './AnimationParams';
import { Motion, RootDelta, blendRootDelta, type MotionContext } from './Motion';

export interface StateDef {
  name: string;
  motion: Motion;
  /** Playback speed multiplier (default 1). */
  speed?: number;
  /** Optional float parameter that further scales the speed. */
  speedParam?: number;
  loop?: boolean;
}

export interface TransitionDef {
  /** Source state index, or -1 for "any state". */
  from: number;
  to: number;
  conditions?: Condition[];
  /** Crossfade time in seconds; 0 (default) = immediate switch (no blend). */
  duration?: number;
  /** Only allowed once the current state's normalized time reached this value (e.g. 1 = at the end). */
  exitTime?: number;
  /** Start the target state at this normalized time (default 0). */
  offset?: number;
  /** Can a new transition interrupt this one while it is blending? (default true) */
  interruptible?: boolean;
}

/** Smoothstep ease used for transition blend weights. */
const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * Deterministic animation state machine with crossfading transitions.
 *  - Transitions are tested in declaration order; the first whose conditions hold fires.
 *  - Triggers used by the firing transition are consumed.
 *  - Interrupting a blend snapshots the current blended pose and fades from the snapshot: no pose popping.
 * All working poses are preallocated; update() does not allocate.
 */
export class StateMachine {
  current: number;
  /** Normalized time [0,1] of the current state. */
  time = 0;
  transitioning = false;
  /** Destination state while transitioning. */
  to = -1;
  toTime = 0;
  elapsed = 0;
  duration = 0;
  /** Number of completed transitions (diagnostics/tests). */
  transitionsCompleted = 0;

  /** Did the current / destination state loop past its end during the previous update? (exitTime = 1 on looping states) */
  private wrapCur = false;
  private wrapTo = false;
  private fromSnapshot = false;
  private nonInterruptible = false;
  private fromPose: Pose;
  private toPose: Pose;
  private snapshot: Pose;
  private last: Pose;
  private dCur = new RootDelta();
  private dTo = new RootDelta();
  private dZero = new RootDelta();

  /** Create a state machine over `states` and `transitions` starting in state `entry`. */
  constructor(layout: Pose['layout'], rest: Pose, readonly states: StateDef[], readonly transitions: TransitionDef[], entry = 0) {
    if (states.length === 0) throw new Error('State machine needs at least one state');
    this.current = entry;
    this.fromPose = new Pose(layout); this.toPose = new Pose(layout);
    this.snapshot = new Pose(layout); this.last = rest.clone();
  }

  /** Name of the active state (the target state while a transition is running). */
  get currentName(): string { return this.states[this.transitioning ? this.to : this.current].name; }

  /** Playback speed of a state: its base speed times an optional parameter multiplier. */
  private speedOf(s: StateDef, params: AnimationParams): number {
    let v = s.speed ?? 1;
    if (s.speedParam !== undefined) v *= params.values[s.speedParam];
    return v;
  }

  /** Find the first transition whose source, exit time and conditions match and start it (consuming any trigger conditions). */
  private evaluateTransitions(params: AnimationParams): void {
    if (this.transitioning && this.nonInterruptible) return;
    const src = this.transitioning ? this.to : this.current;
    const u = this.transitioning ? this.toTime : this.time;
    const wrapped = this.transitioning ? this.wrapTo : this.wrapCur;
    for (let i = 0; i < this.transitions.length; i++) {
      const t = this.transitions[i];
      if (t.from !== -1 && t.from !== src) continue;
      if (t.from === -1 && t.to === src) continue;
      if (t.exitTime !== undefined && u < t.exitTime && !wrapped) continue;
      const conds = t.conditions;
      let ok = true;
      if (conds) for (let c = 0; c < conds.length; c++) if (!evaluateCondition(conds[c], params)) { ok = false; break; }
      if (!ok) continue;
      if (conds) for (let c = 0; c < conds.length; c++) if (conds[c].op === 'trigger') params.values[conds[c].param] = 0; // consume
      this.start(t);
      return;
    }
  }

  /** Begin transition `t`: switch immediately when it has no duration, otherwise start a cross-fade (an interrupted fade blends from a snapshot of what was on screen). */
  private start(t: TransitionDef): void {
    const dur = t.duration ?? 0;
    if (dur <= 0) {
      this.current = t.to; this.time = t.offset ?? 0; this.wrapCur = false;
      this.transitioning = false; this.nonInterruptible = false; this.fromSnapshot = false;
      this.transitionsCompleted++;
      return;
    }
    if (this.transitioning) { this.snapshot.copyFrom(this.last); this.fromSnapshot = true; } // interrupt: fade from what is on screen
    else this.fromSnapshot = false;
    this.transitioning = true; this.to = t.to; this.toTime = t.offset ?? 0; this.wrapTo = false;
    this.elapsed = 0; this.duration = dur; this.nonInterruptible = t.interruptible === false;
  }

  /** Advance normalized time; returns whether the step wrapped (looped or passed through the end). */
  private advance(state: StateDef, u: number, dt: number, params: AnimationParams, ctx: MotionContext, delta: RootDelta, tmp: { u: number; wrapped: boolean }): void {
    const dur = Math.max(state.motion.duration(params), 1e-6);
    const adv = (dt * this.speedOf(state, params)) / dur;
    let u1 = u + adv, wrapped = false;
    if (state.loop ?? true) {
      if (u1 >= 1 || u1 < 0) { wrapped = true; u1 -= Math.floor(u1); }
    } else u1 = Math.min(1, Math.max(0, u1));
    if (adv >= 0) state.motion.rootDelta(ctx, u, u1, wrapped, delta);
    else { // playing backwards: the displacement is the inverse of the forward step u1 -> u
      state.motion.rootDelta(ctx, u1, u, wrapped, delta);
      delta.t[0] = -delta.t[0]; delta.t[1] = -delta.t[1]; delta.t[2] = -delta.t[2];
      delta.r[0] = -delta.r[0]; delta.r[1] = -delta.r[1]; delta.r[2] = -delta.r[2];
    }
    tmp.u = u1; tmp.wrapped = wrapped;
  }

  private tmp = { u: 0, wrapped: false };

  /** Evaluate transitions, advance the active state(s), blend the pose and root delta during a cross-fade, and write the result to `out` / `rootOut`. */
  update(dt: number, ctx: MotionContext, out: Pose, rootOut: RootDelta): void {
    rootOut.reset();
    const params = ctx.params;
    this.evaluateTransitions(params);

    const cur = this.states[this.current];
    // once-per-frame hook for stateful motions (motion matching) of the states evaluated this frame
    if (!this.transitioning || !this.fromSnapshot) cur.motion.update(dt, ctx);
    if (this.transitioning) this.states[this.to].motion.update(dt, ctx);
    if (!this.transitioning) {
      this.advance(cur, this.time, dt, params, ctx, this.dCur, this.tmp); this.time = this.tmp.u; this.wrapCur = this.tmp.wrapped;
      cur.motion.sample(ctx, this.time, out);
      rootOut.copyFrom(this.dCur);
    } else {
      if (!this.fromSnapshot) { this.advance(cur, this.time, dt, params, ctx, this.dCur, this.tmp); this.time = this.tmp.u; }
      const dst = this.states[this.to];
      this.advance(dst, this.toTime, dt, params, ctx, this.dTo, this.tmp); this.toTime = this.tmp.u; this.wrapTo = this.tmp.wrapped;
      this.elapsed += dt;
      const alpha = Math.min(1, this.elapsed / this.duration), w = smooth(alpha);

      if (this.fromSnapshot) this.fromPose.copyFrom(this.snapshot); else cur.motion.sample(ctx, this.time, this.fromPose);
      dst.motion.sample(ctx, this.toTime, this.toPose);
      blendPoses(out, this.fromPose, this.toPose, w);
      blendRootDelta(rootOut, this.fromSnapshot ? this.dZero : this.dCur, this.dTo, w);

      if (alpha >= 1) {
        this.current = this.to; this.time = this.toTime; this.wrapCur = this.wrapTo;
        this.transitioning = false; this.fromSnapshot = false; this.nonInterruptible = false;
        this.transitionsCompleted++;
      }
    }
    this.last.copyFrom(out);
  }
}
