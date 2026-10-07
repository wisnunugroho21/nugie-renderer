import { describe, expect, it } from 'vitest';
import { RenderWorld } from '../src/rendering/RenderWorld';
import { FrustumCuller } from '../src/visibility/FrustumCuller';
import { BVH } from '../src/visibility/BVH';
import { VisibilitySystem } from '../src/visibility/VisibilitySystem';
import { Frustum } from '../src/math/Frustum';
import { Mat4 } from '../src/math/Mat4';
import { RenderFlags } from '../src/ecs/components/MeshRendererStore';

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** RenderWorld of random unit-ish boxes with matching spheres. */
function scene(n: number, extent = 200, seed = 3, staticFraction = 0): RenderWorld {
  const r = rng(seed);
  const rw = new RenderWorld();
  rw.ensureCapacity(n); rw.count = n;
  for (let i = 0; i < n; i++) {
    const cx = (r() - 0.5) * extent, cy = (r() - 0.5) * extent, cz = (r() - 0.5) * extent;
    const hx = 0.2 + r(), hy = 0.2 + r(), hz = 0.2 + r();
    rw.boundsAABB.set([cx - hx, cy - hy, cz - hz, cx + hx, cy + hy, cz + hz], i * 6);
    rw.boundsSphere.set([cx, cy, cz, Math.hypot(hx, hy, hz)], i * 4);
    rw.entityIndex[i] = i;
    rw.flags[i] = r() < staticFraction ? RenderFlags.Static : 0;
  }
  return rw;
}

function camera(rw: RenderWorld, ex: number, ey: number, ez: number, tx: number, ty: number, tz: number, fov = Math.PI / 3, far = 150) {
  const view = Mat4.lookAt(Mat4.create(), ex, ey, ez, tx, ty, tz);
  const proj = Mat4.perspective(Mat4.create(), fov, 16 / 9, 0.1, far);
  const vp = Mat4.multiply(Mat4.create(), proj, view);
  rw.camera.frustum.setFromViewProjection(vp);
  rw.camera.position.set([ex, ey, ez]);
  return rw.camera.frustum;
}

const asSet = (a: ArrayLike<number>, n: number) => new Set(Array.from({ length: n }, (_, i) => a[i]));

describe('FrustumCuller', () => {
  it('reports metrics: tested / rejected / visible', () => {
    const rw = scene(2000);
    const f = camera(rw, 0, 0, 120, 0, 0, 0);
    const c = new FrustumCuller();
    c.cull(rw, f);
    expect(c.tested).toBe(2000);
    expect(c.count + c.rejected).toBe(2000);
    expect(c.count).toBeGreaterThan(0);
    expect(c.rejected).toBeGreaterThan(0);
  });

  it('never culls an object whose center is inside the view volume (no false invisibles)', () => {
    const rw = scene(5000, 300, 11);
    const f = camera(rw, 10, 5, 100, 0, 0, 0);
    const c = new FrustumCuller();
    c.cull(rw, f);
    const vis = asSet(c.visible, c.count);
    const vp = Mat4.create();
    // rebuild VP identical to camera(): re-derive via planes check using clip-space oracle
    const view = Mat4.lookAt(Mat4.create(), 10, 5, 100, 0, 0, 0), proj = Mat4.perspective(Mat4.create(), Math.PI / 3, 16 / 9, 0.1, 150);
    Mat4.multiply(vp, proj, view);
    let inside = 0;
    for (let i = 0; i < rw.count; i++) {
      const x = rw.boundsSphere[i * 4], y = rw.boundsSphere[i * 4 + 1], z = rw.boundsSphere[i * 4 + 2];
      const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12], cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
      const cz = vp[2] * x + vp[6] * y + vp[10] * z + vp[14], w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      if (w > 0 && Math.abs(cx) < w && Math.abs(cy) < w && cz > 0 && cz < w) { inside++; expect(vis.has(i)).toBe(true); }
    }
    expect(inside).toBeGreaterThan(50);
  });

  it('sphere test is conservative w.r.t. exact AABB test (sphere visible ⊇ aabb visible)', () => {
    const rw = scene(4000, 250, 5);
    const f = camera(rw, -30, 20, 90, 5, 0, 0);
    const a = new FrustumCuller(), b = new FrustumCuller();
    a.cull(rw, f, 'sphere'); b.cull(rw, f, 'aabb');
    const sa = asSet(a.visible, a.count);
    for (let i = 0; i < b.count; i++) expect(sa.has(b.visible[i])).toBe(true);
    expect(a.count).toBeGreaterThanOrEqual(b.count);
  });

  it('infinite-bounds objects (no Bounds component) are never culled', () => {
    const rw = scene(3);
    rw.boundsSphere.set([0, 0, 0, Infinity], 0);
    const f = camera(rw, 0, 0, 10, 0, 0, 100);   // looking away from everything near origin
    const c = new FrustumCuller();
    c.cull(rw, f);
    expect(asSet(c.visible, c.count).has(0)).toBe(true);
  });

  it('everything behind the camera is rejected', () => {
    const rw = new RenderWorld(); rw.ensureCapacity(1); rw.count = 1;
    rw.boundsSphere.set([0, 0, 50, 1], 0); rw.boundsAABB.set([-1, -1, 49, 1, 1, 51], 0);
    const f = camera(rw, 0, 0, 10, 0, 0, 0); // looks toward -Z; object at z=50 is behind
    const c = new FrustumCuller(); c.cull(rw, f);
    expect(c.count).toBe(0);
  });
});

describe('BVH', () => {
  it('builds a valid tree: every id appears exactly once, bounds enclose children', () => {
    const rw = scene(3000, 400, 21);
    const ids = Uint32Array.from({ length: 3000 }, (_, i) => i);
    const bvh = BVH.build(ids, rw.boundsAABB, (id) => id * 6);
    expect(Array.from(bvh.order).sort((a, b) => a - b)).toEqual(Array.from(ids));
    const b = bvh.bounds;
    for (let n = 0; n < bvh.nodeCount; n++) {
      if (bvh.count[n] === 0) {
        for (const ch of [bvh.first[n], bvh.first[n] + 1]) {
          for (let k = 0; k < 3; k++) { expect(b[ch * 6 + k]).toBeGreaterThanOrEqual(b[n * 6 + k] - 1e-4); expect(b[ch * 6 + 3 + k]).toBeLessThanOrEqual(b[n * 6 + 3 + k] + 1e-4); }
        }
      } else {
        for (let k = bvh.first[n]; k < bvh.first[n] + bvh.count[n]; k++) {
          const o = bvh.order[k] * 6;
          for (let a = 0; a < 3; a++) { expect(rw.boundsAABB[o + a]).toBeGreaterThanOrEqual(b[n * 6 + a] - 1e-4); expect(rw.boundsAABB[o + 3 + a]).toBeLessThanOrEqual(b[n * 6 + 3 + a] + 1e-4); }
        }
      }
    }
    expect(bvh.depth()).toBeLessThan(24); // balanced-ish for 3000 objects
  });

  it('cull result == linear AABB cull for many random frusta (exactness)', () => {
    const rw = scene(4000, 300, 33);
    const ids = Uint32Array.from({ length: 4000 }, (_, i) => i);
    const bvh = BVH.build(ids, rw.boundsAABB, (id) => id * 6);
    const lin = new FrustumCuller();
    const r = rng(77);
    const out = new Uint32Array(4000);
    for (let t = 0; t < 40; t++) {
      const f = camera(rw, (r() - 0.5) * 300, (r() - 0.5) * 300, (r() - 0.5) * 300, (r() - 0.5) * 50, (r() - 0.5) * 50, (r() - 0.5) * 50,
        0.4 + r() * 1.2, 50 + r() * 400);
      lin.cull(rw, f, 'aabb');
      const n = bvh.cull(f, out);
      expect(asSet(out, n)).toEqual(asSet(lin.visible, lin.count));
      expect(n).toBe(lin.count); // no duplicates
    }
  });

  it('visits far fewer nodes than objects when most of the scene is outside', () => {
    const rw = scene(20000, 1000, 9);
    const ids = Uint32Array.from({ length: 20000 }, (_, i) => i);
    const bvh = BVH.build(ids, rw.boundsAABB, (id) => id * 6);
    const f = camera(rw, 0, 0, 600, 0, 0, 0, 0.3, 300);
    const out = new Uint32Array(20000);
    bvh.cull(f, out);
    expect(bvh.nodesVisited).toBeLessThan(20000 / 4);
  });

  it('empty and single-element trees work', () => {
    const rw = scene(1, 10, 1);
    const f = camera(rw, 0, 0, 30, 0, 0, 0);
    expect(BVH.build(new Uint32Array(0), rw.boundsAABB, (i) => i * 6).cull(f, new Uint32Array(4))).toBe(0);
    const one = BVH.build(Uint32Array.from([0]), rw.boundsAABB, (i) => i * 6);
    expect(one.cull(f, new Uint32Array(4))).toBe(1);
  });

  it('coincident objects do not cause infinite recursion', () => {
    const rw = new RenderWorld(); rw.ensureCapacity(100); rw.count = 100;
    for (let i = 0; i < 100; i++) rw.boundsAABB.set([0, 0, 0, 1, 1, 1], i * 6);
    const bvh = BVH.build(Uint32Array.from({ length: 100 }, (_, i) => i), rw.boundsAABB, (i) => i * 6);
    const f = camera(rw, 0, 0, 10, 0, 0, 0);
    expect(bvh.cull(f, new Uint32Array(100))).toBe(100);
  });
});

describe('VisibilitySystem', () => {
  it("modes agree: bvh (static+dynamic) == linear AABB-exact set ⊆ linear sphere set", () => {
    const rw = scene(6000, 300, 41, 0.7);
    camera(rw, 20, 10, 110, 0, 0, 0);
    const vs = new VisibilitySystem();
    vs.mode = 'bvh';
    const b = vs.update(rw);
    const bvhSet = asSet(b.slots!, b.count);
    expect(bvhSet.size).toBe(b.count);
    const exact = new FrustumCuller(); exact.cull(rw, rw.camera.frustum, 'aabb');
    // static objects are exact (AABB); dynamic ones use spheres => superset of the exact set
    for (let i = 0; i < exact.count; i++) expect(bvhSet.has(exact.visible[i])).toBe(true);
    const sph = new FrustumCuller(); sph.cull(rw, rw.camera.frustum, 'sphere');
    const sphSet = asSet(sph.visible, sph.count);
    for (const i of bvhSet) expect(sphSet.has(i) || (rw.flags[i] & RenderFlags.Static) !== 0).toBe(true);
  });

  it('BVH is rebuilt only when the object set changes', () => {
    const rw = scene(500, 100, 2, 1);
    camera(rw, 0, 0, 80, 0, 0, 0);
    const vs = new VisibilitySystem(); vs.mode = 'bvh';
    vs.update(rw); vs.update(rw); vs.update(rw);
    expect(vs.bvhRebuilds).toBe(1);
    rw.structureVersion++;
    vs.update(rw);
    expect(vs.bvhRebuilds).toBe(2);
  });

  it("'none' returns everyone, 'linear' reports metrics", () => {
    const rw = scene(1000, 400, 4);
    camera(rw, 0, 0, 200, 0, 0, 0);
    const vs = new VisibilitySystem();
    vs.mode = 'none';
    expect(vs.update(rw).count).toBe(1000);
    vs.mode = 'linear';
    const r = vs.update(rw);
    expect(r.tested).toBe(1000);
    expect(r.count + r.rejected!).toBe(1000);
  });
});

describe('Frustum plane extraction sanity (shared)', () => {
  it('AABB straddling a plane is kept', () => {
    const vp = Mat4.multiply(Mat4.create(), Mat4.perspective(Mat4.create(), Math.PI / 2, 1, 1, 100), Mat4.lookAt(Mat4.create(), 0, 0, 0, 0, 0, -1));
    const f = new Frustum().setFromViewProjection(vp);
    expect(f.intersectsAABB([-20, -1, -11, -5, 1, -9])).toBe(true); // crosses the left plane
  });
});
