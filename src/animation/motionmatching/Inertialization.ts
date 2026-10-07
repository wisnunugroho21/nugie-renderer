import { Pose, type PoseLayout } from '../Pose';

/** Rotation vector (axis * angle) of the shortest rotation represented by unit quaternion q. */
function logQuat(out: Float32Array, o: number, qx: number, qy: number, qz: number, qw: number): void {
  if (qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
  const s = Math.hypot(qx, qy, qz);
  if (s < 1e-8) { out[o] = qx * 2; out[o + 1] = qy * 2; out[o + 2] = qz * 2; return; }
  const k = (2 * Math.atan2(s, qw)) / s;
  out[o] = qx * k; out[o + 1] = qy * k; out[o + 2] = qz * k;
}

/** Quaternion from rotation vector, written into out[o..o+3]. */
function expQuat(out: Float32Array, o: number, rx: number, ry: number, rz: number): void {
  const angle = Math.hypot(rx, ry, rz);
  if (angle < 1e-8) { out[o] = rx * 0.5; out[o + 1] = ry * 0.5; out[o + 2] = rz * 0.5; out[o + 3] = 1; return; }
  const s = Math.sin(angle / 2) / angle;
  out[o] = rx * s; out[o + 1] = ry * s; out[o + 2] = rz * s; out[o + 3] = Math.cos(angle / 2);
}

const dq = new Float32Array(4);

/**
 * Inertialization: instead of cross-fading two animations (which needs both evaluated and averages their motion),
 * switch to the new animation IMMEDIATELY and let the pose/velocity offset to the old one decay with a critically
 * damped spring:   x(t) = (x0 + (v0 + y x0) t) e^{-y t},   y = 2 ln2 / halfLife.
 * Translation offsets live in 3-space, rotation offsets are rotation vectors (log of the delta quaternion).
 * Zero extra pose evaluations after the switch, continuous position AND velocity at the switch.
 */
export class Inertializer {
  readonly halfLife: number;
  private y: number;
  private t = 0;
  active = false;
  private x0t: Float32Array; private v0t: Float32Array; private x0r: Float32Array; private v0r: Float32Array;
  private vel = new Float32Array(3);

  /** Create an inertializer for `layout`; `halfLife` (seconds) sets how fast a switch offset decays. */
  constructor(private layout: PoseLayout, halfLife = 0.1) {
    this.halfLife = halfLife; this.y = (2 * Math.LN2) / Math.max(halfLife, 1e-4);
    const n = layout.nodeCount;
    this.x0t = new Float32Array(n * 3); this.v0t = new Float32Array(n * 3); this.x0r = new Float32Array(n * 3); this.v0r = new Float32Array(n * 3);
  }

  /**
   * Record the discontinuity at a switch.
   *  cur/curPrev   : the pose that was on screen and the previous frame's (dt apart) -> its velocity
   *  next/nextAhead: the new animation's pose and the pose `dt` later -> its velocity
   */
  capture(cur: Pose, curPrev: Pose, next: Pose, nextAhead: Pose, dt: number): void {
    const n = this.layout.nodeCount, inv = 1 / Math.max(dt, 1e-5);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        const k = i * 3 + c;
        this.x0t[k] = cur.t[k] - next.t[k];
        this.v0t[k] = (cur.t[k] - curPrev.t[k]) * inv - (nextAhead.t[k] - next.t[k]) * inv;
      }
      const q = i * 4;
      // offset rotation: exp(x0r) * next = cur  =>  x0r = log(cur * conj(next))
      this.deltaLog(this.x0r, i * 3, cur.r, q, next.r, q);
      // angular velocities as rotation vectors per second
      this.deltaLog(this.vel, 0, cur.r, q, curPrev.r, q);
      const cvx = this.vel[0] * inv, cvy = this.vel[1] * inv, cvz = this.vel[2] * inv;
      this.deltaLog(this.vel, 0, nextAhead.r, q, next.r, q);
      this.v0r[i * 3] = cvx - this.vel[0] * inv; this.v0r[i * 3 + 1] = cvy - this.vel[1] * inv; this.v0r[i * 3 + 2] = cvz - this.vel[2] * inv;
    }
    this.t = 0; this.active = true;
  }

  /** log(a * conj(b)) -> out[o..o+3] */
  private deltaLog(out: Float32Array, o: number, a: Float32Array, ao: number, b: Float32Array, bo: number): void {
    const bx = -b[bo], by = -b[bo + 1], bz = -b[bo + 2], bw = b[bo + 3];
    dq[0] = a[ao + 3] * bx + a[ao] * bw + a[ao + 1] * bz - a[ao + 2] * by;
    dq[1] = a[ao + 3] * by - a[ao] * bz + a[ao + 1] * bw + a[ao + 2] * bx;
    dq[2] = a[ao + 3] * bz + a[ao] * by - a[ao + 1] * bx + a[ao + 2] * bw;
    dq[3] = a[ao + 3] * bw - a[ao] * bx - a[ao + 1] * by - a[ao + 2] * bz;
    logQuat(out, o, dq[0], dq[1], dq[2], dq[3]);
  }

  /** Advance the decay by dt and add the remaining offset to `pose` (the NEW animation's pose). */
  apply(pose: Pose, dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const t = this.t, y = this.y, e = Math.exp(-y * t);
    const n = this.layout.nodeCount;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        const k = i * 3 + c;
        const off = (this.x0t[k] + (this.v0t[k] + y * this.x0t[k]) * t) * e;
        pose.t[k] += off; energy += off * off;
      }
      const rx = (this.x0r[i * 3] + (this.v0r[i * 3] + y * this.x0r[i * 3]) * t) * e;
      const ry = (this.x0r[i * 3 + 1] + (this.v0r[i * 3 + 1] + y * this.x0r[i * 3 + 1]) * t) * e;
      const rz = (this.x0r[i * 3 + 2] + (this.v0r[i * 3 + 2] + y * this.x0r[i * 3 + 2]) * t) * e;
      energy += rx * rx + ry * ry + rz * rz;
      expQuat(dq, 0, rx, ry, rz);
      const q = i * 4, bx = pose.r[q], by = pose.r[q + 1], bz = pose.r[q + 2], bw = pose.r[q + 3];
      pose.r[q] = dq[3] * bx + dq[0] * bw + dq[1] * bz - dq[2] * by;
      pose.r[q + 1] = dq[3] * by - dq[0] * bz + dq[1] * bw + dq[2] * bx;
      pose.r[q + 2] = dq[3] * bz + dq[0] * by - dq[1] * bx + dq[2] * bw;
      pose.r[q + 3] = dq[3] * bw - dq[0] * bx - dq[1] * by - dq[2] * bz;
    }
    if (t > 6 * this.halfLife && energy < 1e-10) this.active = false;   // fully decayed
  }
}
