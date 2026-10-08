import { ComponentStore, growI32 } from '../ComponentStore';

/** Assigns an entity's MeshRenderer to a LOD group (see LODLibrary). The mesh in MeshRenderer is the level-0 mesh. */
export class LODStore extends ComponentStore {
  group = new Int32Array(0);

  /** Grow the group array (new slots = -1, i.e. no LOD group). */
  protected grow(n: number): void { this.group = growI32(this.group, n, -1); }
  /** Clear the entity's LOD group assignment. */
  protected reset(i: number): void { this.group[i] = -1; }

  /** Put the entity's mesh renderer into LOD group `group` (an id from `LODLibrary.create`). */
  add(i: number, group: number): void {
    this.ensureCapacity(i + 1);
    this.has.set(i);
    this.group[i] = group;
  }
}
