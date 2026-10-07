import type { World } from '../World';
import { BitSet } from '../../core/BitSet';

/** Copies ribbon-emitter entity positions (world matrix translation) into their ribbon heads (run after TransformSystem). */
export class RibbonEmitterSystem {
  active = 0;

  constructor(private world: World) {}

  update(): void {
    const w = this.world, s = w.ribbonEmitters, m = w.transforms.worldMatrices;
    this.active = 0;
    BitSet.forEachAnd([s.has, w.transforms.has], (i) => {
      const sys = s.system[i], r = s.ribbon[i];
      if (!sys || r < 0) return;
      const on = s.enabled[i] !== 0;
      sys.setTarget(r, m[i * 16 + 12], m[i * 16 + 13], m[i * 16 + 14], on);
      if (on) this.active++;
    });
  }
}
