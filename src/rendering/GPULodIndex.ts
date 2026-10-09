import type { LODLibrary } from '../visibility/LODSystem';
import type { GPULodGroup } from './GPUCuller';

/** Finds the LOD group a mesh belongs to (through any of its levels) for GPU LOD selection; the lookup table is rebuilt when groups are added. */
export class GPULodIndex {
  private byMesh = new Map<number, GPULodGroup>();
  private groupCount = -1;

  constructor(private library: LODLibrary) {}

  /** LOD group that `meshId` belongs to, or null. */
  groupOf(meshId: number): GPULodGroup | null {
    const groups = this.library.groups;
    if (groups.length !== this.groupCount) {
      this.byMesh.clear();
      for (const g of groups) for (const l of g.levels) if (!this.byMesh.has(l.meshId)) this.byMesh.set(l.meshId, g);
      this.groupCount = groups.length;
    }
    return this.byMesh.get(meshId) ?? null;
  }
}
