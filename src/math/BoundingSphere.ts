/** Bounding sphere stored as [cx,cy,cz,radius]. */
export type Sphere = Float32Array | number[];

export const BoundingSphere = {
  create(): Float32Array { return new Float32Array(4); },
  fromAABB(o: Sphere, a: ArrayLike<number>): Sphere {
    o[0] = (a[0] + a[3]) / 2; o[1] = (a[1] + a[4]) / 2; o[2] = (a[2] + a[5]) / 2;
    o[3] = Math.hypot(a[3] - a[0], a[4] - a[1], a[5] - a[2]) / 2; return o;
  },
  /** Conservative transform: center transformed, radius scaled by the max axis scale. */
  transform(o: Sphere, s: Sphere, m: ArrayLike<number>, off = 0): Sphere {
    const x = s[0], y = s[1], z = s[2];
    const sc = Math.max(
      Math.hypot(m[off], m[off + 1], m[off + 2]),
      Math.hypot(m[off + 4], m[off + 5], m[off + 6]),
      Math.hypot(m[off + 8], m[off + 9], m[off + 10]));
    o[0] = m[off] * x + m[off + 4] * y + m[off + 8] * z + m[off + 12];
    o[1] = m[off + 1] * x + m[off + 5] * y + m[off + 9] * z + m[off + 13];
    o[2] = m[off + 2] * x + m[off + 6] * y + m[off + 10] * z + m[off + 14];
    o[3] = s[3] * sc;
    return o;
  },
};
