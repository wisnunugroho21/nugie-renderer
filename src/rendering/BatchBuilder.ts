import type { RenderWorld } from './RenderWorld';
import type { QueueList } from './RenderQueue';
import type { MeshRecord } from './MeshManager';

/** Instance record = 12 u32 (48 bytes); mirrors `Instance` in common.wgsl. */
export const INSTANCE_WORDS = 12;
export const INSTANCE_BYTES = INSTANCE_WORDS * 4;

/** A batch = consecutive objects sharing (material, mesh) => ONE instanced draw. */
export class BatchList {
  count = 0;
  materialId = new Int32Array(64);
  meshId = new Int32Array(64);
  /** Index into the frame instance array (relative to the start of this list). */
  firstInstance = new Uint32Array(64);
  instanceCount = new Uint32Array(64);
  /** Which queue each batch belongs to (0 opaque, 1 alphaMask, 2 transparent). */
  queue = new Uint8Array(64);
  /** 1 for batches drawn after the opaque geometry and the sky: blended surfaces and transmissive materials (set by the renderer). */
  late = new Uint8Array(64);

  /** Empty the list (capacity is kept). */
  reset(): void { this.count = 0; }

  /** Append a batch: `n` instances starting at `first`, drawn with `mesh` + `material` from queue `q` (0 opaque, 1 alpha-mask, 2 transparent). */
  push(material: number, mesh: number, first: number, n: number, q: number): void {
    if (this.count === this.materialId.length) this.grow();
    const i = this.count++;
    this.materialId[i] = material; this.meshId[i] = mesh; this.firstInstance[i] = first; this.instanceCount[i] = n; this.queue[i] = q;
  }

  /** Double the capacity of every column. */
  private grow(): void {
    const n = this.materialId.length * 2;
    /** Return a copy of typed array `a` with the doubled length. */
    const g = <T extends Int32Array | Uint32Array | Uint8Array>(a: T): T => {
      const o = new (a.constructor as new (n: number) => T)(n); o.set(a); return o;
    };
    this.materialId = g(this.materialId); this.meshId = g(this.meshId); this.firstInstance = g(this.firstInstance);
    this.instanceCount = g(this.instanceCount); this.queue = g(this.queue); this.late = g(this.late);
  }
}

/**
 * Turns sorted queue lists into batches and writes Instance records (in draw order) into `out`.
 * `instanceBase` is the running instance index of the first record written (for firstInstance).
 * mode 'instanced' merges equal (material, mesh) runs; 'individual' emits one batch per object.
 *
 * Instances of one batch may belong to different skeletons / morph states: joint and weight offsets are
 * per-instance, so skinned/morphed characters sharing a mesh+material still collapse into one draw.
 */
export function buildBatches(
  lists: QueueList[], rw: RenderWorld, meshes: ArrayLike<MeshRecord>, out: Uint32Array, instanceBase: number,
  mode: 'instanced' | 'individual', batches: BatchList, spheres?: Float32Array,
): number {
  batches.reset();
  let written = 0;
  for (let q = 0; q < lists.length; q++) {
    const list = lists[q];
    let runStart = written, curMat = -1, curMesh = -1;
    for (let i = 0; i < list.count; i++) {
      const slot = list.slots[i];
      const mat = rw.materialId[slot], meshId = rw.meshId[slot];
      if (mode === 'individual') {
        batches.push(mat, meshId, instanceBase + written, 1, q);
      } else if (i === 0 || mat !== curMat || meshId !== curMesh) {
        if (i > 0) batches.push(curMat, curMesh, instanceBase + runStart, written - runStart, q);
        runStart = written; curMat = mat; curMesh = meshId;
      }
      const mesh = meshes[meshId];
      const o = written * INSTANCE_WORDS;
      out[o] = slot;                                   // transformIndex (slot into the shared transform buffer)
      out[o + 1] = mat;                                // materialIndex
      out[o + 2] = rw.jointOffset[slot];               // jointOffset
      out[o + 3] = rw.jointCount[slot];                // jointCount (0 = not skinned)
      out[o + 4] = rw.morphOffset[slot];               // morphWeightOffset
      out[o + 5] = Math.min(rw.morphCount[slot], mesh.morphTargetCount); // morphTargetCount
      out[o + 6] = rw.entityIndex[slot];               // objectId
      out[o + 7] = mesh.baseVertex;                    // vertexBase
      out[o + 8] = mesh.vertexCount;
      out[o + 9] = mesh.skinBase;
      out[o + 10] = mesh.morphBase;
      out[o + 11] = mesh.deformMask;
      if (spheres) { const sp = rw.boundsSphere, so = written * 4; spheres[so] = sp[slot * 4]; spheres[so + 1] = sp[slot * 4 + 1]; spheres[so + 2] = sp[slot * 4 + 2]; spheres[so + 3] = sp[slot * 4 + 3]; }
      written++;
    }
    if (mode === 'instanced' && list.count > 0) {
      batches.push(curMat, curMesh, instanceBase + runStart, written - runStart, q);
    }
  }
  return written;
}
