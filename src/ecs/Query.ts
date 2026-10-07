import { BitSet } from '../core/BitSet';
import type { ComponentStore } from './ComponentStore';

/** Iterate entity INDICES having all of the given components (bitset intersection). */
export class Query {
  private sets: BitSet[];
  constructor(...stores: ComponentStore[]) { this.sets = stores.map((s) => s.has); }

  forEach(cb: (index: number) => void): void { BitSet.forEachAnd(this.sets, cb); }

  count(): number { let n = 0; this.forEach(() => n++); return n; }
}
