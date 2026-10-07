/**
 * Active-target compaction for GPU morphing.
 *
 * A morph state with T targets is uploaded as `activeCount` (targetIndex, weight) PAIRS - two u32 words per active
 * target (weight stored as float bits) - instead of T dense weights, so vertex-shader cost scales with the number of
 * ACTIVE targets (a facial rig with 60 targets and 3 active costs 3 iterations, not 60). The pool is read in WGSL as
 * array<u32> (never as f32: small integer indices would be denormal floats and could be flushed to zero).
 */
export const MORPH_WEIGHT_EPSILON = 1e-5;

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** float32 bit pattern of `v` as u32 (for storing weights in a u32 pool). */
export function floatBits(v: number): number { f32[0] = v; return u32[0]; }

/** u32 bit pattern -> float32. */
export function bitsToFloat(bits: number): number { u32[0] = bits; return f32[0]; }

/**
 * Write the non-negligible weights of `src[srcOffset .. +count)` into `dst` starting at `dstOffset` as
 * (index, weightBits) pairs; returns the number of active targets written.
 */
export function packActiveMorphWeights(src: ArrayLike<number>, srcOffset: number, count: number, dst: Uint32Array, dstOffset: number): number {
  let n = 0;
  for (let k = 0; k < count; k++) {
    const w = src[srcOffset + k];
    if (Math.abs(w) > MORPH_WEIGHT_EPSILON) {
      dst[dstOffset + n * 2] = k;
      dst[dstOffset + n * 2 + 1] = floatBits(w);
      n++;
    }
  }
  return n;
}
