/** Entity id = generation (high 11 bits) << 20 | index (low 20 bits). Numeric for speed. */
export type Entity = number;

export const INDEX_BITS = 20;
export const INDEX_MASK = (1 << INDEX_BITS) - 1;
export const MAX_ENTITIES = 1 << INDEX_BITS;
const GEN_MASK = (1 << 11) - 1;

export const entityIndex = (e: Entity): number => e & INDEX_MASK;
export const entityGeneration = (e: Entity): number => (e >>> INDEX_BITS) & GEN_MASK;
export const NULL_ENTITY: Entity = -1;

export class EntityManager {
  private generations = new Uint16Array(1024);
  private alive = new Uint8Array(1024);
  private freeList: number[] = [];
  private next = 0;
  aliveCount = 0;

  /** Highest index ever handed out + 1. */
  get capacity(): number { return this.next; }

  create(): Entity {
    let idx: number;
    if (this.freeList.length > 0) idx = this.freeList.pop()!;
    else {
      idx = this.next++;
      if (idx >= MAX_ENTITIES) throw new Error('Entity limit reached');
      if (idx >= this.generations.length) {
        const g = new Uint16Array(this.generations.length * 2); g.set(this.generations); this.generations = g;
        const a = new Uint8Array(this.alive.length * 2); a.set(this.alive); this.alive = a;
      }
    }
    this.alive[idx] = 1;
    this.aliveCount++;
    return ((this.generations[idx] & GEN_MASK) << INDEX_BITS) | idx;
  }

  destroy(e: Entity): boolean {
    if (!this.isAlive(e)) return false;
    const idx = entityIndex(e);
    this.alive[idx] = 0;
    this.generations[idx] = (this.generations[idx] + 1) & GEN_MASK;
    this.freeList.push(idx);
    this.aliveCount--;
    return true;
  }

  isAlive(e: Entity): boolean {
    if (e < 0) return false;
    const idx = entityIndex(e);
    return idx < this.next && this.alive[idx] === 1 && (this.generations[idx] & GEN_MASK) === entityGeneration(e);
  }
}
