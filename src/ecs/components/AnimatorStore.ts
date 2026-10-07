import { ComponentStore, growF32, growI32, growU8 } from '../ComponentStore';
import type { AnimatedInstance } from '../../animation/Animator';
import type { Pose } from '../../animation/Pose';

export const enum AnimatorFlags { Playing = 1, Loop = 2, Finished = 4 }

/** Per-entity playback state (SoA). The clips/binding live in the shared AnimatedInstance. */
export class AnimatorStore extends ComponentStore {
  clip = new Int32Array(0);
  time = new Float32Array(0);
  speed = new Float32Array(0);
  flags = new Uint8Array(0);
  instance: (AnimatedInstance | undefined)[] = [];
  /** Per-animator working pose (rest pose + currently sampled channels). */
  pose: (Pose | undefined)[] = [];
  /** Per-animator, per-channel key hints (sequential playback fast-path). */
  hints: (Int32Array | undefined)[] = [];

  /** Grow the per-entity playback arrays. */
  protected grow(n: number): void {
    this.clip = growI32(this.clip, n); this.time = growF32(this.time, n); this.speed = growF32(this.speed, n); this.flags = growU8(this.flags, n);
  }
  /** Drop the animator's instance / pose / hints and zero its playback state. */
  protected reset(i: number): void {
    this.instance[i] = undefined; this.pose[i] = undefined; this.hints[i] = undefined;
    this.clip[i] = 0; this.time[i] = 0; this.speed[i] = 0; this.flags[i] = 0;
  }

  /** Attach a single-clip animator: starts looping at speed 1 on `clip` (not yet playing until the Playing flag is set by `Animator.play`). */
  add(i: number, instance: AnimatedInstance, clip = 0): void {
    this.ensureCapacity(i + 1);
    this.has.set(i);
    this.instance[i] = instance;
    this.pose[i] = instance.rest.clone();
    this.clip[i] = clip; this.time[i] = 0; this.speed[i] = 1; this.flags[i] = AnimatorFlags.Loop;
    this.hints[i] = new Int32Array(instance.clips[clip]?.channels.length ?? 0);
  }
}
