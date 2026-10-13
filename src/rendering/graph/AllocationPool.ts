/** A texture or buffer a technique instance allocated for one of its memory slots. */
export type Allocation = GPUTexture | GPUBuffer;

/**
 * The physical resources of technique instances, by slot key (see `Slot.key`: the same key describes the same allocation). An instance takes the allocation of each of its
 * slots from the pool and gives it back when it no longer needs it; an allocation is destroyed once nobody holds it. A pool private to one instance lets a recompile keep the
 * resources whose description did not change; a pool shared by instances that never execute at the same time (the cached plans of a {@link FrameGraph}) lets them share
 * their memory too, so switching between plans neither allocates nor loses the contents of persistent and exported resources.
 */
export class AllocationPool {
  private byKey = new Map<string, Allocation>();
  private holders = new Map<Allocation, number>();

  constructor(private destroy: (allocation: Allocation) => void) {}

  /** The allocation under `key` if `fits` accepts it, else a new one from `create` (which then becomes the one under `key`). The caller holds it until `release`. */
  acquire(key: string, fits: (allocation: Allocation) => boolean, create: () => Allocation): Allocation {
    let allocation = this.byKey.get(key);
    if (!allocation || !fits(allocation)) {
      allocation = create();
      this.byKey.set(key, allocation);
    }
    this.holders.set(allocation, (this.holders.get(allocation) ?? 0) + 1);
    return allocation;
  }

  /** Give back an allocation taken with `acquire`; the last holder destroys it. */
  release(allocation: Allocation): void {
    const n = (this.holders.get(allocation) ?? 0) - 1;
    if (n > 0) { this.holders.set(allocation, n); return; }
    this.holders.delete(allocation);
    for (const [key, a] of this.byKey) if (a === allocation) { this.byKey.delete(key); break; }
    this.destroy(allocation);
  }

  /** Allocations currently held (for statistics and tests). */
  get size(): number { return this.holders.size; }
}
