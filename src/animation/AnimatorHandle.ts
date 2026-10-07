import type { World } from '../ecs/World';
import { AnimatorFlags } from '../ecs/components/AnimatorStore';
import type { AnimatedInstance } from './Animator';

/**
 * Ergonomic facade over one entity's AnimatorStore row: play / pause / stop / loop / speed / time.
 * (State stays in the SoA store; this object holds no animation data.)
 */
export class Animator {
  /** Wrap the animator component of `entity`. */
  constructor(private world: World, readonly entity: number) {}

  /** Add an animator component to `entity` playing `clip` of `instance` and return its handle (call `play()` to start it). */
  static attach(world: World, entity: number, instance: AnimatedInstance, clip = 0): Animator {
    world.animators.add(entity, instance, clip);
    return new Animator(world, entity);
  }

  /** Shorthand for the world's animator store. */
  private get s() { return this.world.animators; }

  /** Start playing (optionally switching clip). Restarts from 0 if the previous play had finished. */
  play(clip?: number | string): this {
    const s = this.s, i = this.entity;
    if (clip !== undefined) {
      const idx = typeof clip === 'string' ? s.instance[i]!.clipIndex(clip) : clip;
      if (idx < 0 || idx >= s.instance[i]!.clips.length) throw new Error(`Unknown clip '${clip}'`);
      if (idx !== s.clip[i]) { s.clip[i] = idx; s.time[i] = 0; s.hints[i] = new Int32Array(s.instance[i]!.clips[idx].channels.length); }
    }
    if (s.flags[i] & AnimatorFlags.Finished) s.time[i] = s.speed[i] < 0 ? s.instance[i]!.clips[s.clip[i]].duration : 0;
    s.flags[i] = (s.flags[i] | AnimatorFlags.Playing) & ~AnimatorFlags.Finished;
    return this;
  }
  /** Stop advancing time but keep the current pose and position. */
  pause(): this { this.s.flags[this.entity] &= ~AnimatorFlags.Playing; return this; }
  /** Stop and rewind to the start. */
  stop(): this {
    const s = this.s, i = this.entity;
    s.flags[i] &= ~(AnimatorFlags.Playing | AnimatorFlags.Finished);
    s.time[i] = 0;
    return this;
  }
  /** Enable or disable looping. */
  setLoop(loop: boolean): this {
    const s = this.s, i = this.entity;
    s.flags[i] = loop ? s.flags[i] | AnimatorFlags.Loop : s.flags[i] & ~AnimatorFlags.Loop;
    return this;
  }
  /** Playback speed multiplier (negative plays backwards, 0 freezes). */
  setSpeed(speed: number): this { this.s.speed[this.entity] = speed; return this; }
  /** Current speed multiplier. */
  get speed(): number { return this.s.speed[this.entity]; }
  /** Current playback time in seconds. */
  get time(): number { return this.s.time[this.entity]; }
  /** Seek to `t` seconds. */
  set time(t: number) { this.s.time[this.entity] = t; }
  /** True while the animator is advancing. */
  get playing(): boolean { return (this.s.flags[this.entity] & AnimatorFlags.Playing) !== 0; }
  /** True once a non-looping clip reached its end. */
  get finished(): boolean { return (this.s.flags[this.entity] & AnimatorFlags.Finished) !== 0; }
  /** True if the clip loops. */
  get loop(): boolean { return (this.s.flags[this.entity] & AnimatorFlags.Loop) !== 0; }
  /** Length of the current clip in seconds. */
  get duration(): number { const s = this.s, i = this.entity; return s.instance[i]!.clips[s.clip[i]].duration; }
}
