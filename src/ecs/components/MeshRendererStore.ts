import { ComponentStore, growI32, growU32 } from '../ComponentStore';

/** Per-renderer bit flags (combine with `|`). */
export enum RenderFlags {
  None = 0,
  CastShadow = 1 << 0,
  ReceiveShadow = 1 << 1,
  Static = 1 << 2,
  Hidden = 1 << 3,
}

/** What an entity draws: mesh id, material id and `RenderFlags`, plus links to the entities owning its skin / morph state. */
export class MeshRendererStore extends ComponentStore {
  meshId = new Int32Array(0);
  materialId = new Int32Array(0);
  flags = new Uint32Array(0);
  /** Entity index owning this renderer's morph weights (-1 = none). Multi-primitive meshes share their node's state. */
  /** Incremented every time a renderer is added (lets systems rescan only when something new appeared). */
  version = 0;
  morphOwner = new Int32Array(0);
  /** Entity index owning this renderer's skin/skeleton instance (-1 = none). */
  skinOwner = new Int32Array(0);

  /** Grow the mesh / material / flag arrays (owners default to -1 = none). */
  protected grow(n: number): void {
    this.meshId = growI32(this.meshId, n); this.materialId = growI32(this.materialId, n); this.flags = growU32(this.flags, n);
    this.morphOwner = growI32(this.morphOwner, n, -1); this.skinOwner = growI32(this.skinOwner, n, -1);
  }
  /** Zero the renderer's ids and flags. */
  protected reset(i: number): void { this.meshId[i] = 0; this.materialId[i] = 0; this.flags[i] = 0; this.morphOwner[i] = -1; this.skinOwner[i] = -1; }

  /** Make the entity draw mesh `meshId` with material `materialId` (default flags: casts and receives shadows). */
  add(i: number, meshId: number, materialId: number, flags: number = RenderFlags.CastShadow | RenderFlags.ReceiveShadow): void {
    this.ensureCapacity(i + 1);
    this.has.set(i);
    this.version++;
    this.meshId[i] = meshId; this.materialId[i] = materialId; this.flags[i] = flags;
    this.morphOwner[i] = -1; this.skinOwner[i] = -1;
  }
}
