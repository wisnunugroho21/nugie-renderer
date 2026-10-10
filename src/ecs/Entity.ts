/** Entity id = generation (high 11 bits) << 20 | index (low 20 bits). Numeric for speed. */
export type Entity = number;

export const INDEX_BITS = 20;
export const INDEX_MASK = (1 << INDEX_BITS) - 1;
export const MAX_ENTITIES = 1 << INDEX_BITS;
const GEN_MASK = (1 << 11) - 1;

/** Slot index (low 20 bits) of an entity id; this is what every component store is indexed by. */
export const entityIndex = (e: Entity): number => e & INDEX_MASK;
/** Generation counter (high bits) of an entity id; it changes every time the slot is reused, exposing stale handles. */
export const entityGeneration = (e: Entity): number => (e >>> INDEX_BITS) & GEN_MASK;
export const NULL_ENTITY: Entity = -1;

/** Hands out and recycles entity ids; each slot carries a generation so destroyed handles are detected. */
export class EntityManager {
  private generations = new Uint16Array(1024);
  private alive = new Uint8Array(1024);
  private freeList: number[] = [];
  private next = 0;
  aliveCount = 0;

  /** Highest index ever handed out + 1. */
  get capacity(): number { return this.next; }

  /** Allocate an entity (reusing a freed slot when possible) and return its generational id. Throws past MAX_ENTITIES. */
  create(): Entity {
    let idx: number;
    if (this.freeList.length > 0) idx = this.freeList.pop()!;
    else {
      if (this.next >= MAX_ENTITIES) throw new Error('Entity limit reached');
      idx = this.next++;
      if (idx >= this.generations.length) {
        const g = new Uint16Array(this.generations.length * 2); g.set(this.generations); this.generations = g;
        const a = new Uint8Array(this.alive.length * 2); a.set(this.alive); this.alive = a;
      }
    }
    this.alive[idx] = 1;
    this.aliveCount++;
    return ((this.generations[idx] & GEN_MASK) << INDEX_BITS) | idx;
  }

  /** Free the entity's slot and bump its generation. Returns false if the handle was already stale. */
  destroy(e: Entity): boolean {
    if (!this.isAlive(e)) return false;
    const idx = entityIndex(e);
    this.alive[idx] = 0;
    this.generations[idx] = (this.generations[idx] + 1) & GEN_MASK;
    this.freeList.push(idx);
    this.aliveCount--;
    return true;
  }

  /** The current handle of the live entity in slot `index` (or -1 if the slot is free). Lets index-based code destroy entities. */
  handleOf(index: number): Entity {
    if (!Number.isInteger(index) || index < 0 || index >= this.next || this.alive[index] !== 1) return NULL_ENTITY;
    return ((this.generations[index] & GEN_MASK) << INDEX_BITS) | index;
  }

  /** True if `e` refers to a live entity (index in range, slot occupied, generation matches). */
  isAlive(e: Entity): boolean {
    if (!Number.isInteger(e) || e < 0 || e > 0x7fffffff) return false;
    const idx = entityIndex(e);
    return idx < this.next && this.alive[idx] === 1 && (this.generations[idx] & GEN_MASK) === entityGeneration(e);
  }
}
