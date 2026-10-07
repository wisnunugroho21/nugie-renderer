/** Growable bit set backed by a Uint32Array. */
export class BitSet {
  words: Uint32Array;

  constructor(bits = 64) { this.words = new Uint32Array(Math.max(1, (bits + 31) >>> 5)); }

  ensure(bits: number): void {
    const need = (bits + 31) >>> 5;
    if (need <= this.words.length) return;
    let n = this.words.length;
    while (n < need) n *= 2;
    const w = new Uint32Array(n);
    w.set(this.words);
    this.words = w;
  }

  set(i: number): void { this.ensure(i + 1); this.words[i >>> 5] |= 1 << (i & 31); }
  clear(i: number): void { if ((i >>> 5) < this.words.length) this.words[i >>> 5] &= ~(1 << (i & 31)); }
  has(i: number): boolean { return (i >>> 5) < this.words.length && (this.words[i >>> 5] & (1 << (i & 31))) !== 0; }

  count(): number {
    let c = 0;
    for (let i = 0; i < this.words.length; i++) c += popcount(this.words[i]);
    return c;
  }

  forEach(cb: (i: number) => void): void { BitSet.forEachAnd([this], cb); }

  /** Visit every index set in ALL given sets (ascending order). */
  static forEachAnd(sets: BitSet[], cb: (i: number) => void): void {
    let n = Infinity;
    for (const s of sets) n = Math.min(n, s.words.length);
    for (let w = 0; w < n; w++) {
      let bits = sets[0].words[w];
      for (let s = 1; s < sets.length && bits !== 0; s++) bits &= sets[s].words[w];
      while (bits !== 0) {
        const low = bits & -bits;
        cb((w << 5) + (31 - Math.clz32(low)));
        bits ^= low;
      }
    }
  }
}

function popcount(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
