import type { World } from '../World';
import type { JointMatrixBuffer } from '../../rendering/JointMatrixBuffer';
import type { SkeletonInstance } from '../../animation/Skeleton';
import { Mat4 } from '../../math/Mat4';
import { JOINT_MATRIX_FLOATS } from '../../rendering/JointMatrixBuffer';

const IDENTITY = Mat4.create();
/** A joint matrix counts as changed when any element moves by more than this (float32 noise of world-space products is a few 1e-6). */
const SKIN_EPSILON = 2e-5;

/**
 * Runtime order:  Animation -> local transforms -> TransformSystem (hierarchy) -> THIS ->
 *                 joint world matrices -> skinning matrices (shared JointMatrixBuffer).
 *
 * CONVENTION (tested): jointMatrix[j] = inverse(ownerWorld) * jointWorld[j] * inverseBind[j].
 * The renderer then applies the owner's world matrix after skinning, so the visible result equals
 * glTF's  jointWorld * inverseBind  (the mesh node transform cancels out).
 *
 * Only skeletons whose joints (or owner) moved this frame are recomputed, and a recomputed skeleton is only re-uploaded when some joint
 * matrix really changed (by more than `SKIN_EPSILON`): a character that moves as a rigid whole - its owner and joints under one moved
 * root - gets the same owner-relative matrices back and costs no upload.
 */
export class SkeletonSystem {
  updatedSkeletons = 0;
  updatedJoints = 0;

  private queue: SkeletonInstance[] = [];
  private inv = Mat4.create();
  private tmp = Mat4.create();
  private rows = new Float32Array(JOINT_MATRIX_FLOATS);
  /** Skeletons recomputed whose matrices did not change (diagnostics). */
  unchangedSkeletons = 0;

  /** Create the system; hooks `world.skins` so new skeletons get a joint range in the shared buffer and removed ones release it. */
  constructor(private world: World, private joints: JointMatrixBuffer) {
    world.skins.onAdd = (inst) => {
      inst.jointOffset = joints.allocate(inst.jointCount);
      inst.dirty = true;
      this.queue.push(inst);
    };
    world.skins.onRemove = (inst) => { if (inst.jointOffset >= 0) joints.release(inst.jointOffset, inst.jointCount); };
  }

  /** `changed` = entity indices whose world matrix changed (TransformSystem.updated). */
  update(changed: ArrayLike<number>): void {
    const skins = this.world.skins;
    this.updatedSkeletons = 0; this.updatedJoints = 0; this.unchangedSkeletons = 0;
    if (skins.aliveInstances === 0) return;

    for (let k = 0; k < changed.length; k++) {
      skins.forEachDependent(changed[k], (inst) => {
        if (!inst.dirty) { inst.dirty = true; this.queue.push(inst); }
      });
    }
    const q = this.queue;
    for (let n = 0; n < q.length; n++) {
      const inst = q[n];
      if (skins.instances[inst.id] !== inst) continue; // removed meanwhile
      this.compute(inst);
      inst.dirty = false;
    }
    q.length = 0;
  }

  /** Recompute one skeleton's skinning matrices: inverse(ownerWorld) * jointWorld * inverseBind, and mark its range for upload if any changed. */
  private compute(inst: SkeletonInstance): void {
    const t = this.world.transforms.worldMatrices, out = this.joints.cpu;
    const sk = inst.skeleton, ibm = sk.inverseBind;
    const inv = Mat4.invert(this.inv, t.subarray(inst.owner * 16, inst.owner * 16 + 16)) ? this.inv : IDENTITY;
    const base = inst.jointOffset * JOINT_MATRIX_FLOATS, rows = this.rows, tmp = this.tmp;
    let changed = false;
    for (let j = 0; j < inst.jointCount; j++) {
      affineMul(tmp, t, inst.jointEntities[j] * 16, ibm, j * 16);   // jointWorld * inverseBind
      affineRows(rows, inv, tmp);                                    // inverse(ownerWorld) * (...), three rows
      const o = base + j * JOINT_MATRIX_FLOATS;
      let differs = false;
      for (let k = 0; k < JOINT_MATRIX_FLOATS; k++) if (Math.abs(rows[k] - out[o + k]) > SKIN_EPSILON) { differs = true; break; }
      if (differs) { out.set(rows, o); changed = true; }
    }
    if (changed) this.joints.markDirty(inst.jointOffset, inst.jointCount); else this.unchangedSkeletons++;
    this.updatedSkeletons++;
    this.updatedJoints += inst.jointCount;
  }
}

/** out (16 floats) = a[ao..] * b[bo..] for affine matrices (bottom row 0 0 0 1): 36 multiply-adds instead of a full 4x4 product. */
function affineMul(out: Float32Array, a: Float32Array, ao: number, b: Float32Array, bo: number): void {
  const a00 = a[ao], a01 = a[ao + 1], a02 = a[ao + 2], a10 = a[ao + 4], a11 = a[ao + 5], a12 = a[ao + 6],
    a20 = a[ao + 8], a21 = a[ao + 9], a22 = a[ao + 10], a30 = a[ao + 12], a31 = a[ao + 13], a32 = a[ao + 14];
  for (let c = 0; c < 3; c++) {
    const b0 = b[bo + c * 4], b1 = b[bo + c * 4 + 1], b2 = b[bo + c * 4 + 2];
    out[c * 4] = b0 * a00 + b1 * a10 + b2 * a20; out[c * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21; out[c * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22; out[c * 4 + 3] = 0;
  }
  const b0 = b[bo + 12], b1 = b[bo + 13], b2 = b[bo + 14];
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + a30; out[13] = b0 * a01 + b1 * a11 + b2 * a21 + a31; out[14] = b0 * a02 + b1 * a12 + b2 * a22 + a32; out[15] = 1;
}

/** rows (12 floats, the packed joint-matrix layout) = a * b for affine column-major 4x4 matrices `a` and `b`. */
function affineRows(rows: Float32Array, a: Float32Array, b: Float32Array): void {
  for (let r = 0; r < 3; r++) {
    const ar0 = a[r], ar1 = a[4 + r], ar2 = a[8 + r], ar3 = a[12 + r];
    rows[r * 4] = ar0 * b[0] + ar1 * b[1] + ar2 * b[2];
    rows[r * 4 + 1] = ar0 * b[4] + ar1 * b[5] + ar2 * b[6];
    rows[r * 4 + 2] = ar0 * b[8] + ar1 * b[9] + ar2 * b[10];
    rows[r * 4 + 3] = ar0 * b[12] + ar1 * b[13] + ar2 * b[14] + ar3;
  }
}
