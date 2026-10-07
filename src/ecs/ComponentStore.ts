import { BitSet } from '../core/BitSet';

/**
 * Base class for component stores. Data is stored in typed arrays indexed by the
 * entity INDEX (not the full generational id). `has` tracks component presence.
 */
export abstract class ComponentStore {
  readonly has = new BitSet();
  protected capacity = 0;

  /** Grow backing arrays to hold at least `n` entity indices. */
  ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    let c = Math.max(64, this.capacity);
    while (c < n) c *= 2;
    this.grow(c);
    this.capacity = c;
    this.has.ensure(c);
  }

  protected abstract grow(newCapacity: number): void;
  /** Called when the owning entity is destroyed or the component is removed. */
  protected abstract reset(index: number): void;

  remove(index: number): void {
    if (!this.has.has(index)) return;
    this.has.clear(index);
    this.reset(index);
  }
}

export function growF32(a: Float32Array, n: number, perItem = 1) {
  const o = new Float32Array(n * perItem); o.set(a); return o;
}
export function growI32(a: Int32Array, n: number, fill?: number) {
  const o = new Int32Array(n); if (fill !== undefined) o.fill(fill); o.set(a); return o;
}
export function growU8(a: Uint8Array, n: number) {
  const o = new Uint8Array(n); o.set(a); return o;
}
export function growU32(a: Uint32Array, n: number) {
  const o = new Uint32Array(n); o.set(a); return o;
}
