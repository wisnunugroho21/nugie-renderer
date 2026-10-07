import { BitSet } from '../core/BitSet';
import type { ComponentStore } from './ComponentStore';

/** Iterate entity INDICES having all of the given components (bitset intersection). */
export class Query {
  private sets: BitSet[];
  /** Build a query over the stores whose components an entity must all have. */
  constructor(...stores: ComponentStore[]) { this.sets = stores.map((s) => s.has); }

  /** Call `cb` with the index of every entity that has all the query's components. */
  forEach(cb: (index: number) => void): void { BitSet.forEachAnd(this.sets, cb); }

  /** Number of entities matching the query (walks the sets, O(capacity / 32)). */
  count(): number { let n = 0; this.forEach(() => n++); return n; }
}
