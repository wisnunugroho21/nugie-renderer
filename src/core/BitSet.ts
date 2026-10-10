/** Growable bit set backed by a Uint32Array. */
export class BitSet {
  words: Uint32Array;

  /** Create a set able to hold at least `bits` bits (it grows on demand). */
  constructor(bits = 64) {
    validateCapacity(bits);
    this.words = new Uint32Array(Math.max(1, Math.ceil(bits / 32)));
  }

  /** Grow the backing array (doubling) so that bit index `bits - 1` is addressable. No-op when already large enough. */
  ensure(bits: number): void {
    validateCapacity(bits);
    const need = Math.ceil(bits / 32);
    if (need <= this.words.length) return;
    let n = this.words.length;
    while (n < need) n *= 2;
    const w = new Uint32Array(n);
    w.set(this.words);
    this.words = w;
  }

  /** Set bit `i` (growing the set if needed). */
  set(i: number): void {
    if (!validIndex(i)) throw new RangeError('Bit index must be an unsigned 32-bit integer');
    this.ensure(i + 1);
    this.words[i >>> 5] |= 1 << (i & 31);
  }
  /** Clear bit `i`. Out-of-range indices are ignored. */
  clear(i: number): void { if (validIndex(i) && (i >>> 5) < this.words.length) this.words[i >>> 5] &= ~(1 << (i & 31)); }
  /** True if bit `i` is set; indices beyond the current capacity read as unset. */
  has(i: number): boolean { return validIndex(i) && (i >>> 5) < this.words.length && (this.words[i >>> 5] & (1 << (i & 31))) !== 0; }

  /** Number of bits currently set. */
  count(): number {
    let c = 0;
    for (let i = 0; i < this.words.length; i++) c += popcount(this.words[i]);
    return c;
  }

  /** Visit every set bit in ascending order. */
  forEach(cb: (i: number) => void): void { BitSet.forEachAnd([this], cb); }

  /** Visit every index set in ALL given sets (ascending order). */
  static forEachAnd(sets: BitSet[], cb: (i: number) => void): void {
    if (sets.length === 0) return;
    let n = Infinity;
    for (const s of sets) n = Math.min(n, s.words.length);
    for (let w = 0; w < n; w++) {
      let bits = sets[0].words[w];
      for (let s = 1; s < sets.length && bits !== 0; s++) bits &= sets[s].words[w];
      while (bits !== 0) {
        const low = bits & -bits;
        cb(w * 32 + (31 - Math.clz32(low)));
        bits ^= low;
      }
    }
  }
}

function validIndex(i: number): boolean { return Number.isInteger(i) && i >= 0 && i < 0x100000000; }

function validateCapacity(bits: number): void {
  if (!Number.isInteger(bits) || bits < 0 || bits > 0x100000000) {
    throw new RangeError('Bit capacity must be an integer between 0 and 2^32');
  }
}

/** Number of 1 bits in a 32-bit word (SWAR bit-count). */
function popcount(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
