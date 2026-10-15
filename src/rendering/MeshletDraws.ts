import type { GPUContext } from '../gpu/GPUContext';
import { buildMeshlets, type MeshletSet } from '../geometry/MeshOptimizer';
import type { BatchList } from './BatchBuilder';
import type { MeshManager } from './MeshManager';
import type { Material } from './materials/Material';
import type { QueueList } from './RenderQueue';
import type { RenderWorld } from './RenderWorld';
import { MeshletCuller, type MeshletCullParams } from './MeshletCuller';

/** What the planner needs of a culler: the buffers a draw binds and the per-frame encode (a {@link MeshletCuller}, or a stand-in in tests). */
export type MeshletCullerLike = Pick<MeshletCuller, 'indexBuffer' | 'argsBuffer' | 'meshletCount' | 'totalIndices' | 'encode' | 'destroy'>;

/** One batch of this frame that draws through its mesh's culler. */
interface ActiveDraw { culler: MeshletCullerLike; slot: number; baseVertex: number; firstInstance: number; }

/** What {@link MeshletDraws.plan} reads about the frame. */
export interface MeshletFrame {
  rw: RenderWorld;
  batches: BatchList;
  /** The queues the batches were built from (opaque, alpha-mask, transparent), to find each batch's object. */
  lists: readonly QueueList[];
  /** Absolute first-instance of the frame's first record. */
  instanceBase: number;
  materials: ArrayLike<Material>;
  meshes: MeshManager;
  /** The batches the GPU instance culler draws (they are left to it). */
  gpuCull: boolean;
}

/** Sign of the determinant of the upper 3x3 of the column-major matrix at `m[o..o+16)` (negative = mirrored). */
function determinant3(m: ArrayLike<number>, o: number): number {
  return m[o] * (m[o + 5] * m[o + 10] - m[o + 9] * m[o + 6])
    - m[o + 4] * (m[o + 1] * m[o + 10] - m[o + 9] * m[o + 2])
    + m[o + 8] * (m[o + 1] * m[o + 6] - m[o + 5] * m[o + 2]);
}

/**
 * GPU meshlet culling in the renderer's draw path. Opt a mesh in with {@link enable}; every frame, each single-instance opaque /
 * alpha-mask batch of that mesh in the main view is culled per meshlet (frustum + normal cone, see {@link MeshletCuller}) by a compute
 * node that runs before the main pass, and drawn as one `drawIndexedIndirect` over the surviving triangles instead of the whole mesh.
 *
 * A batch takes this path only when the cull is exact for it: one instance (the culler holds one model matrix), a static mesh (no skin /
 * morph), a material that culls back faces (the cone test drops back-facing clusters), a non-mirrored transform, and GPU instance culling
 * off for it. A culler serves one batch per frame; further batches of the same mesh, the depth prepass, shadows, the aux pass and
 * off-screen views draw the whole mesh as before.
 */
export class MeshletDraws {
  /** Master switch: false draws every mesh whole (the cullers are kept). */
  enabled = true;
  private readonly cullers = new Map<number, MeshletCullerLike>();
  /** Culler of each batch of the main view this frame (null = ordinary draw); valid for `[0, batches.count)`. */
  private batchCuller: (MeshletCullerLike | null)[] = [];
  private batchCount = 0;
  private readonly active: ActiveDraw[] = [];
  private readonly claimed = new Set<MeshletCullerLike>();
  private readonly params: MeshletCullParams & { model: Float32Array } = { model: new Float32Array(16), planes: [], eye: [] };

  /**
   * @param gpu the device context
   * @param meshes the mesh manager (its CPU geometry copy builds the meshlets)
   * @param create culler factory (tests replace it)
   */
  constructor(
    private readonly gpu: GPUContext | null, private readonly meshes: MeshManager,
    private readonly create: (set: MeshletSet) => MeshletCullerLike = (set) => new MeshletCuller(gpu!, set),
  ) {}

  /**
   * Cull mesh `meshId` per meshlet from now on. `set` defaults to meshlets built (64 vertices / 124 triangles) from the mesh's CPU geometry
   * copy, which needs `meshes.keepCpuGeometry` (on by default) when the mesh was created. Enabling an enabled mesh replaces its culler.
   */
  enable(meshId: number, set?: MeshletSet): void {
    if (!set) {
      const geometry = this.meshes.cpuGeometry(meshId);
      if (!geometry) throw new Error(`meshlets: mesh ${meshId} has no CPU geometry copy (skinned / morphed, or keepCpuGeometry was off); pass a MeshletSet`);
      set = buildMeshlets(geometry.positions, geometry.indices, 64, 124);
    }
    this.disable(meshId);
    this.cullers.set(meshId, this.create(set));
  }

  /** Stop meshlet culling of `meshId` and release its GPU buffers. Returns false when it was not enabled. */
  disable(meshId: number): boolean {
    const c = this.cullers.get(meshId);
    if (!c) return false;
    c.destroy();
    this.cullers.delete(meshId);
    return true;
  }

  /** True when `meshId` has a culler. */
  has(meshId: number): boolean { return this.cullers.has(meshId); }

  /** Meshlet-culled draws of the current frame. */
  get drawCount(): number { return this.active.length; }

  /** Meshlets the current frame's culling passes test. */
  get meshletCount(): number { let n = 0; for (const a of this.active) n += a.culler.meshletCount; return n; }

  /** Triangles submitted to the current frame's culling passes (an upper bound of what the meshlet draws rasterize). */
  get inputTriangles(): number { let n = 0; for (const a of this.active) n += a.culler.totalIndices / 3; return n; }

  /** Pick this frame's meshlet draws among the main view's batches. Call after the batches are built. */
  plan(f: MeshletFrame): void {
    this.active.length = 0;
    this.claimed.clear();
    const b = f.batches;
    this.batchCount = b.count;
    if (this.batchCuller.length < b.count) this.batchCuller.length = b.count;
    this.batchCuller.fill(null, 0, b.count);
    if (!this.enabled || this.cullers.size === 0 || !f.rw.hasCamera || f.gpuCull) return;
    const firstInstanceOk = this.gpu?.device.features?.has('indirect-first-instance') ?? true;
    const tr = f.rw.transforms;
    for (let i = 0; i < b.count; i++) {
      const culler = this.cullers.get(b.meshId[i]);
      if (!culler || this.claimed.has(culler) || b.instanceCount[i] !== 1 || b.queue[i] > 1 || b.late[i] === 1) continue;
      if (f.materials[b.materialId[i]].state.cullMode !== 'back') continue;
      const mesh = f.meshes.get(b.meshId[i]);
      if (mesh.deformMask !== 0 || (b.firstInstance[i] !== 0 && !firstInstanceOk)) continue;
      const slot = this.objectOf(f, b.firstInstance[i] - f.instanceBase);
      if (slot < 0 || determinant3(tr, slot * 16) <= 0) continue;
      this.claimed.add(culler);
      this.batchCuller[i] = culler;
      this.active.push({ culler, slot, baseVertex: mesh.baseVertex, firstInstance: b.firstInstance[i] });
    }
  }

  /** The object slot of the `k`th record of the frame (records follow the queues in order). */
  private objectOf(f: MeshletFrame, k: number): number {
    for (const l of f.lists) {
      if (k < l.count) return l.slots[k];
      k -= l.count;
    }
    return -1;
  }

  /** The culler that draws batch `i` of the main view this frame, or null for an ordinary draw. */
  cullerFor(i: number): MeshletCullerLike | null { return i < this.batchCount ? this.batchCuller[i] : null; }

  /** Record this frame's culling passes (before the main pass that draws them). */
  encode(enc: GPUCommandEncoder, rw: RenderWorld): void {
    const p = this.params, cam = rw.camera;
    p.planes = cam.frustum.planes; p.eye = cam.position;
    for (const a of this.active) {
      p.model.set(rw.transforms.subarray(a.slot * 16, a.slot * 16 + 16));
      p.baseVertex = a.baseVertex; p.firstInstance = a.firstInstance;
      a.culler.encode(enc, p);
    }
  }

  /** Release every culler. */
  destroy(): void {
    for (const c of this.cullers.values()) c.destroy();
    this.cullers.clear();
    this.active.length = 0;
    this.batchCount = 0;
  }
}
