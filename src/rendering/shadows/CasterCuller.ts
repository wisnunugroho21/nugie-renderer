import type { Frustum } from '../../math/Frustum';
import type { RenderWorld } from '../RenderWorld';
import { RenderFlags } from '../../ecs/components/MeshRendererStore';
import { BVH } from '../../visibility/BVH';

/**
 * Finds the shadow casters inside a light's frustum. Static objects (`RenderFlags.Static`) go through a flat BVH that is rebuilt only
 * when `rw.structureVersion` changes; dynamic ones are tested linearly by bounding sphere. A frame culls once per shadow layer (a sun
 * has four cascades, a point light six faces), so skipping most of a large static world matters. The `CastShadow` flag is checked at
 * query time, so toggling it never needs a rebuild.
 */
export class CasterCuller {
  /** Slots of the casters found by the last {@link cull}; the first `count` entries are valid. */
  slots = new Uint32Array(0);
  count = 0;
  /** Number of times the BVH was rebuilt (for tests and diagnostics). */
  bvhRebuilds = 0;

  private bvh: BVH | null = null;
  private bvhVersion = -1;
  private bvhCount = -1;
  private dynamicIds = new Uint32Array(0);
  private hits = new Uint32Array(0);

  /** Collect the casters of `rw` whose bounds intersect `frustum` into {@link slots}. */
  cull(rw: RenderWorld, frustum: Frustum): void {
    if (this.bvhVersion !== rw.structureVersion || this.bvhCount !== rw.count || !this.bvh) this.rebuild(rw);
    const need = rw.count;
    if (this.slots.length < need) this.slots = new Uint32Array(Math.max(need, this.slots.length * 2, 256));
    if (this.hits.length < need) this.hits = new Uint32Array(Math.max(need, this.hits.length * 2, 256));
    const flags = rw.flags, out = this.slots;
    let c = 0;
    const found = this.bvh!.cull(frustum, this.hits, 0);
    for (let k = 0; k < found; k++) {
      const slot = this.hits[k];
      if ((flags[slot] & RenderFlags.CastShadow) !== 0) out[c++] = slot;
    }
    const s = rw.boundsSphere, p = frustum.planes, dyn = this.dynamicIds;
    for (let k = 0; k < dyn.length; k++) {
      const i = dyn[k];
      if ((flags[i] & RenderFlags.CastShadow) === 0) continue;
      const o = i * 4, x = s[o], y = s[o + 1], z = s[o + 2], nr = -s[o + 3];
      let inside = true;
      for (let pl = 0; pl < 24; pl += 4) {
        if (p[pl] * x + p[pl + 1] * y + p[pl + 2] * z + p[pl + 3] < nr) { inside = false; break; }
      }
      if (inside) out[c++] = i;
    }
    this.count = c;
  }

  /** Rebuild the static BVH and the dynamic id list. */
  private rebuild(rw: RenderWorld): void {
    const st: number[] = [], dyn: number[] = [];
    for (let i = 0; i < rw.count; i++) ((rw.flags[i] & RenderFlags.Static) !== 0 ? st : dyn).push(i);
    this.dynamicIds = Uint32Array.from(dyn);
    this.bvh = BVH.build(Uint32Array.from(st), rw.boundsAABB, (id) => id * 6);
    this.bvhVersion = rw.structureVersion;
    this.bvhCount = rw.count;
    this.bvhRebuilds++;
  }
}
