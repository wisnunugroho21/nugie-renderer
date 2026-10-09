import type { World } from '../ecs/World';
import { entityIndex } from '../ecs/Entity';
import { RenderFlags } from '../ecs/components/MeshRendererStore';
import { createGroup, type GroupOptions } from '../ecs/Hierarchy';
import { Mat4 } from '../math/Mat4';
import type { MeshManager } from '../rendering/MeshManager';

export interface BatchedMeshOptions extends GroupOptions {
  /** The one material every instance uses. */
  material: number;
  /** Upper limit on live instances (a guard against runaway scripts). Default 1,000,000. */
  maxInstances?: number;
  /** `RenderFlags` of the instances (default: casts + receives shadows). */
  flags?: number;
}

const TMP_P = new Float32Array(3), TMP_Q = new Float32Array(4), TMP_S = new Float32Array(3);

/**
 * A heterogeneous batch: several different geometries sharing ONE material, each with any number of instances (three.js `BatchedMesh`).
 * Register geometries with {@link addGeometry}, instantiate them with {@link addInstance}, then move / hide / re-geometry / delete
 * instances freely. Instance ids are stable and reused after deletion.
 *
 * Rendering: the renderer groups instances by (mesh, material), so the draw count is the number of DISTINCT geometries in view, not the
 * number of instances; all meshes live in the shared vertex / index arenas, so no buffers are switched between those draws.
 */
export class BatchedMesh {
  /** The group entity (index) parenting every instance. */
  readonly root: number;
  readonly material: number;
  readonly maxInstances: number;
  private flags: number;
  private geometries: number[] = [];
  private handles: number[] = [];       // per instance id: entity handle, or -1 when the id is free
  private indices: number[] = [];       // per instance id: entity index, or -1
  private geometryOf: number[] = [];
  private free: number[] = [];
  private live = 0;
  private disposed = false;

  constructor(private world: World, private meshes: MeshManager, o: BatchedMeshOptions) {
    this.material = o.material;
    this.maxInstances = o.maxInstances ?? 1_000_000;
    this.flags = o.flags ?? (RenderFlags.CastShadow | RenderFlags.ReceiveShadow);
    this.root = createGroup(world, o);
  }

  /** Number of live instances. */
  get instanceCount(): number { return this.live; }
  /** Number of registered geometries. */
  get geometryCount(): number { return this.geometries.length; }
  /** Entity index of instance `id` (-1 if it was deleted). */
  entityAt(id: number): number { return this.indices[id] ?? -1; }
  /** The geometry id currently used by instance `id`. */
  geometryAt(id: number): number { return this.geometryOf[id]; }

  /** Register a mesh (id from `renderer.meshes.create`) as a geometry of this batch. Returns the geometry id. Re-registering a mesh returns its existing id. */
  addGeometry(mesh: number): number {
    const k = this.geometries.indexOf(mesh);
    if (k >= 0) return k;
    this.meshes.get(mesh);                         // throws early on an unknown id
    this.geometries.push(mesh);
    return this.geometries.length - 1;
  }

  /** Create an instance of `geometryId` at the given local TRS (default identity). Returns the instance id. */
  addInstance(geometryId: number, trs: { position?: readonly [number, number, number]; rotation?: readonly [number, number, number, number]; scale?: number | readonly [number, number, number] } = {}): number {
    if (this.live >= this.maxInstances) throw new Error(`BatchedMesh: maxInstances (${this.maxInstances}) reached`);
    const mesh = this.geometries[geometryId];
    if (mesh === undefined) throw new Error(`BatchedMesh: unknown geometry ${geometryId}`);
    const w = this.world, b = this.meshes.get(mesh).bounds;
    const h = w.create(), e = entityIndex(h);
    const p = trs.position ?? [0, 0, 0];
    w.transforms.add(e, p[0], p[1], p[2]);
    if (trs.rotation) w.transforms.setRotation(e, trs.rotation[0], trs.rotation[1], trs.rotation[2], trs.rotation[3]);
    if (trs.scale !== undefined) {
      const s = typeof trs.scale === 'number' ? [trs.scale, trs.scale, trs.scale] as const : trs.scale;
      w.transforms.setScale(e, s[0], s[1], s[2]);
    }
    w.transforms.setParent(e, this.root);
    w.meshRenderers.add(e, mesh, this.material, this.flags);
    w.bounds.add(e, b[0], b[1], b[2], b[3], b[4], b[5]);
    const id = this.free.length > 0 ? this.free.pop()! : this.handles.length;
    this.handles[id] = h; this.indices[id] = e; this.geometryOf[id] = geometryId;
    this.live++;
    return id;
  }

  /** Destroy instance `id`; the id may be handed out again by a later `addInstance`. */
  deleteInstance(id: number): void {
    const h = this.handles[id];
    if (h === undefined || h < 0) return;
    this.world.destroy(h);
    this.handles[id] = -1; this.indices[id] = -1;
    this.free.push(id);
    this.live--;
  }

  /** Switch instance `id` to another registered geometry (its bounds follow). */
  setGeometryAt(id: number, geometryId: number): void {
    const e = this.indices[id], mesh = this.geometries[geometryId];
    if (e < 0 || mesh === undefined) throw new Error(`BatchedMesh: bad instance ${id} or geometry ${geometryId}`);
    const w = this.world, b = this.meshes.get(mesh).bounds;
    w.meshRenderers.meshId[e] = mesh;
    const L = w.bounds.local;
    for (let k = 0; k < 6; k++) L[e * 6 + k] = b[k];
    w.transforms.markDirty(e);                     // recompute the world bounds
    this.geometryOf[id] = geometryId;
  }

  /** Show or hide instance `id`. */
  setVisibleAt(id: number, visible: boolean): void {
    const mr = this.world.meshRenderers, e = this.indices[id];
    mr.flags[e] = visible ? (mr.flags[e] & ~RenderFlags.Hidden) : (mr.flags[e] | RenderFlags.Hidden);
  }

  setTRSAt(id: number, px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number, sx: number, sy: number, sz: number): void {
    const t = this.world.transforms, e = this.indices[id];
    t.setPosition(e, px, py, pz); t.setRotation(e, qx, qy, qz, qw); t.setScale(e, sx, sy, sz);
  }

  setPositionAt(id: number, x: number, y: number, z: number): void { this.world.transforms.setPosition(this.indices[id], x, y, z); }
  setRotationAt(id: number, x: number, y: number, z: number, w: number): void { this.world.transforms.setRotation(this.indices[id], x, y, z, w); }
  setScaleAt(id: number, x: number, y: number, z: number): void { this.world.transforms.setScale(this.indices[id], x, y, z); }

  /** Set instance `id` from a 4x4 column-major matrix (relative to the group). */
  setMatrixAt(id: number, m: ArrayLike<number>, off = 0): void {
    Mat4.decompose(m as Float32Array, TMP_P, TMP_Q, TMP_S, off);
    this.setTRSAt(id, TMP_P[0], TMP_P[1], TMP_P[2], TMP_Q[0], TMP_Q[1], TMP_Q[2], TMP_Q[3], TMP_S[0], TMP_S[1], TMP_S[2]);
  }

  /** The local matrix of instance `id`. */
  getMatrixAt(id: number, out: Float32Array = new Float32Array(16)): Float32Array {
    const t = this.world.transforms, e = this.indices[id];
    return Mat4.compose(out, t.positionX[e], t.positionY[e], t.positionZ[e], t.rotationX[e], t.rotationY[e], t.rotationZ[e], t.rotationW[e], t.scaleX[e], t.scaleY[e], t.scaleZ[e]) as Float32Array;
  }

  /** Destroy every instance and the group. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let id = 0; id < this.handles.length; id++) this.deleteInstance(id);
    const g = this.world.entities.handleOf(this.root);
    if (g >= 0) this.world.destroy(g);
  }
}
