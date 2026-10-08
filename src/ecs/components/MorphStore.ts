import { ComponentStore, growI32, growU8 } from '../ComponentStore';

/**
 * Runtime morph state: each morphable entity owns a contiguous range of weights in ONE shared pool
 * (`weights`), later mirrored to a single GPU MorphWeightBuffer. Changed ranges are tracked so only
 * modified weights are uploaded.
 */
export class MorphStore extends ComponentStore {
  weightOffset = new Int32Array(0);
  targetCount = new Int32Array(0);
  /** Number of targets with non-negligible weight, refreshed whenever the state is packed for the GPU. */
  activeCount = new Int32Array(0);
  /** Shared pool of weights (CPU copy). */
  weights = new Float32Array(256);
  /** Entity indices whose weights changed since the last consume (deduplicated). */
  changed: number[] = [];
  private changedFlag = new Uint8Array(0);
  private used = 0;
  private freeLists = new Map<number, number[]>(); // targetCount -> free offsets

  protected grow(n: number): void {
    this.weightOffset = growI32(this.weightOffset, n, -1);
    this.targetCount = growI32(this.targetCount, n);
    this.activeCount = growI32(this.activeCount, n);
    this.changedFlag = growU8(this.changedFlag, n);
  }

  /** Return the entity's weight range to the free list (keyed by target count) so the pool slot can be reused. */
  protected reset(i: number): void {
    const c = this.targetCount[i];
    if (c > 0) {
      const list = this.freeLists.get(c) ?? [];
      list.push(this.weightOffset[i]);
      this.freeLists.set(c, list);
    }
    this.weightOffset[i] = -1; this.targetCount[i] = 0; this.activeCount[i] = 0; this.changedFlag[i] = 0;
  }

  /** Allocate `count` weights for entity index `i`, initialised from `initial` (zeros if omitted). */
  add(i: number, count: number, initial?: ArrayLike<number>): void {
    this.ensureCapacity(i + 1);
    this.has.set(i);
    const free = this.freeLists.get(count)?.pop();
    let off: number;
    if (free !== undefined) off = free;
    else {
      off = this.used;
      this.used += count;
      if (this.used > this.weights.length) {
        let n = this.weights.length;
        while (n < this.used) n *= 2;
        const w = new Float32Array(n); w.set(this.weights); this.weights = w;
      }
    }
    this.weightOffset[i] = off; this.targetCount[i] = count;
    for (let k = 0; k < count; k++) this.weights[off + k] = initial?.[k] ?? 0;
    this.markChanged(i);
  }

  /** Queue entity `i` for re-packing / re-upload (deduplicated until the next `consumeChanged`). */
  markChanged(i: number): void {
    if (this.changedFlag[i] === 0) { this.changedFlag[i] = 1; this.changed.push(i); }
  }

  /** Copy `count` weights from src[srcOffset..] into the entity's range; marks changed only if a value differs. */
  setWeights(i: number, src: ArrayLike<number>, srcOffset = 0): void {
    const off = this.weightOffset[i], count = this.targetCount[i];
    let diff = false;
    for (let k = 0; k < count; k++) {
      const v = Math.fround(src[srcOffset + k]); // compare in float32: the pool is a Float32Array
      if (this.weights[off + k] !== v) { this.weights[off + k] = v; diff = true; }
    }
    if (diff) this.markChanged(i);
  }

  /** Clear the changed list (call after uploading). */
  consumeChanged(): void {
    for (const i of this.changed) this.changedFlag[i] = 0;
    this.changed.length = 0;
  }

  /** Total weights allocated in the pool (including freed holes). */
  get poolUsed(): number { return this.used; }
}
