import { describe, expect, it } from 'vitest';
import { RenderWorld } from '../src/rendering/RenderWorld';
import { CasterCuller } from '../src/rendering/shadows/CasterCuller';
import { FrustumCuller } from '../src/visibility/FrustumCuller';
import { Frustum } from '../src/math/Frustum';
import { Mat4 } from '../src/math/Mat4';
import { RenderFlags } from '../src/ecs/components/MeshRendererStore';

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** Random boxes; about `staticFraction` are static and about 75% cast shadows. */
function scene(n: number, staticFraction: number, seed = 5): RenderWorld {
  const r = rng(seed), rw = new RenderWorld();
  rw.ensureCapacity(n); rw.count = n;
  for (let i = 0; i < n; i++) {
    const cx = (r() - 0.5) * 300, cy = (r() - 0.5) * 300, cz = (r() - 0.5) * 300, h = 0.3 + r();
    rw.boundsAABB.set([cx - h, cy - h, cz - h, cx + h, cy + h, cz + h], i * 6);
    rw.boundsSphere.set([cx, cy, cz, h * Math.sqrt(3)], i * 4);
    rw.flags[i] = (r() < staticFraction ? RenderFlags.Static : 0) | (r() < 0.75 ? RenderFlags.CastShadow : 0);
  }
  return rw;
}

function frustumAt(ex: number, ey: number, ez: number): Frustum {
  const f = new Frustum();
  const view = Mat4.lookAt(Mat4.create(), ex, ey, ez, 0, 0, 0);
  f.setFromViewProjection(Mat4.multiply(Mat4.create(), Mat4.perspective(Mat4.create(), Math.PI / 3, 1.5, 0.1, 160), view));
  return f;
}

const slotsOf = (c: CasterCuller) => new Set(Array.from({ length: c.count }, (_, i) => c.slots[i]));

describe('CasterCuller', () => {
  it('finds exactly the shadow casters a linear cull finds when nothing is static', () => {
    const rw = scene(3000, 0), f = frustumAt(0, 0, 140);
    const caster = new CasterCuller(), linear = new FrustumCuller();
    caster.cull(rw, f); linear.cull(rw, f, 'sphere');
    const expected = new Set<number>();
    for (let i = 0; i < linear.count; i++) if (rw.flags[linear.visible[i]] & RenderFlags.CastShadow) expected.add(linear.visible[i]);
    expect(slotsOf(caster)).toEqual(expected);
    expect(caster.count).toBeGreaterThan(0);
  });

  it('with static objects: only casters, never more than the linear result, and every caster whose centre is in view', () => {
    const rw = scene(4000, 0.7), f = frustumAt(30, 10, 120);
    const caster = new CasterCuller(), linear = new FrustumCuller();
    caster.cull(rw, f); linear.cull(rw, f, 'sphere');
    const found = slotsOf(caster), sphereVisible = asSet(linear);
    for (const slot of found) {
      expect(rw.flags[slot] & RenderFlags.CastShadow).not.toBe(0);
      expect(sphereVisible.has(slot)).toBe(true);
    }
    for (let i = 0; i < rw.count; i++) {
      if (!(rw.flags[i] & RenderFlags.CastShadow)) continue;
      const o = i * 4, x = rw.boundsSphere[o], y = rw.boundsSphere[o + 1], z = rw.boundsSphere[o + 2];
      let inside = true;
      for (let p = 0; p < 24; p += 4) if (f.planes[p] * x + f.planes[p + 1] * y + f.planes[p + 2] * z + f.planes[p + 3] < 0) { inside = false; break; }
      if (inside) expect(found.has(i)).toBe(true);
    }
  });

  it('rebuilds the BVH only when the structure changes, and picks up CastShadow changes without a rebuild', () => {
    const rw = scene(500, 1), f = frustumAt(0, 0, 100), c = new CasterCuller();
    c.cull(rw, f); c.cull(rw, f);
    expect(c.bvhRebuilds).toBe(1);
    const before = c.count;
    expect(before).toBeGreaterThan(0);
    for (let i = 0; i < rw.count; i++) rw.flags[i] &= ~RenderFlags.CastShadow;
    c.cull(rw, f);
    expect(c.count).toBe(0);
    expect(c.bvhRebuilds).toBe(1);
    rw.structureVersion++;
    c.cull(rw, f);
    expect(c.bvhRebuilds).toBe(2);
  });

  it('handles an empty world', () => {
    const rw = new RenderWorld(), c = new CasterCuller();
    c.cull(rw, frustumAt(0, 0, 10));
    expect(c.count).toBe(0);
  });
});

function asSet(c: FrustumCuller): Set<number> { return new Set(Array.from({ length: c.count }, (_, i) => c.visible[i])); }
