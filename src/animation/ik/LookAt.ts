import { Quat } from '../../math/Quat';
import type { Pose, PoseLayout } from '../Pose';
import { Xform, modelTransform, type PoseConstraint } from './IK';
import { slerpInto } from '../AnimationSampler';
import { hypot3 } from '../../math/hypot';

const qFrom = new Float32Array(4), qLimited = new Float32Array(4), qNewModel = new Float32Array(4), qParentConj = new Float32Array(4), qLocal = new Float32Array(4);
const qLocalConj = new Float32Array(4), qParent = new Float32Array(4);
const vAxis = new Float32Array(3);
const IDENT = new Float32Array([0, 0, 0, 1]);

/**
 * Aim one joint's local `axis` (default +Z) at a MODEL-space target (head/eyes/turret/weapon aiming), with an angle
 * limit measured from the joint's current (animated) aim, and an FK/IK weight.
 */
export class LookAt implements PoseConstraint {
  readonly target = new Float32Array(3);
  weight = 1;
  /** Maximum rotation away from the animated pose, in radians. */
  maxAngle = Math.PI;
  private x = new Xform();

  /** Rotate `joint` so its local `axis` (default +Z) points at the target. */
  constructor(private layout: PoseLayout, readonly joint: number, readonly axis: [number, number, number] = [0, 0, 1]) {}

  /** Add the joint this constraint rotates to `out`. */
  collectNodes(out: Set<number>): void { out.add(this.joint); }

  /** Aim the joint at `target` (model space), limited to `maxAngle`, and blend the new rotation into `pose` by `weight`. */
  apply(pose: Pose): void {
    if (this.weight <= 0) return;
    const { layout, joint, x } = this;
    modelTransform(layout, pose, joint, x);
    // current aim direction in model space
    vAxis[0] = this.axis[0]; vAxis[1] = this.axis[1]; vAxis[2] = this.axis[2];
    Quat.rotateVec3(vAxis, x.r, vAxis);
    const dx = this.target[0] - x.p[0], dy = this.target[1] - x.p[1], dz = this.target[2] - x.p[2];
    if (hypot3(dx, dy, dz) < 1e-6) return;
    Quat.fromTo(qFrom, vAxis[0], vAxis[1], vAxis[2], dx, dy, dz);
    // limit the angle: q = slerp(identity, qFrom, min(1, max / angle))
    const angle = 2 * Math.acos(Math.min(1, Math.abs(qFrom[3])));
    const t = angle > this.maxAngle ? this.maxAngle / angle : 1;
    slerpInto(qLimited, 0, IDENT, 0, qFrom, 0, t);
    Quat.multiply(qNewModel, qLimited, x.r);
    // local = conj(parentModel) * newModel, with parentModel = oldModel * conj(oldLocal)
    qLocalConj[0] = -pose.r[joint * 4]; qLocalConj[1] = -pose.r[joint * 4 + 1]; qLocalConj[2] = -pose.r[joint * 4 + 2]; qLocalConj[3] = pose.r[joint * 4 + 3];
    Quat.multiply(qParent, x.r, qLocalConj);
    qParentConj[0] = -qParent[0]; qParentConj[1] = -qParent[1]; qParentConj[2] = -qParent[2]; qParentConj[3] = qParent[3];
    Quat.multiply(qLocal, qParentConj, qNewModel);
    slerpInto(pose.r, joint * 4, pose.r, joint * 4, qLocal, 0, this.weight);
  }
}
