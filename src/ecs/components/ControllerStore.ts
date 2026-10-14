import { ComponentStore, growF32, growU8 } from '../ComponentStore';
import type { AnimationController } from '../../animation/graph/AnimationController';
import type { AnimatedInstance } from '../../animation/Animator';

/**
 * Attaches an AnimationController (state machines / layers / root motion / IK) to an entity - normally the model's
 * root entity. The AnimatedInstance maps pose nodes to the entities that receive the result.
 */
export class ControllerStore extends ComponentStore {
  controller: (AnimationController | undefined)[] = [];
  instance: (AnimatedInstance | undefined)[] = [];
  /** Updating can be paused without detaching. */
  enabled = new Uint8Array(0);
  /** Update only every `stride`-th frame (0 or 1 = every frame); the time skipped in between accumulates in `pending`. See AnimationLODSystem. */
  stride = new Uint8Array(0);
  pending = new Float32Array(0);

  /** Grow the `enabled` flag and cadence arrays. */
  protected grow(n: number): void {
    const e = new Uint8Array(n); e.set(this.enabled); this.enabled = e;
    this.stride = growU8(this.stride, n); this.pending = growF32(this.pending, n);
  }
  /** Drop the controller and instance references. */
  protected reset(i: number): void { this.controller[i] = undefined; this.instance[i] = undefined; this.enabled[i] = 0; this.stride[i] = 0; this.pending[i] = 0; }

  /** Attach an animation controller driving the nodes described by `instance`; enabled by default. */
  add(i: number, instance: AnimatedInstance, controller: AnimationController): void {
    this.ensureCapacity(i + 1);
    this.has.set(i);
    this.instance[i] = instance; this.controller[i] = controller; this.enabled[i] = 1;
  }
}
