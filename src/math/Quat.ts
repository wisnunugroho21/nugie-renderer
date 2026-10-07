/** Quaternion helpers [x, y, z, w]. */
export type Q = Float32Array | number[];

export const Quat = {
  create(): Float32Array { return new Float32Array([0, 0, 0, 1]); },
  identity(o: Q): Q { o[0] = 0; o[1] = 0; o[2] = 0; o[3] = 1; return o; },
  copy(o: Q, a: Q): Q { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; o[3] = a[3]; return o; },
  fromAxisAngle(o: Q, x: number, y: number, z: number, rad: number): Q {
    const l = Math.hypot(x, y, z) || 1;
    const s = Math.sin(rad / 2) / l;
    o[0] = x * s; o[1] = y * s; o[2] = z * s; o[3] = Math.cos(rad / 2); return o;
  },
  /** o = a * b (b applied first). */
  multiply(o: Q, a: Q, b: Q): Q {
    const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
    o[0] = aw * bx + ax * bw + ay * bz - az * by;
    o[1] = aw * by - ax * bz + ay * bw + az * bx;
    o[2] = aw * bz + ax * by - ay * bx + az * bw;
    o[3] = aw * bw - ax * bx - ay * by - az * bz;
    return o;
  },
  normalize(o: Q, a: Q): Q {
    const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1;
    o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; o[3] = a[3] / l; return o;
  },
  conjugate(o: Q, a: Q): Q { o[0] = -a[0]; o[1] = -a[1]; o[2] = -a[2]; o[3] = a[3]; return o; },
  dot(a: Q, b: Q): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; },
  /** Rotate vector v by q into o (o may alias v). */
  rotateVec3(o: Q, q: Q, v: Q): Q {
    const x = v[0], y = v[1], z = v[2], qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    o[0] = x + qw * tx + (qy * tz - qz * ty);
    o[1] = y + qw * ty + (qz * tx - qx * tz);
    o[2] = z + qw * tz + (qx * ty - qy * tx);
    return o;
  },
  /**
   * Shortest rotation taking unit vector a onto unit vector b (inputs need not be exactly normalized).
   * Handles parallel and anti-parallel vectors (anti-parallel picks a stable perpendicular axis).
   */
  fromTo(o: Q, ax: number, ay: number, az: number, bx: number, by: number, bz: number): Q {
    let la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
    if (la < 1e-12 || lb < 1e-12) return Quat.identity(o);
    ax /= la; ay /= la; az /= la; bx /= lb; by /= lb; bz /= lb;
    const d = ax * bx + ay * by + az * bz;
    if (d > 1 - 1e-9) return Quat.identity(o);
    if (d < -1 + 1e-9) {
      // 180 degrees: rotate about an axis perpendicular to a (cross with the world axis least aligned with a)
      const fx = Math.abs(ax), fy = Math.abs(ay), fz = Math.abs(az);
      const ex = fx <= fy && fx <= fz ? 1 : 0, ey = ex === 0 && fy <= fz ? 1 : 0, ez = ex === 0 && ey === 0 ? 1 : 0;
      const px = ay * ez - az * ey, py = az * ex - ax * ez, pz = ax * ey - ay * ex;
      const pl = Math.hypot(px, py, pz);
      o[0] = px / pl; o[1] = py / pl; o[2] = pz / pl; o[3] = 0;
      return o;
    }
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const w = 1 + d;
    const l = Math.hypot(cx, cy, cz, w);
    o[0] = cx / l; o[1] = cy / l; o[2] = cz / l; o[3] = w / l;
    return o;
  },
  /** Shortest-path slerp. */
  slerp(o: Q, a: Q, b: Q, t: number): Q {
    let bx = b[0], by = b[1], bz = b[2], bw = b[3];
    let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let s0: number, s1: number;
    if (1 - cos > 1e-6) {
      const om = Math.acos(cos), so = Math.sin(om);
      s0 = Math.sin((1 - t) * om) / so; s1 = Math.sin(t * om) / so;
    } else { s0 = 1 - t; s1 = t; }
    o[0] = s0 * a[0] + s1 * bx; o[1] = s0 * a[1] + s1 * by; o[2] = s0 * a[2] + s1 * bz; o[3] = s0 * a[3] + s1 * bw;
    return o;
  },
};
