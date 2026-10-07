import { ComponentStore, growI32 } from '../ComponentStore';
import type { SkeletonInstance } from '../../animation/Skeleton';

/**
 * Skin component: attaches a SkeletonInstance to the skinned mesh node (owner). Also maintains an
 * entity -> instances reverse index so the SkeletonSystem can find which skeletons are affected when a
 * joint (or the owner) transform changes, without scanning every skeleton.
 */
export class SkinStore extends ComponentStore {
  /** SkeletonInstance id per owner entity index (-1 = none). */
  instanceId = new Int32Array(0);
  instances: (SkeletonInstance | undefined)[] = [];
  aliveInstances = 0;

  onAdd: ((inst: SkeletonInstance) => void) | null = null;
  onRemove: ((inst: SkeletonInstance) => void) | null = null;

  // entity index -> linked list of instance ids that depend on that entity
  private head = new Int32Array(0);
  private linkNext = new Int32Array(256);
  private linkInst = new Int32Array(256);
  private linkCount = 0;

  protected grow(n: number): void {
    this.instanceId = growI32(this.instanceId, n, -1);
    this.head = growI32(this.head, n, -1);
  }

  protected reset(i: number): void {
    const id = this.instanceId[i];
    if (id >= 0) {
      const inst = this.instances[id];
      this.instances[id] = undefined;
      this.instanceId[i] = -1;
      this.aliveInstances--;
      if (inst) this.onRemove?.(inst);
    }
  }

  add(owner: number, inst: SkeletonInstance): number {
    this.ensureCapacity(owner + 1);
    for (const j of inst.jointEntities) this.ensureCapacity(j + 1);
    this.has.set(owner);
    const id = this.instances.length;
    inst.id = id;
    this.instances.push(inst);
    this.instanceId[owner] = id;
    this.aliveInstances++;
    this.link(owner, id);
    for (const j of inst.jointEntities) if (j !== owner) this.link(j, id);
    this.onAdd?.(inst);
    return id;
  }

  private link(entity: number, id: number): void {
    if (this.linkCount === this.linkNext.length) {
      const n = this.linkCount * 2;
      const a = new Int32Array(n); a.set(this.linkNext); this.linkNext = a;
      const b = new Int32Array(n); b.set(this.linkInst); this.linkInst = b;
    }
    const l = this.linkCount++;
    this.linkInst[l] = id; this.linkNext[l] = this.head[entity]; this.head[entity] = l;
  }

  /** Visit every live skeleton instance that depends on `entity` (joint or owner); prunes dead links. */
  forEachDependent(entity: number, cb: (inst: SkeletonInstance) => void): void {
    if (entity >= this.head.length) return;
    let prev = -1;
    for (let l = this.head[entity]; l !== -1;) {
      const next = this.linkNext[l];
      const inst = this.instances[this.linkInst[l]];
      if (inst) { cb(inst); prev = l; }
      else if (prev === -1) this.head[entity] = next;
      else this.linkNext[prev] = next;
      l = next;
    }
  }

  get(owner: number): SkeletonInstance | undefined {
    const id = owner < this.instanceId.length ? this.instanceId[owner] : -1;
    return id >= 0 ? this.instances[id] : undefined;
  }
}
