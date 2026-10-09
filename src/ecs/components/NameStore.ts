import { ComponentStore } from '../ComponentStore';
import { BitSet } from '../../core/BitSet';

/** Optional human-readable entity names (for `find` / debugging). Names need not be unique. */
export class NameStore extends ComponentStore {
  private names: (string | undefined)[] = [];

  protected grow(n: number): void { this.names.length = n; }
  protected reset(i: number): void { this.names[i] = undefined; }

  /** Give entity `i` a name. */
  set(i: number, name: string): void {
    this.ensureCapacity(i + 1);
    this.has.set(i);
    this.names[i] = name;
  }

  /** The entity's name, or undefined. */
  get(i: number): string | undefined { return this.has.has(i) ? this.names[i] : undefined; }

  /** First entity (lowest index) with exactly this name, or -1. */
  find(name: string): number {
    let found = -1;
    BitSet.forEachAnd([this.has], (i) => { if (found < 0 && this.names[i] === name) found = i; });
    return found;
  }

  /** All entities with this name, ascending index. */
  findAll(name: string): number[] {
    const out: number[] = [];
    BitSet.forEachAnd([this.has], (i) => { if (this.names[i] === name) out.push(i); });
    return out;
  }
}
