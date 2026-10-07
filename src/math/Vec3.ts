/** Allocation-free Vec3 helpers operating on Float32Array/number[]. Right-handed. */
export type V3 = Float32Array | number[];

export const Vec3 = {
  /** A new vector initialised to (x, y, z). */
  create(x = 0, y = 0, z = 0): Float32Array { return new Float32Array([x, y, z]); },
  /** o = (x, y, z). */
  set(o: V3, x: number, y: number, z: number): V3 { o[0] = x; o[1] = y; o[2] = z; return o; },
  /** o = a. */
  copy(o: V3, a: V3): V3 { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
  /** o = a + b. */
  add(o: V3, a: V3, b: V3): V3 { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
  /** o = a - b. */
  sub(o: V3, a: V3, b: V3): V3 { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
  /** o = a * s. */
  scale(o: V3, a: V3, s: number): V3 { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
  /** Dot product. */
  dot(a: V3, b: V3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
  /** o = a x b (o may alias a or b). */
  cross(o: V3, a: V3, b: V3): V3 {
    const ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
    o[0] = ay * bz - az * by; o[1] = az * bx - ax * bz; o[2] = ax * by - ay * bx; return o;
  },
  /** Euclidean length. */
  length(a: V3): number { return Math.hypot(a[0], a[1], a[2]); },
  /** o = a with unit length (a zero vector stays zero). */
  normalize(o: V3, a: V3): V3 {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; return o;
  },
  /** o = a + (b - a) * t. */
  lerp(o: V3, a: V3, b: V3, t: number): V3 {
    o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o;
  },
  /** Distance between points a and b. */
  distance(a: V3, b: V3): number { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); },
};
