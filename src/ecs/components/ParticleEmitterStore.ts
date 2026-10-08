import { ComponentStore, growI32, growU8 } from '../ComponentStore';
import type { ParticlePool } from '../../particles/ParticleSystem';

/** Binds an entity's world transform to one emitter of a particle pool. */
export class ParticleEmitterStore extends ComponentStore {
  pool: (ParticlePool | undefined)[] = [];
  emitter = new Int32Array(0);
  enabled = new Uint8Array(0);

  /** Grow the emitter-id and enabled arrays. */
  protected grow(n: number): void { this.emitter = growI32(this.emitter, n, -1); this.enabled = growU8(this.enabled, n); }
  /** Disable the pool emitter (a destroyed entity stops emitting) and clear the binding. */
  protected reset(i: number): void {
    const p = this.pool[i];
    if (p && this.emitter[i] >= 0) p.emitters[this.emitter[i]].enabled = false;   // a destroyed entity stops emitting
    this.pool[i] = undefined; this.emitter[i] = -1; this.enabled[i] = 0;
  }

  /** Drive emitter `emitter` of `pool` from this entity's world transform. */
  add(i: number, pool: ParticlePool, emitter: number): void {
    this.ensureCapacity(i + 1);
    this.has.set(i);
    this.pool[i] = pool; this.emitter[i] = emitter; this.enabled[i] = 1;
  }
}
