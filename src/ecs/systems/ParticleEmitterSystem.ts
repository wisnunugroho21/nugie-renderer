import type { World } from '../World';
import { BitSet } from '../../core/BitSet';

/** Copies emitter-entity world matrices into the particle pools (run after TransformSystem, before ParticleSystem.update). */
export class ParticleEmitterSystem {
  activeEmitters = 0;

  /** Create the system for `world`. */
  constructor(private world: World) {}

  /** Push each bound entity's world matrix and enabled flag into its particle pool emitter. */
  update(): void {
    const w = this.world, s = w.particleEmitters, m = w.transforms.worldMatrices;
    this.activeEmitters = 0;
    BitSet.forEachAnd([s.has, w.transforms.has], (i) => {
      const pool = s.pool[i], e = s.emitter[i];
      if (!pool || e < 0) return;
      pool.emitters[e].enabled = s.enabled[i] !== 0;
      pool.setEmitterTransform(e, m.subarray(i * 16, i * 16 + 16));
      if (s.enabled[i] !== 0) this.activeEmitters++;
    });
  }
}
