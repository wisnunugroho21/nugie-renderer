import { ComponentStore, growI32, growU8 } from '../ComponentStore';
import type { RibbonSystem } from '../../particles/RibbonSystem';

/** Drives one trail / flat ribbon head from an entity's world position. */
export class RibbonEmitterStore extends ComponentStore {
  system: (RibbonSystem | undefined)[] = [];
  ribbon = new Int32Array(0);
  enabled = new Uint8Array(0);

  /** Grow the ribbon-id and enabled arrays. */
  protected grow(n: number): void { this.ribbon = growI32(this.ribbon, n, -1); this.enabled = growU8(this.enabled, n); }
  /** Stop extending the ribbon (a destroyed entity stops leaving a trail) and clear the binding. */
  protected reset(i: number): void {
    const s = this.system[i];
    if (s && this.ribbon[i] >= 0) s.setTarget(this.ribbon[i], 0, 0, 0, false);   // destroyed entity: stop extending its ribbon
    this.system[i] = undefined; this.ribbon[i] = -1; this.enabled[i] = 0;
  }

  /** Make the entity the head of ribbon number `ribbon` in `system`; it follows the entity's world position. */
  add(i: number, system: RibbonSystem, ribbon: number): void {
    this.ensureCapacity(i + 1);
    this.has.set(i);
    this.system[i] = system; this.ribbon[i] = ribbon; this.enabled[i] = 1;
  }
}
