import { Quat } from '../../math/Quat';
import type { Pose, PoseLayout } from '../Pose';
import { Xform, assertChain, composeLocal, copyXform, modelTransform, type PoseConstraint } from './IK';
import { slerpInto } from '../AnimationSampler';

// Module-level scratch: solvers run every frame and must not allocate.
const qParentConj = new Float32Array(4), qA = new Float32Array(4), qNewModelA = new Float32Array(4), qLocalA = new Float32Array(4);
const qB = new Float32Array(4), qBModel = new Float32Array(4), qNewModelB = new Float32Array(4), qNewModelAConj = new Float32Array(4), qLocalB = new Float32Array(4);
const qRootLocalConj = new Float32Array(4);
const vChild = new Float32Array(3), vBend = new Float32Array(3);

const conj = (o: Float32Array, a: ArrayLike<number>, ao = 0) => { o[0] = -a[ao]; o[1] = -a[ao + 1]; o[2] = -a[ao + 2]; o[3] = a[ao + 3]; };

/** vBend = component of v perpendicular to unit axis d; returns false if (nearly) parallel. */
function perpendicular(vx: number, vy: number, vz: number, dx: number, dy: number, dz: number): boolean {
  const dot = vx * dx + vy * dy + vz * dz;
  vBend[0] = vx - dx * dot; vBend[1] = vy - dy * dot; vBend[2] = vz - dz * dot;
  return Math.hypot(vBend[0], vBend[1], vBend[2]) > 1e-6;
}

/**
 * Analytic two-bone IK (leg: hip-knee-ankle, arm: shoulder-elbow-wrist) via the law of cosines.
 * Targets/pole are in MODEL space. `weight` blends FK (0) and IK (1) per joint rotation. Unreachable targets
 * are handled by clamping the reach (the chain straightens toward the target) - never NaN.
 */
export class TwoBoneIK implements PoseConstraint {
  /** Desired end position in model space. */
  readonly target = new Float32Array(3);
  /** Optional pole position in model space: the middle joint bends toward it. */
  pole: Float32Array | null = null;
  weight = 1;
  /** Diagnostics: was the target reachable at the last solve? */
  reachable = true;

  private A = new Xform();
  private B = new Xform();
  private C = new Xform();
  private tmp = new Xform();
  private parentRot = new Float32Array(4);

  constructor(private layout: PoseLayout, readonly root: number, readonly mid: number, readonly end: number) {
    assertChain(layout, [root, mid, end], 'TwoBoneIK');
  }

  collectNodes(out: Set<number>): void { out.add(this.root); out.add(this.mid); }

  apply(pose: Pose): void {
    if (this.weight <= 0) return;
    const { layout, A, B, C, tmp } = this;
    const { root, mid, end } = this;

    // --- forward kinematics of the chain in model space
    modelTransform(layout, pose, root, A);
    copyXform(tmp, A); composeLocal(tmp, pose.t, mid * 3, pose.r, mid * 4, pose.s, mid * 3); copyXform(B, tmp);
    composeLocal(tmp, pose.t, end * 3, pose.r, end * 4, pose.s, end * 3); copyXform(C, tmp);
    // parent model rotation of the root joint:  rA = rP * localA  =>  rP = rA * conj(localA)
    conj(qRootLocalConj, pose.r, root * 4);
    Quat.multiply(this.parentRot, A.r, qRootLocalConj);

    const ax = A.p[0], ay = A.p[1], az = A.p[2];
    const l1 = Math.hypot(B.p[0] - ax, B.p[1] - ay, B.p[2] - az);
    const l2 = Math.hypot(C.p[0] - B.p[0], C.p[1] - B.p[1], C.p[2] - B.p[2]);
    if (l1 < 1e-8 || l2 < 1e-8) return;

    let tx = this.target[0] - ax, ty = this.target[1] - ay, tz = this.target[2] - az;
    let dist = Math.hypot(tx, ty, tz);
    if (dist < 1e-6) { tx = C.p[0] - ax; ty = C.p[1] - ay; tz = C.p[2] - az; dist = Math.hypot(tx, ty, tz) || 1; }
    const maxReach = l1 + l2 - 1e-5, minReach = Math.abs(l1 - l2) + 1e-5;
    this.reachable = dist <= maxReach && dist >= minReach;
    const d = Math.min(maxReach, Math.max(minReach, dist));
    const dx = tx / dist, dy = ty / dist, dz = tz / dist;

    // --- bend direction: toward the pole if given, else keep the current bend, else any perpendicular
    let ok = this.pole ? perpendicular(this.pole[0] - ax, this.pole[1] - ay, this.pole[2] - az, dx, dy, dz) : false;
    if (!ok) ok = perpendicular(B.p[0] - ax, B.p[1] - ay, B.p[2] - az, dx, dy, dz);
    if (!ok) {
      const fx = Math.abs(dx), fy = Math.abs(dy), fz = Math.abs(dz);
      const ex = fx <= fy && fx <= fz ? 1 : 0, ey = ex === 0 && fy <= fz ? 1 : 0, ez = ex === 0 && ey === 0 ? 1 : 0;
      vBend[0] = dy * ez - dz * ey; vBend[1] = dz * ex - dx * ez; vBend[2] = dx * ey - dy * ex;
    }
    const bl = Math.hypot(vBend[0], vBend[1], vBend[2]) || 1;
    const bx = vBend[0] / bl, by = vBend[1] / bl, bz = vBend[2] / bl;

    // --- desired middle joint position (law of cosines) and the clamped target point
    const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    const nBx = ax + dx * x + bx * h, nBy = ay + dy * x + by * h, nBz = az + dz * x + bz * h;
    const tpx = ax + dx * d, tpy = ay + dy * d, tpz = az + dz * d;

    // --- upper bone: rotate (B-A) onto (B'-A), expressed in model space, then convert to a local rotation
    Quat.fromTo(qA, B.p[0] - ax, B.p[1] - ay, B.p[2] - az, nBx - ax, nBy - ay, nBz - az);
    Quat.multiply(qNewModelA, qA, A.r);
    conj(qParentConj, this.parentRot);
    Quat.multiply(qLocalA, qParentConj, qNewModelA);

    // --- lower bone: after A rotated, C sits at B' + qA*(C-B); aim that bone at the clamped target point
    vChild[0] = C.p[0] - B.p[0]; vChild[1] = C.p[1] - B.p[1]; vChild[2] = C.p[2] - B.p[2];
    Quat.rotateVec3(vChild, qA, vChild);
    Quat.fromTo(qB, vChild[0], vChild[1], vChild[2], tpx - nBx, tpy - nBy, tpz - nBz);
    Quat.multiply(qBModel, qA, B.r);                 // B's model rotation after only A moved
    Quat.multiply(qNewModelB, qB, qBModel);
    conj(qNewModelAConj, qNewModelA);
    Quat.multiply(qLocalB, qNewModelAConj, qNewModelB);

    // --- FK/IK weight, then write back (shortest-arc blend)
    slerpInto(pose.r, root * 4, pose.r, root * 4, qLocalA, 0, this.weight);
    slerpInto(pose.r, mid * 4, pose.r, mid * 4, qLocalB, 0, this.weight);
  }
}
