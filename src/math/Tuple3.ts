/**
 * Small allocating vector helpers on `[x, y, z]` tuples, for geometry builders and debug drawing where readability beats allocation
 * count. Per-frame code should use the allocation-free `Vec3` instead.
 */
export type Tuple3 = [number, number, number];
type In3 = ArrayLike<number>;

export const sub = (a: In3, b: In3): Tuple3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: In3, b: In3): Tuple3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: In3, s: number): Tuple3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: In3, b: In3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: In3, b: In3): Tuple3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: In3): number => Math.hypot(a[0], a[1], a[2]);
/** `a` scaled to unit length; `fallback` when it is (nearly) zero. */
export const norm = (a: In3, fallback: Tuple3 = [0, 1, 0]): Tuple3 => { const l = len(a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : fallback; };

/** Two unit vectors that, with the unit vector `n`, form an orthonormal basis (right-handed: u x v = n). */
export function basisFromNormal(n: In3): [Tuple3, Tuple3] {
  const u = norm(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  return [u, cross(n, u)];
}
