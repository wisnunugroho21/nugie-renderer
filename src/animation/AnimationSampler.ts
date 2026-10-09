import type { InterpolationMode } from '../assets/AssetTypes';
import { hypot4 } from '../math/hypot';

/**
 * Index k of the keyframe interval containing t: times[k] <= t < times[k+1].
 * Returns -1 if t < times[0] and n-1 if t >= times[n-1]. Binary search with an optional hint
 * (sequential playback hits the hint or its neighbour in O(1)).
 */
export function findKey(times: Float32Array, t: number, hint = 0): number {
  const n = times.length;
  if (n === 0 || t < times[0]) return -1;
  if (t >= times[n - 1]) return n - 1;
  if (hint >= 0 && hint < n - 1) {
    if (times[hint] <= t && t < times[hint + 1]) return hint;
    if (hint + 1 < n - 1 && times[hint + 1] <= t && t < times[hint + 2]) return hint + 1;
  }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  return lo;
}

/** Quaternion slerp on raw arrays (shortest path), writing out[o..o+3]. */
export function slerpInto(out: Float32Array, o: number, a: Float32Array, ao: number, b: Float32Array, bo: number, t: number): void {
  let bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  let cos = a[ao] * bx + a[ao + 1] * by + a[ao + 2] * bz + a[ao + 3] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let s0: number, s1: number;
  if (1 - cos > 1e-6) { const om = Math.acos(cos), so = Math.sin(om); s0 = Math.sin((1 - t) * om) / so; s1 = Math.sin(t * om) / so; }
  else { s0 = 1 - t; s1 = t; }
  out[o] = s0 * a[ao] + s1 * bx; out[o + 1] = s0 * a[ao + 1] + s1 * by; out[o + 2] = s0 * a[ao + 2] + s1 * bz; out[o + 3] = s0 * a[ao + 3] + s1 * bw;
}

/** Normalise the quaternion stored at `out[o..o+3]` in place. */
function normalizeQuat(out: Float32Array, o: number): void {
  const l = hypot4(out[o], out[o + 1], out[o + 2], out[o + 3]) || 1;
  out[o] /= l; out[o + 1] /= l; out[o + 2] /= l; out[o + 3] /= l;
}

/**
 * Sample one channel at time `t` into out[outOffset .. +stride).
 * `values` layout per glTF: STEP/LINEAR = one element per key; CUBICSPLINE = [inTangent, value, outTangent] per key.
 * `isQuat` selects slerp (LINEAR) / normalized Hermite (CUBICSPLINE). `hint` = previous key index.
 */
export function sampleChannel(
  times: Float32Array, values: Float32Array, stride: number, interpolation: InterpolationMode, isQuat: boolean,
  t: number, out: Float32Array, outOffset: number, hint = 0,
): number {
  const n = times.length;
  if (n === 0) return -1;
  const cubic = interpolation === 'CUBICSPLINE';
  // value of key k starts at k * keyStride + keyBase (cubic-spline channels store in-tangent, value, out-tangent per key)
  const keyStride = cubic ? stride * 3 : stride, keyBase = cubic ? stride : 0;
  const k = findKey(times, t, hint);
  if (k < 0) { copyValue(values, keyBase, out, outOffset, stride); return 0; }
  if (k >= n - 1) { copyValue(values, (n - 1) * keyStride + keyBase, out, outOffset, stride); return n - 1; }

  const t0 = times[k], t1 = times[k + 1], dt = t1 - t0;
  if (interpolation === 'STEP' || dt <= 0) { copyValue(values, k * keyStride + keyBase, out, outOffset, stride); return k; }
  const s = (t - t0) / dt;

  if (!cubic) {
    const a = k * keyStride, b = a + keyStride;
    if (isQuat) slerpInto(out, outOffset, values, a, values, b, s);
    else for (let c = 0; c < stride; c++) out[outOffset + c] = values[a + c] + (values[b + c] - values[a + c]) * s;
    return k;
  }
  // Cubic Hermite (glTF spec): tangents are scaled by the interval length.
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const v0 = k * keyStride + keyBase, outTan0 = k * keyStride + 2 * stride, inTan1 = (k + 1) * keyStride, v1 = v0 + keyStride;
  for (let c = 0; c < stride; c++) {
    out[outOffset + c] = h00 * values[v0 + c] + h10 * dt * values[outTan0 + c] + h01 * values[v1 + c] + h11 * dt * values[inTan1 + c];
  }
  if (isQuat) normalizeQuat(out, outOffset);
  return k;
}

/** out[o .. o+stride) = values[from .. from+stride). */
function copyValue(values: Float32Array, from: number, out: Float32Array, o: number, stride: number): void {
  for (let c = 0; c < stride; c++) out[o + c] = values[from + c];
}
