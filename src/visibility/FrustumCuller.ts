import type { Frustum } from '../math/Frustum';
import type { RenderWorld } from '../rendering/RenderWorld';

export type CullShape = 'sphere' | 'aabb';

/** Linear (per-object) CPU frustum culling over RenderWorld bounds. */
export class FrustumCuller {
  visible = new Uint32Array(0);
  count = 0;
  /** Metrics for the last cull(). */
  tested = 0;
  rejected = 0;
  ms = 0;

  /** Fill `visible` with the slots of all objects whose bounding sphere (or AABB) intersects `frustum`, and record the cost. */
  cull(rw: RenderWorld, frustum: Frustum, shape: CullShape = 'sphere'): void {
    const t0 = performance.now();
    const n = rw.count;
    if (this.visible.length < n) this.visible = new Uint32Array(Math.max(n, this.visible.length * 2, 256));
    const out = this.visible;
    let c = 0;
    const p = frustum.planes;

    if (shape === 'sphere') {
      const s = rw.boundsSphere;
      const p0 = p[0], p1 = p[1], p2 = p[2], p3 = p[3], p4 = p[4], p5 = p[5], p6 = p[6], p7 = p[7],
        p8 = p[8], p9 = p[9], p10 = p[10], p11 = p[11], p12 = p[12], p13 = p[13], p14 = p[14], p15 = p[15],
        p16 = p[16], p17 = p[17], p18 = p[18], p19 = p[19], p20 = p[20], p21 = p[21], p22 = p[22], p23 = p[23];
      for (let i = 0; i < n; i++) {
        const o = i * 4, x = s[o], y = s[o + 1], z = s[o + 2], nr = -s[o + 3];
        if (p0 * x + p1 * y + p2 * z + p3 < nr) continue;
        if (p4 * x + p5 * y + p6 * z + p7 < nr) continue;
        if (p8 * x + p9 * y + p10 * z + p11 < nr) continue;
        if (p12 * x + p13 * y + p14 * z + p15 < nr) continue;
        if (p16 * x + p17 * y + p18 * z + p19 < nr) continue;
        if (p20 * x + p21 * y + p22 * z + p23 < nr) continue;
        out[c++] = i;
      }
    } else {
      const b = rw.boundsAABB;
      for (let i = 0; i < n; i++) if (frustum.intersectsAABB(b, i * 6)) out[c++] = i;
    }
    this.count = c;
    this.tested = n;
    this.rejected = n - c;
    this.ms = performance.now() - t0;
  }
}
