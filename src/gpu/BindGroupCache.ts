import type { GPUStats } from './GPUStats';

/** Caches bind groups by a caller-supplied key (layout id + resource ids). */
export class BindGroupCache {
  private cache = new Map<string, GPUBindGroup>();

  /** Create an empty cache that reports hits / misses to `stats`. */
  constructor(private stats: GPUStats) {}

  /** Return the bind group for `key`, calling `create` (once) on a miss. */
  get(key: string, create: () => GPUBindGroup): GPUBindGroup {
    const hit = this.cache.get(key);
    if (hit) { this.stats.bindGroupHits++; return hit; }
    this.stats.bindGroupMisses++;
    const bg = create();
    this.cache.set(key, bg);
    this.stats.bindGroups = this.cache.size;
    return bg;
  }

  /** Drop entries whose key contains the given resource id (call when a resource is destroyed/resized). */
  invalidate(resourceId: string): void {
    for (const k of this.cache.keys()) if (k.includes(resourceId)) this.cache.delete(k);
    this.stats.bindGroups = this.cache.size;
  }

  /** Drop every cached bind group. */
  clear(): void { this.cache.clear(); this.stats.bindGroups = 0; }
}
