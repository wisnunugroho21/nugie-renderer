import type { RenderWorld } from '../rendering/RenderWorld';
import { RenderFlags } from '../ecs/components/MeshRendererStore';
import { FrustumCuller } from './FrustumCuller';
import { BVH } from './BVH';

export type CullMode = 'none' | 'linear' | 'bvh';

export interface VisibleSet {
  slots: Uint32Array | null;
  count: number;
  tested?: number;
  rejected?: number;
  cullMs?: number;
}

/**
 * Chooses the CPU visibility strategy.
 *  - none   : everything is visible (baseline)
 *  - linear : per-object bounding-sphere test
 *  - bvh    : static objects (RenderFlags.Static) through a flat BVH, dynamic objects linearly
 * The BVH is rebuilt only when the object set changes (rw.structureVersion). Static objects must
 * not move; moving a static object requires clearing its Static flag.
 */
export class VisibilitySystem {
  mode: CullMode = 'linear';
  readonly result: VisibleSet = { slots: null, count: 0 };
  bvhRebuilds = 0;

  private linear = new FrustumCuller();
  private bvh: BVH | null = null;
  private bvhVersion = -1;
  private staticIds = new Uint32Array(0);
  private dynamicIds = new Uint32Array(0);
  private out = new Uint32Array(0);
  /** Per-slot byte: 1 if static (BVH-managed). */
  private isStatic = new Uint8Array(0);

  update(rw: RenderWorld): VisibleSet {
    const r = this.result;
    if (this.mode === 'none') {
      r.slots = null; r.count = rw.count; r.tested = 0; r.rejected = 0; r.cullMs = 0;
      return r;
    }
    const frustum = rw.camera.frustum;
    if (this.mode === 'linear') {
      this.linear.cull(rw, frustum, 'sphere');
      r.slots = this.linear.visible; r.count = this.linear.count;
      r.tested = this.linear.tested; r.rejected = this.linear.rejected; r.cullMs = this.linear.ms;
      return r;
    }

    const t0 = performance.now();
    if (this.bvhVersion !== rw.structureVersion || !this.bvh) this.rebuild(rw);
    if (this.out.length < rw.count) this.out = new Uint32Array(Math.max(rw.count, this.out.length * 2, 256));
    let c = this.bvh!.cull(frustum, this.out, 0);

    // Dynamic objects: linear sphere test.
    const s = rw.boundsSphere, p = frustum.planes;
    for (let k = 0; k < this.dynamicIds.length; k++) {
      const i = this.dynamicIds[k];
      const o = i * 4, x = s[o], y = s[o + 1], z = s[o + 2], nr = -s[o + 3];
      let inside = true;
      for (let pl = 0; pl < 24; pl += 4) {
        if (p[pl] * x + p[pl + 1] * y + p[pl + 2] * z + p[pl + 3] < nr) { inside = false; break; }
      }
      if (inside) this.out[c++] = i;
    }
    r.slots = this.out; r.count = c; r.tested = rw.count; r.rejected = rw.count - c; r.cullMs = performance.now() - t0;
    return r;
  }

  private rebuild(rw: RenderWorld): void {
    const n = rw.count;
    if (this.isStatic.length < n) this.isStatic = new Uint8Array(Math.max(n, this.isStatic.length * 2));
    const st: number[] = [], dyn: number[] = [];
    for (let i = 0; i < n; i++) {
      const isStatic = (rw.flags[i] & RenderFlags.Static) !== 0;
      this.isStatic[i] = isStatic ? 1 : 0;
      (isStatic ? st : dyn).push(i);
    }
    this.staticIds = Uint32Array.from(st);
    this.dynamicIds = Uint32Array.from(dyn);
    this.bvh = BVH.build(this.staticIds, rw.boundsAABB, (id) => id * 6);
    this.bvhVersion = rw.structureVersion;
    this.bvhRebuilds++;
  }

  get bvhNodes(): number { return this.bvh?.nodeCount ?? 0; }
}
