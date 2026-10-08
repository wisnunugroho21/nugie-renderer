import type { World } from '../World';
import type { JointMatrixBuffer } from '../../rendering/JointMatrixBuffer';
import type { SkeletonInstance } from '../../animation/Skeleton';
import { Mat4 } from '../../math/Mat4';

const IDENTITY = Mat4.create();

/**
 * Runtime order:  Animation -> local transforms -> TransformSystem (hierarchy) -> THIS ->
 *                 joint world matrices -> skinning matrices (shared JointMatrixBuffer).
 *
 * CONVENTION (tested): jointMatrix[j] = inverse(ownerWorld) * jointWorld[j] * inverseBind[j].
 * The renderer then applies the owner's world matrix after skinning, so the visible result equals
 * glTF's  jointWorld * inverseBind  (the mesh node transform cancels out).
 *
 * Only skeletons whose joints (or owner) moved this frame are recomputed.
 */
export class SkeletonSystem {
  updatedSkeletons = 0;
  updatedJoints = 0;

  private queue: SkeletonInstance[] = [];
  private inv = Mat4.create();
  private tmp = Mat4.create();

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
    this.updatedSkeletons = 0; this.updatedJoints = 0;
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

  /** Recompute one skeleton's skinning matrices: inverse(ownerWorld) * jointWorld * inverseBind, and mark its range for upload. */
  private compute(inst: SkeletonInstance): void {
    const t = this.world.transforms.worldMatrices, out = this.joints.cpu;
    const sk = inst.skeleton, ibm = sk.inverseBind;
    const inv = Mat4.invert(this.inv, t.subarray(inst.owner * 16, inst.owner * 16 + 16)) ? this.inv : IDENTITY;
    const base = inst.jointOffset * 16;
    for (let j = 0; j < inst.jointCount; j++) {
      Mat4.multiplyAt(this.tmp, 0, t, inst.jointEntities[j] * 16, ibm, j * 16);   // jointWorld * inverseBind
      Mat4.multiplyAt(out, base + j * 16, inv, 0, this.tmp, 0);                   // inverse(ownerWorld) * (...)
    }
    this.joints.markDirty(inst.jointOffset, inst.jointCount);
    this.updatedSkeletons++;
    this.updatedJoints += inst.jointCount;
  }
}
