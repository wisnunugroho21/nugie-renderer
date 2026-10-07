/**
 * Stable LSD radix sort over 64-bit keys given as (hi, lo) u32 pairs. Returns a permutation
 * (indices 0..count-1 in sorted order). Digits whose histogram has a single bucket are skipped,
 * so sorts with few distinct key components are cheap. Small inputs use a comparator sort.
 */
export class RadixSorter {
  private a = new Uint32Array(0);
  private b = new Uint32Array(0);
  private hist = new Uint32Array(256 * 8);

  /** Return object indices 0..count-1 ordered by the 64-bit key (hi, lo): LSD radix sort, or a comparison sort for small counts. The result is only valid until the next call. */
  sort(count: number, hi: Uint32Array, lo: Uint32Array): Uint32Array {
    if (this.a.length < count) {
      const n = Math.max(count, this.a.length * 2, 1024);
      this.a = new Uint32Array(n); this.b = new Uint32Array(n);
    }
    let src = this.a, dst = this.b;
    for (let i = 0; i < count; i++) src[i] = i;

    if (count < 128) {
      const view = src.subarray(0, count);
      view.sort((x, y) => (hi[x] - hi[y]) || (lo[x] - lo[y]) || (x - y));
      return view;
    }

    const h = this.hist;
    h.fill(0);
    for (let i = 0; i < count; i++) {
      const l = lo[i], k = hi[i];
      h[l & 255]++; h[256 + ((l >>> 8) & 255)]++; h[512 + ((l >>> 16) & 255)]++; h[768 + (l >>> 24)]++;
      h[1024 + (k & 255)]++; h[1280 + ((k >>> 8) & 255)]++; h[1536 + ((k >>> 16) & 255)]++; h[1792 + (k >>> 24)]++;
    }
    for (let pass = 0; pass < 8; pass++) {
      const base = pass * 256;
      const arr = pass < 4 ? lo : hi;
      const shift = (pass & 3) * 8;
      // Skip passes where every key has the same digit.
      let trivial = false;
      for (let d = 0; d < 256; d++) { const c = h[base + d]; if (c !== 0) { trivial = c === count; break; } }
      if (trivial) continue;
      // exclusive prefix sum
      let sum = 0;
      for (let d = 0; d < 256; d++) { const c = h[base + d]; h[base + d] = sum; sum += c; }
      for (let i = 0; i < count; i++) {
        const idx = src[i];
        const digit = (arr[idx] >>> shift) & 255;
        dst[h[base + digit]++] = idx;
      }
      const t = src; src = dst; dst = t;
    }
    return src.subarray(0, count);
  }
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** Monotonic u32 for non-negative floats (larger float => larger key). */
export function floatKey(v: number): number {
  f32[0] = v < 0 ? 0 : v;
  return u32[0];
}
