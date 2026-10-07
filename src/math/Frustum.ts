/**
 * Frustum as 6 planes [nx,ny,nz,d] with inward-facing normals: inside <=> n·p + d >= 0.
 * Order: left, right, bottom, top, near, far. Extracted (Gribb/Hartmann) from a
 * column-major view-projection matrix with WebGPU [0,1] depth (near plane uses row2 only).
 */
export class Frustum {
  readonly planes = new Float32Array(24);

  /** Extract the six clip planes from a column-major view-projection matrix (planes are normalised, normals point inward). */
  setFromViewProjection(m: ArrayLike<number>): this {
    const p = this.planes;
    /** Store the normalised plane (row3 + s * row) at slot `idx`. */
    const plane = (idx: number, s: number, row: number) => {
      // plane = row3 + s*row_k (row_k = (m[k], m[4+k], m[8+k], m[12+k]))
      const a = m[3] + s * m[row], b = m[7] + s * m[4 + row], c = m[11] + s * m[8 + row], d = m[15] + s * m[12 + row];
      const l = Math.hypot(a, b, c) || 1;
      p[idx * 4] = a / l; p[idx * 4 + 1] = b / l; p[idx * 4 + 2] = c / l; p[idx * 4 + 3] = d / l;
    };
    plane(0, 1, 0);  // left   : w + x >= 0
    plane(1, -1, 0); // right  : w - x >= 0
    plane(2, 1, 1);  // bottom : w + y >= 0
    plane(3, -1, 1); // top    : w - y >= 0
    plane(5, -1, 2); // far    : w - z >= 0
    // near: z >= 0 (WebGPU depth range)
    const a = m[2], b = m[6], c = m[10], d = m[14];
    const l = Math.hypot(a, b, c) || 1;
    p[16] = a / l; p[17] = b / l; p[18] = c / l; p[19] = d / l;
    return this;
  }

  /** false only if the sphere is entirely outside some plane (conservative). */
  intersectsSphere(cx: number, cy: number, cz: number, radius: number): boolean {
    const p = this.planes;
    for (let i = 0; i < 24; i += 4) {
      if (p[i] * cx + p[i + 1] * cy + p[i + 2] * cz + p[i + 3] < -radius) return false;
    }
    return true;
  }

  /** false only if the AABB is entirely outside some plane (p-vertex test). */
  intersectsAABB(b: ArrayLike<number>, off = 0): boolean {
    const p = this.planes;
    for (let i = 0; i < 24; i += 4) {
      const nx = p[i], ny = p[i + 1], nz = p[i + 2];
      const x = nx >= 0 ? b[off + 3] : b[off];
      const y = ny >= 0 ? b[off + 4] : b[off + 1];
      const z = nz >= 0 ? b[off + 5] : b[off + 2];
      if (nx * x + ny * y + nz * z + p[i + 3] < 0) return false;
    }
    return true;
  }
}
