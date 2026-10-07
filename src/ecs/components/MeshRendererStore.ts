import { ComponentStore, growI32, growU32 } from '../ComponentStore';

export const enum RenderFlags {
  None = 0,
  CastShadow = 1 << 0,
  ReceiveShadow = 1 << 1,
  Static = 1 << 2,
  Hidden = 1 << 3,
}

export class MeshRendererStore extends ComponentStore {
  meshId = new Int32Array(0);
  materialId = new Int32Array(0);
  flags = new Uint32Array(0);
  /** Entity index owning this renderer's morph weights (-1 = none). Multi-primitive meshes share their node's state. */
  morphOwner = new Int32Array(0);
  /** Entity index owning this renderer's skin/skeleton instance (-1 = none). */
  skinOwner = new Int32Array(0);

  protected grow(n: number): void {
    this.meshId = growI32(this.meshId, n); this.materialId = growI32(this.materialId, n); this.flags = growU32(this.flags, n);
    this.morphOwner = growI32(this.morphOwner, n, -1); this.skinOwner = growI32(this.skinOwner, n, -1);
  }
  protected reset(i: number): void { this.meshId[i] = 0; this.materialId[i] = 0; this.flags[i] = 0; this.morphOwner[i] = -1; this.skinOwner[i] = -1; }

  add(i: number, meshId: number, materialId: number, flags: number = RenderFlags.CastShadow | RenderFlags.ReceiveShadow): void {
    this.ensureCapacity(i + 1);
    this.has.set(i);
    this.meshId[i] = meshId; this.materialId[i] = materialId; this.flags[i] = flags;
    this.morphOwner[i] = -1; this.skinOwner[i] = -1;
  }
}
