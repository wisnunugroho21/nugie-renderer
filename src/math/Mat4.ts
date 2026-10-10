import { hypot3, hypot4 } from './hypot';
/**
 * Mat4 helpers. CONVENTIONS (documented, tested):
 *  - Column-major storage (matches WGSL mat4x4<f32>), column vectors: v' = M * v.
 *  - Right-handed world/view space, camera looks down -Z.
 *  - Clip-space depth is WebGPU's [0, 1]; STANDARD Z (near -> 0, far -> 1), not reversed.
 *  - Composition: multiply(o, a, b) = a * b (b applied first).
 */
export type M4 = Float32Array | number[];

export const Mat4 = {
  /** A new identity matrix. */
  create(): Float32Array { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  /** Overwrite `o` with the identity matrix. */
  identity(o: M4): M4 { for (let i = 0; i < 16; i++) o[i] = 0; o[0] = o[5] = o[10] = o[15] = 1; return o; },
  /** o = a. */
  copy(o: M4, a: M4): M4 { for (let i = 0; i < 16; i++) o[i] = a[i]; return o; },

  /** o = a * b. o may alias a or b. */
  multiply(o: M4, a: M4, b: M4): M4 {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
      a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      o[c * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[c * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[c * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[c * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  },

  /** out[oo..] = a[ao..] * b[bo..]; each matrix may live at an offset of a larger array. Aliasing-safe. */
  multiplyAt(out: M4, oo: number, a: M4, ao: number, b: M4, bo: number): M4 {
    const a00 = a[ao], a01 = a[ao + 1], a02 = a[ao + 2], a03 = a[ao + 3], a10 = a[ao + 4], a11 = a[ao + 5], a12 = a[ao + 6], a13 = a[ao + 7],
      a20 = a[ao + 8], a21 = a[ao + 9], a22 = a[ao + 10], a23 = a[ao + 11], a30 = a[ao + 12], a31 = a[ao + 13], a32 = a[ao + 14], a33 = a[ao + 15];
    for (let c = 0; c < 4; c++) {
      const b0 = b[bo + c * 4], b1 = b[bo + c * 4 + 1], b2 = b[bo + c * 4 + 2], b3 = b[bo + c * 4 + 3];
      out[oo + c * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[oo + c * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[oo + c * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[oo + c * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return out;
  },

  /** o = T(p) * R(q) * S(s), written at optional offset into a larger array. */
  compose(o: M4, px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number,
    sx: number, sy: number, sz: number, off = 0): M4 {
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;
    o[off] = (1 - (yy + zz)) * sx; o[off + 1] = (xy + wz) * sx; o[off + 2] = (xz - wy) * sx; o[off + 3] = 0;
    o[off + 4] = (xy - wz) * sy; o[off + 5] = (1 - (xx + zz)) * sy; o[off + 6] = (yz + wx) * sy; o[off + 7] = 0;
    o[off + 8] = (xz + wy) * sz; o[off + 9] = (yz - wx) * sz; o[off + 10] = (1 - (xx + yy)) * sz; o[off + 11] = 0;
    o[off + 12] = px; o[off + 13] = py; o[off + 14] = pz; o[off + 15] = 1;
    return o;
  },

  /** General inverse; returns null if singular. */
  invert(o: M4, a: M4): M4 | null {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
      a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10,
      b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
      b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30,
      b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },

  /** Right-handed perspective, depth range [0,1] (WebGPU), standard Z. */
  perspective(o: M4, fovY: number, aspect: number, near: number, far: number): M4 {
    const f = 1 / Math.tan(fovY / 2);
    for (let i = 0; i < 16; i++) o[i] = 0;
    o[0] = f / aspect; o[5] = f;
    o[10] = far / (near - far); o[11] = -1;
    o[14] = (far * near) / (near - far);
    return o;
  },

  /** Right-handed orthographic, depth range [0,1]. */
  ortho(o: M4, l: number, r: number, b: number, t: number, near: number, far: number): M4 {
    for (let i = 0; i < 16; i++) o[i] = 0;
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = 1 / (near - far);
    o[12] = (l + r) / (l - r); o[13] = (t + b) / (b - t); o[14] = near / (near - far); o[15] = 1;
    return o;
  },

  /** View matrix: camera at eye looking at target (-Z forward). */
  lookAt(o: M4, ex: number, ey: number, ez: number, tx: number, ty: number, tz: number,
    ux = 0, uy = 1, uz = 0): M4 {
    let zx = ex - tx, zy = ey - ty, zz = ez - tz;
    let l = hypot3(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
    l = hypot3(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
    o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
    o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
    o[12] = -(xx * ex + xy * ey + xz * ez);
    o[13] = -(yx * ex + yy * ey + yz * ez);
    o[14] = -(zx * ex + zy * ey + zz * ez);
    o[15] = 1;
    return o;
  },

  /** Transform point (w=1) by the matrix stored at `off`, with perspective divide. */
  transformPoint(o: M4, m: M4, x: number, y: number, z: number, off = 0): M4 {
    const w = m[off + 3] * x + m[off + 7] * y + m[off + 11] * z + m[off + 15] || 1;
    o[0] = (m[off] * x + m[off + 4] * y + m[off + 8] * z + m[off + 12]) / w;
    o[1] = (m[off + 1] * x + m[off + 5] * y + m[off + 9] * z + m[off + 13]) / w;
    o[2] = (m[off + 2] * x + m[off + 6] * y + m[off + 10] * z + m[off + 14]) / w;
    return o;
  },

  /**
   * Split a TRS matrix (no shear) into position (3), unit quaternion x, y, z, w (4) and scale (3); a mirroring matrix gets a negative
   * x scale. Inverse of `compose`.
   */
  decompose(m: ArrayLike<number>, pos: M4, quat: M4, scale: M4, off = 0): void {
    let sx = hypot3(m[off], m[off + 1], m[off + 2]);
    const sy = hypot3(m[off + 4], m[off + 5], m[off + 6]), sz = hypot3(m[off + 8], m[off + 9], m[off + 10]);
    const det = m[off] * (m[off + 5] * m[off + 10] - m[off + 6] * m[off + 9]) - m[off + 4] * (m[off + 1] * m[off + 10] - m[off + 2] * m[off + 9])
      + m[off + 8] * (m[off + 1] * m[off + 6] - m[off + 2] * m[off + 5]);
    if (det < 0) sx = -sx;
    pos[0] = m[off + 12]; pos[1] = m[off + 13]; pos[2] = m[off + 14];
    scale[0] = sx; scale[1] = sy; scale[2] = sz;
    const ix = sx || 1, iy = sy || 1, iz = sz || 1;
    // rotation matrix r(row, col) from the normalised columns
    const r00 = m[off] / ix, r10 = m[off + 1] / ix, r20 = m[off + 2] / ix;
    const r01 = m[off + 4] / iy, r11 = m[off + 5] / iy, r21 = m[off + 6] / iy;
    const r02 = m[off + 8] / iz, r12 = m[off + 9] / iz, r22 = m[off + 10] / iz;
    const tr = r00 + r11 + r22;
    let x: number, y: number, z: number, w: number;
    if (tr > 0) { const k = 0.5 / Math.sqrt(tr + 1); w = 0.25 / k; x = (r21 - r12) * k; y = (r02 - r20) * k; z = (r10 - r01) * k; }
    else if (r00 > r11 && r00 > r22) { const k = 2 * Math.sqrt(1 + r00 - r11 - r22); w = (r21 - r12) / k; x = 0.25 * k; y = (r01 + r10) / k; z = (r02 + r20) / k; }
    else if (r11 > r22) { const k = 2 * Math.sqrt(1 + r11 - r00 - r22); w = (r02 - r20) / k; x = (r01 + r10) / k; y = 0.25 * k; z = (r12 + r21) / k; }
    else { const k = 2 * Math.sqrt(1 + r22 - r00 - r11); w = (r10 - r01) / k; x = (r02 + r20) / k; y = (r12 + r21) / k; z = 0.25 * k; }
    const l = hypot4(x, y, z, w) || 1;
    quat[0] = x / l; quat[1] = y / l; quat[2] = z / l; quat[3] = w / l;
  },

  /** Largest axis scale of the upper 3x3 (for conservative bounding-sphere transforms). */
  maxScale(m: M4, off = 0): number {
    const sx = hypot3(m[off], m[off + 1], m[off + 2]);
    const sy = hypot3(m[off + 4], m[off + 5], m[off + 6]);
    const sz = hypot3(m[off + 8], m[off + 9], m[off + 10]);
    return Math.max(sx, sy, sz);
  },
};
