/** AABB stored as [minX,minY,minZ,maxX,maxY,maxZ]. */
export type Box = Float32Array | number[];

export const AABB = {
  /** An empty (inverted) box, ready for `expandPoint` / `union`. */
  create(): Float32Array { return new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]); },
  /** Write the six components into `o`. */
  set(o: Box, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box {
    o[0] = minX; o[1] = minY; o[2] = minZ; o[3] = maxX; o[4] = maxY; o[5] = maxZ; return o;
  },
  /** Grow `o` in place to contain point (x, y, z). */
  expandPoint(o: Box, x: number, y: number, z: number): Box {
    if (x < o[0]) o[0] = x;
    if (y < o[1]) o[1] = y;
    if (z < o[2]) o[2] = z;
    if (x > o[3]) o[3] = x;
    if (y > o[4]) o[4] = y;
    if (z > o[5]) o[5] = z;
    return o;
  },
  /** o = smallest box containing both `a` and `b`. */
  union(o: Box, a: Box, b: Box): Box {
    o[0] = Math.min(a[0], b[0]); o[1] = Math.min(a[1], b[1]); o[2] = Math.min(a[2], b[2]);
    o[3] = Math.max(a[3], b[3]); o[4] = Math.max(a[4], b[4]); o[5] = Math.max(a[5], b[5]);
    return o;
  },
  /** True if the two boxes overlap (touching counts). */
  intersects(a: Box, b: Box): boolean {
    return a[0] <= b[3] && a[3] >= b[0] && a[1] <= b[4] && a[4] >= b[1] && a[2] <= b[5] && a[5] >= b[2];
  },
  /** Exact AABB of an affine-transformed box (Arvo's method). */
  transform(o: Box, a: Box, m: ArrayLike<number>, off = 0): Box {
    const out = [m[off + 12], m[off + 13], m[off + 14], m[off + 12], m[off + 13], m[off + 14]];
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 3; row++) {
        const e = m[off + col * 4 + row];
        const lo = e * a[col], hi = e * a[col + 3];
        out[row] += Math.min(lo, hi);
        out[row + 3] += Math.max(lo, hi);
      }
    }
    for (let i = 0; i < 6; i++) o[i] = out[i];
    return o;
  },
};
