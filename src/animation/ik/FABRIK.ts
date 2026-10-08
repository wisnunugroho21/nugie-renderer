import { Quat } from '../../math/Quat';
import type { Pose, PoseLayout } from '../Pose';
import { Xform, assertChain, composeLocal, copyXform, modelTransform, type PoseConstraint } from './IK';
import { slerpInto } from '../AnimationSampler';

const qTmp = new Float32Array(4), qConj = new Float32Array(4), qModel = new Float32Array(4), qNew = new Float32Array(4), qLocal = new Float32Array(4);

/**
 * FABRIK (Forward And Backward Reaching IK) for chains of any length >= 2 bones (reach / tentacle / spine / tail).
 * Positions are solved in MODEL space with fixed bone lengths and a pinned root, then converted to LOCAL joint
 * rotations root->tip (translations and scales of the pose are untouched). `weight` blends FK and IK.
 */
export class FABRIK implements PoseConstraint {
  readonly target = new Float32Array(3);
  weight = 1;
  maxIterations = 12;
  tolerance = 1e-4;
  /** Diagnostics from the last solve. */
  iterations = 0;
  reached = true;

  private n: number;
  private len: Float32Array;
  private solved: Float32Array;   // solved model positions (3 per chain node)
  private curP: Float32Array;     // current model positions during rotation fitting
  private curR: Float32Array;     // current model rotations during rotation fitting
  private work: Float32Array;     // working local rotations (4 per chain node)
  private x = new Xform();
  private tmp = new Xform();

  /** Solve for a chain of at least 3 joints (root first) in `layout`; throws otherwise. */
  constructor(private layout: PoseLayout, readonly chain: number[]) {
    if (chain.length < 3) throw new Error('FABRIK needs a chain of at least 3 joints (2 bones)');
    assertChain(layout, chain, 'FABRIK');
    this.n = chain.length;
    this.len = new Float32Array(this.n - 1);
    this.solved = new Float32Array(this.n * 3);
    this.curP = new Float32Array(this.n * 3);
    this.curR = new Float32Array(this.n * 4);
    this.work = new Float32Array(this.n * 4);
  }

  /** Add every chain joint the solver rotates (all but the tip) to `out`. */
  collectNodes(out: Set<number>): void { for (let i = 0; i < this.n - 1; i++) out.add(this.chain[i]); }

  /** FK of the chain using `work` rotations (+ the pose's local translation/scale) -> curP / curR. */
  private chainFK(pose: Pose, rootParentXform: Xform): void {
    copyXform(this.tmp, rootParentXform);
    for (let i = 0; i < this.n; i++) {
      const node = this.chain[i];
      composeLocal(this.tmp, pose.t, node * 3, this.work, i * 4, pose.s, node * 3);
      this.curP[i * 3] = this.tmp.p[0]; this.curP[i * 3 + 1] = this.tmp.p[1]; this.curP[i * 3 + 2] = this.tmp.p[2];
      this.curR[i * 4] = this.tmp.r[0]; this.curR[i * 4 + 1] = this.tmp.r[1]; this.curR[i * 4 + 2] = this.tmp.r[2]; this.curR[i * 4 + 3] = this.tmp.r[3];
    }
  }

  /** Run FABRIK toward `target` (model space) and blend the resulting joint rotations into `pose` by `weight`. */
  apply(pose: Pose): void {
    if (this.weight <= 0) return;
    const { layout, n, chain, len, solved, curP, work } = this;

    // parent-of-root transform (so chain FK can start from the root's local TRS)
    const parent = layout.parent[chain[0]];
    const rootParent = this.x;
    if (parent >= 0) modelTransform(layout, pose, parent, rootParent);
    else { rootParent.p.fill(0); rootParent.r[0] = rootParent.r[1] = rootParent.r[2] = 0; rootParent.r[3] = 1; rootParent.s.fill(1); }

    for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) work[i * 4 + k] = pose.r[chain[i] * 4 + k];
    this.chainFK(pose, rootParent);
    solved.set(curP);
    let total = 0;
    for (let i = 0; i < n - 1; i++) {
      len[i] = Math.hypot(solved[(i + 1) * 3] - solved[i * 3], solved[(i + 1) * 3 + 1] - solved[i * 3 + 1], solved[(i + 1) * 3 + 2] - solved[i * 3 + 2]);
      total += len[i];
    }
    const rx = solved[0], ry = solved[1], rz = solved[2];
    const tx = this.target[0], ty = this.target[1], tz = this.target[2];
    const dist = Math.hypot(tx - rx, ty - ry, tz - rz);

    if (dist >= total) {
      // unreachable: stretch straight toward the target
      this.reached = false; this.iterations = 0;
      const dx = (tx - rx) / (dist || 1), dy = (ty - ry) / (dist || 1), dz = (tz - rz) / (dist || 1);
      let acc = 0;
      for (let i = 1; i < n; i++) { acc += len[i - 1]; solved[i * 3] = rx + dx * acc; solved[i * 3 + 1] = ry + dy * acc; solved[i * 3 + 2] = rz + dz * acc; }
    } else {
      this.reached = true;
      let it = 0;
      for (; it < this.maxIterations; it++) {
        const err = Math.hypot(solved[(n - 1) * 3] - tx, solved[(n - 1) * 3 + 1] - ty, solved[(n - 1) * 3 + 2] - tz);
        if (err < this.tolerance) break;
        // backward: tip to target
        solved[(n - 1) * 3] = tx; solved[(n - 1) * 3 + 1] = ty; solved[(n - 1) * 3 + 2] = tz;
        for (let i = n - 2; i >= 0; i--) place(solved, i, i + 1, len[i]);
        // forward: pin the root
        solved[0] = rx; solved[1] = ry; solved[2] = rz;
        for (let i = 1; i < n; i++) place(solved, i, i - 1, len[i - 1]);
      }
      this.iterations = it;
    }

    // --- positions -> local rotations, root to tip. Joint i aims its bone at solved[i+1].
    for (let i = 0; i < n - 1; i++) {
      this.chainFK(pose, rootParent);
      const px = curP[i * 3], py = curP[i * 3 + 1], pz = curP[i * 3 + 2];
      Quat.fromTo(qTmp, curP[(i + 1) * 3] - px, curP[(i + 1) * 3 + 1] - py, curP[(i + 1) * 3 + 2] - pz,
        solved[(i + 1) * 3] - px, solved[(i + 1) * 3 + 1] - py, solved[(i + 1) * 3 + 2] - pz);
      for (let k = 0; k < 4; k++) qModel[k] = this.curR[i * 4 + k];
      Quat.multiply(qNew, qTmp, qModel);                              // new model rotation of joint i
      // parent model rotation = rotation of chain[i-1] (already fitted) or the root's parent
      if (i === 0) for (let k = 0; k < 4; k++) qConj[k] = rootParent.r[k];
      else for (let k = 0; k < 4; k++) qConj[k] = this.curR[(i - 1) * 4 + k];
      qConj[0] = -qConj[0]; qConj[1] = -qConj[1]; qConj[2] = -qConj[2];
      Quat.multiply(qLocal, qConj, qNew);
      for (let k = 0; k < 4; k++) work[i * 4 + k] = qLocal[k];
    }

    for (let i = 0; i < n - 1; i++) slerpInto(pose.r, chain[i] * 4, pose.r, chain[i] * 4, work, i * 4, this.weight);
  }
}

/** p[i] = p[ref] + normalize(p[i] - p[ref]) * length */
function place(p: Float32Array, i: number, ref: number, length: number): void {
  let dx = p[i * 3] - p[ref * 3], dy = p[i * 3 + 1] - p[ref * 3 + 1], dz = p[i * 3 + 2] - p[ref * 3 + 2];
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l; dy /= l; dz /= l;
  p[i * 3] = p[ref * 3] + dx * length; p[i * 3 + 1] = p[ref * 3 + 1] + dy * length; p[i * 3 + 2] = p[ref * 3 + 2] + dz * length;
}
