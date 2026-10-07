import { describe, expect, it } from 'vitest';
import { bitsToFloat, floatBits, packActiveMorphWeights, MORPH_WEIGHT_EPSILON } from '../src/rendering/MorphPacking';

describe('morph active-target compaction', () => {
  const decode = (d: Uint32Array, n: number) => Array.from({ length: n }, (_, k) => [d[k * 2], bitsToFloat(d[k * 2 + 1])]);

  it('lists only non-zero targets, in index order, with their ORIGINAL target index', () => {
    const dst = new Uint32Array(32);
    const n = packActiveMorphWeights([0, 0.5, 0, 0, -0.25, 0, 1], 0, 7, dst, 0);
    expect(n).toBe(3);
    expect(decode(dst, 3)).toEqual([[1, 0.5], [4, -0.25], [6, 1]]);
  });

  it('negligible weights (|w| <= epsilon) are dropped, just above epsilon kept', () => {
    const dst = new Uint32Array(8);
    expect(packActiveMorphWeights([MORPH_WEIGHT_EPSILON, -MORPH_WEIGHT_EPSILON, 0], 0, 3, dst, 0)).toBe(0);
    expect(packActiveMorphWeights([MORPH_WEIGHT_EPSILON * 2], 0, 1, dst, 0)).toBe(1);
  });

  it('respects source/destination offsets and does not touch memory beyond the written pairs', () => {
    const dst = new Uint32Array(16).fill(0xdeadbeef);
    const n = packActiveMorphWeights([9, 9, 0.5, 0, 0.75], 2, 3, dst, 6);
    expect(n).toBe(2);
    expect(decode(dst.subarray(6), 2)).toEqual([[0, 0.5], [2, 0.75]]);
    expect(dst[5]).toBe(0xdeadbeef);
    expect(dst[10]).toBe(0xdeadbeef);
  });

  it('weight bit patterns round-trip exactly (including negatives and denormal-range values)', () => {
    for (const v of [0.123456789, -3.5, 1e-7, 65504, -0]) expect(bitsToFloat(floatBits(v))).toBe(Math.fround(v));
  });

  it('indices are stored as plain integers, never as floats (small ints would be denormal floats)', () => {
    const dst = new Uint32Array(4);
    packActiveMorphWeights([0, 0, 0, 1], 0, 4, dst, 0);
    expect(dst[0]).toBe(3);
  });

  it('a state with 60 targets and 3 active uploads 6 words, not 60', () => {
    const w = new Array(60).fill(0); w[3] = 0.2; w[17] = 0.9; w[59] = 0.1;
    const dst = new Uint32Array(120);
    expect(packActiveMorphWeights(w, 0, 60, dst, 0) * 2).toBe(6);
  });
});
