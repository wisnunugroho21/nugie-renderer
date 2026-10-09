import type { World } from '../ecs/World';
import { entityIndex } from '../ecs/Entity';
import { RenderFlags } from '../ecs/components/MeshRendererStore';
import { createGroup, type GroupOptions } from '../ecs/Hierarchy';
import { Mat4 } from '../math/Mat4';
import type { MeshManager } from '../rendering/MeshManager';

export interface InstancedMeshOptions extends GroupOptions {
  /** Mesh id (`renderer.meshes.create`). */
  mesh: number;
  /** Material id every instance starts with (change one with `setMaterialAt`). */
  material: number;
  /** Number of instances. */
  count: number;
  /** `RenderFlags` of the instances (default: casts + receives shadows). */
  flags?: number;
}

const TMP_P = new Float32Array(3), TMP_Q = new Float32Array(4), TMP_S = new Float32Array(3);

/**
 * Many copies of one mesh under one group, with cheap per-instance control: `setMatrixAt` / `setTRSAt` / `setPositionAt`, visibility,
 * a visible `count`, and per-instance materials. Like three.js `InstancedMesh`, plus the group transform: moving `root` moves them all.
 *
 * Under the hood every instance is a light entity (transform + mesh renderer + bounds) and the renderer collapses instances sharing
 * (mesh, material) into one instanced draw automatically, culling them individually - so 100k instances cost one draw call per distinct
 * material and the usual per-object CPU work (matrices are recomputed only for instances you actually move).
 *
 * Do not mark instances `RenderFlags.Static` if their group moves: static objects live in a BVH that assumes they never move.
 */
export class InstancedMesh {
  /** The group entity (index) that parents every instance: move / rotate / scale it to transform the whole set. */
  readonly root: number;
  readonly mesh: number;
  private _capacity = 0;
  private _count = 0;
  private material: number;
  private flags: number;
  /** Entity handles (generational ids, safe to destroy) and indices of the instances. */
  private handles: number[] = [];
  private indices: number[] = [];
  private byEntity = new Map<number, number>();
  /** Per-instance "hidden by the user" flag (the visible `count` is applied on top). */
  private hiddenByUser: Uint8Array = new Uint8Array(0);
  private disposed = false;

  constructor(private world: World, private meshes: MeshManager, o: InstancedMeshOptions) {
    this.mesh = o.mesh;
    this.material = o.material;
    this.flags = o.flags ?? (RenderFlags.CastShadow | RenderFlags.ReceiveShadow);
    this.root = createGroup(world, o);
    this.resize(o.count);
  }

  /** Number of instances that exist. */
  get capacity(): number { return this._capacity; }
  /** Number of instances that are drawn (the first `count`, minus those hidden with `setVisibleAt`). */
  get count(): number { return this._count; }
  /** Entity index of instance `i` (for `engine.pick` results, components such as lights or animation, ...). */
  entityAt(i: number): number { return this.indices[i]; }

  /** Instance index of entity `entity` (maps an `engine.pick` result back to an instance), or -1. */
  instanceOf(entity: number): number { return this.byEntity.get(entity) ?? -1; }

  /** Create or destroy instances so that exactly `capacity` exist. New instances start at the group origin, hidden only if beyond `count`. */
  resize(capacity: number): void {
    const w = this.world, mm = this.meshes;
    capacity = Math.max(0, Math.floor(capacity));
    const b = mm.get(this.mesh).bounds;
    while (this.handles.length < capacity) {
      const h = w.create(), e = entityIndex(h);
      w.transforms.add(e, 0, 0, 0);
      w.transforms.setParent(e, this.root);
      w.meshRenderers.add(e, this.mesh, this.material, this.flags);
      w.bounds.add(e, b[0], b[1], b[2], b[3], b[4], b[5]);
      this.byEntity.set(e, this.handles.length);
      this.handles.push(h); this.indices.push(e);
    }
    while (this.handles.length > capacity) { w.destroy(this.handles.pop()!); this.byEntity.delete(this.indices.pop()!); }
    if (this.hiddenByUser.length < capacity) { const n = new Uint8Array(capacity); n.set(this.hiddenByUser); this.hiddenByUser = n; }
    const allShown = this._count === this._capacity;
    this._capacity = capacity;
    this._count = allShown ? capacity : Math.min(this._count, capacity);   // growing a fully shown set shows the new instances too
    this.applyVisibility(0, capacity);
  }

  /** Show only the first `n` instances (the rest are hidden, not destroyed: raising `n` again brings them back). */
  setCount(n: number): void {
    n = Math.max(0, Math.min(this._capacity, Math.floor(n)));
    const lo = Math.min(n, this._count), hi = Math.max(n, this._count);
    this._count = n;
    this.applyVisibility(lo, hi);
  }

  private applyVisibility(from: number, to: number): void {
    const mr = this.world.meshRenderers;
    for (let i = from; i < to && i < this.indices.length; i++) {
      const e = this.indices[i];
      const hidden = i >= this._count || this.hiddenByUser[i] === 1;
      mr.flags[e] = hidden ? (mr.flags[e] | RenderFlags.Hidden) : (mr.flags[e] & ~RenderFlags.Hidden);
    }
  }

  /** Show or hide a single instance. */
  setVisibleAt(i: number, visible: boolean): void {
    this.hiddenByUser[i] = visible ? 0 : 1;
    this.applyVisibility(i, i + 1);
  }

  /** Position (local to the group), rotation quaternion (x, y, z, w) and scale of instance `i`. */
  setTRSAt(i: number, px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number, sx: number, sy: number, sz: number): void {
    const t = this.world.transforms, e = this.indices[i];
    t.setPosition(e, px, py, pz);
    t.setRotation(e, qx, qy, qz, qw);
    t.setScale(e, sx, sy, sz);
  }

  /** Set instance `i` from a 4x4 column-major matrix (translation + rotation + scale; shear is dropped). `off` indexes into a packed array of matrices. */
  setMatrixAt(i: number, m: ArrayLike<number>, off = 0): void {
    Mat4.decompose(m as Float32Array, TMP_P, TMP_Q, TMP_S, off);
    this.setTRSAt(i, TMP_P[0], TMP_P[1], TMP_P[2], TMP_Q[0], TMP_Q[1], TMP_Q[2], TMP_Q[3], TMP_S[0], TMP_S[1], TMP_S[2]);
  }

  /** The local matrix of instance `i` (relative to the group). */
  getMatrixAt(i: number, out: Float32Array = new Float32Array(16)): Float32Array {
    const t = this.world.transforms, e = this.indices[i];
    return Mat4.compose(out, t.positionX[e], t.positionY[e], t.positionZ[e], t.rotationX[e], t.rotationY[e], t.rotationZ[e], t.rotationW[e], t.scaleX[e], t.scaleY[e], t.scaleZ[e]) as Float32Array;
  }

  setPositionAt(i: number, x: number, y: number, z: number): void { this.world.transforms.setPosition(this.indices[i], x, y, z); }
  setRotationAt(i: number, x: number, y: number, z: number, w: number): void { this.world.transforms.setRotation(this.indices[i], x, y, z, w); }
  setScaleAt(i: number, x: number, y: number, z: number): void { this.world.transforms.setScale(this.indices[i], x, y, z); }

  /** Give instance `i` another material (instances sharing a material still batch together): per-instance colours, variants, highlights. */
  setMaterialAt(i: number, material: number): void { this.world.meshRenderers.materialId[this.indices[i]] = material; }

  /** Destroy every instance and the group. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const h of this.handles) this.world.destroy(h);
    this.handles.length = 0; this.indices.length = 0; this.byEntity.clear();
    const g = this.world.entities.handleOf(this.root);
    if (g >= 0) this.world.destroy(g);
  }
}
