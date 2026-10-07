import type { World } from '../ecs/World';
import { AnimatorFlags } from '../ecs/components/AnimatorStore';
import type { AnimatedInstance } from './Animator';

/**
 * Ergonomic facade over one entity's AnimatorStore row: play / pause / stop / loop / speed / time.
 * (State stays in the SoA store; this object holds no animation data.)
 */
export class Animator {
  constructor(private world: World, readonly entity: number) {}

  static attach(world: World, entity: number, instance: AnimatedInstance, clip = 0): Animator {
    world.animators.add(entity, instance, clip);
    return new Animator(world, entity);
  }

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
  pause(): this { this.s.flags[this.entity] &= ~AnimatorFlags.Playing; return this; }
  /** Stop and rewind to the start. */
  stop(): this {
    const s = this.s, i = this.entity;
    s.flags[i] &= ~(AnimatorFlags.Playing | AnimatorFlags.Finished);
    s.time[i] = 0;
    return this;
  }
  setLoop(loop: boolean): this {
    const s = this.s, i = this.entity;
    s.flags[i] = loop ? s.flags[i] | AnimatorFlags.Loop : s.flags[i] & ~AnimatorFlags.Loop;
    return this;
  }
  setSpeed(speed: number): this { this.s.speed[this.entity] = speed; return this; }
  get speed(): number { return this.s.speed[this.entity]; }
  get time(): number { return this.s.time[this.entity]; }
  set time(t: number) { this.s.time[this.entity] = t; }
  get playing(): boolean { return (this.s.flags[this.entity] & AnimatorFlags.Playing) !== 0; }
  get finished(): boolean { return (this.s.flags[this.entity] & AnimatorFlags.Finished) !== 0; }
  get loop(): boolean { return (this.s.flags[this.entity] & AnimatorFlags.Loop) !== 0; }
  get duration(): number { const s = this.s, i = this.entity; return s.instance[i]!.clips[s.clip[i]].duration; }
}
