import { describe, expect, it } from 'vitest';
import { makeFakeGPU } from './helpers/fakeGPU';
import { LODLibrary, LODSystem, projectedSize, selectLevel, type LODLevel } from '../src/visibility/LODSystem';
import { RenderWorld } from '../src/rendering/RenderWorld';
import { RenderExtractor } from '../src/rendering/RenderExtractor';
import { TransformSystem } from '../src/ecs/systems/TransformSystem';
import { BoundsSystem } from '../src/ecs/systems/BoundsSystem';
import { entityIndex } from '../src/ecs/Entity';
import { STANDARD_VERTEX_FLOATS as F } from '../src/rendering/VertexLayouts';

const tri = () => ({ vertices: new Float32Array(3 * F), indices: Uint32Array.from([0, 1, 2]) });
const LEVELS: LODLevel[] = [{ meshId: 10, minScreenSize: 0.3 }, { meshId: 11, minScreenSize: 0.1 }, { meshId: 12, minScreenSize: 0.03 }];

describe('LODLibrary', () => {
  it('validates ordering and deformation compatibility', () => {
    const g = makeFakeGPU();
    const a = g.meshes.create('a', tri()), b = g.meshes.create('b', tri());
    const skinned = g.meshes.create('s', tri(), { joints0: new Uint16Array(12), weights0: Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]) });
    const lib = new LODLibrary(g.meshes);
    expect(lib.create({ levels: [{ meshId: a, minScreenSize: 0.3 }, { meshId: b, minScreenSize: 0.1 }] })).toBe(0);
    expect(() => lib.create({ levels: [] })).toThrow();
    expect(() => lib.create({ levels: [{ meshId: a, minScreenSize: 0.1 }, { meshId: b, minScreenSize: 0.3 }] })).toThrow(/decreasing/);
    expect(() => lib.create({ levels: [{ meshId: a, minScreenSize: 0.3 }, { meshId: skinned, minScreenSize: 0.1 }] })).toThrow(/deformation/);
  });
});

describe('projectedSize', () => {
  it('is the fraction of screen height covered by the bounding-sphere diameter', () => {
    expect(projectedSize(1, 10, Math.PI / 2)).toBeCloseTo(0.1, 6);               // fov 90 => tan(45) = 1
    expect(projectedSize(1, 20, Math.PI / 2)).toBeCloseTo(0.05, 6);              // twice as far => half the size
    expect(projectedSize(2, 10, Math.PI / 2)).toBeCloseTo(0.2, 6);               // twice as big => twice the size
    expect(projectedSize(1, 10, Math.PI / 3)).toBeGreaterThan(projectedSize(1, 10, Math.PI / 2)); // narrower fov => bigger on screen
  });
  it('camera inside the bounds is infinitely large (finest level)', () => {
    expect(projectedSize(5, 2, 1)).toBe(Infinity);
  });
});

describe('selectLevel', () => {
  it('plain thresholds without history', () => {
    const at = (s: number, cull = true) => selectLevel(LEVELS, cull, s, -1, 0.1);
    expect([at(0.5), at(0.3), at(0.2), at(0.1), at(0.05), at(0.03), at(0.01)]).toEqual([0, 0, 1, 1, 2, 2, 3]);
    expect(at(0.001, false)).toBe(2);                                  // no culling: stay on the last level
  });

  it('hysteresis removes flicker around a threshold; without it the level flips constantly', () => {
    const wobble = (h: number) => {
      let level = selectLevel(LEVELS, true, 0.1, -1, h), flips = 0;
      for (let i = 0; i < 200; i++) {
        const size = 0.1 * (1 + 0.06 * Math.sin(i * 1.7));             // +-6% jitter around the 0.1 threshold
        const next = selectLevel(LEVELS, true, size, level, h);
        if (next !== level) flips++;
        level = next;
      }
      return flips;
    };
    expect(wobble(0)).toBeGreaterThan(20);
    expect(wobble(0.1)).toBe(0);
  });

  it('still switches when the size moves clearly beyond the dead band, in both directions', () => {
    let level = selectLevel(LEVELS, true, 0.2, -1, 0.1);              // level 1
    expect(level).toBe(1);
    level = selectLevel(LEVELS, true, 0.095, level, 0.1);             // within the band (0.1 * 0.9 = 0.09): stay
    expect(level).toBe(1);
    level = selectLevel(LEVELS, true, 0.085, level, 0.1);             // below 0.09: coarser
    expect(level).toBe(2);
    level = selectLevel(LEVELS, true, 0.105, level, 0.1);             // above 0.1 but below 0.11: stay coarse
    expect(level).toBe(2);
    level = selectLevel(LEVELS, true, 0.12, level, 0.1);              // above 0.11: finer
    expect(level).toBe(1);
  });

  it('can jump several levels at once, up to culled and back', () => {
    expect(selectLevel(LEVELS, true, 0.001, 0, 0.1)).toBe(3);
    expect(selectLevel(LEVELS, true, 0.9, 3, 0.1)).toBe(0);
  });

  it('single-level groups behave (never coarser than level 0 unless culling)', () => {
    const one: LODLevel[] = [{ meshId: 1, minScreenSize: 0.05 }];
    expect(selectLevel(one, true, 0.01, -1, 0.1)).toBe(1);
    expect(selectLevel(one, false, 0.01, -1, 0.1)).toBe(0);
  });
});

/** RenderWorld with one object per entry: x distance from a camera at the origin looking down -Z. */
function world(objs: { dist: number; radius: number; group: number; entity?: number }[]): RenderWorld {
  const rw = new RenderWorld(); rw.ensureCapacity(objs.length); rw.count = objs.length;
  objs.forEach((o, i) => {
    rw.entityIndex[i] = o.entity ?? i; rw.meshId[i] = 10; rw.lodGroup[i] = o.group;
    rw.boundsSphere.set([0, 0, -o.dist, o.radius], i * 4);
  });
  return rw;
}
const lib = () => { const g = makeFakeGPU(); const l = new LODLibrary(g.meshes); for (let i = 0; i < 3; i++) g.meshes.create('m' + i, tri()); l.create({ levels: [{ meshId: 0, minScreenSize: 0.3 }, { meshId: 1, minScreenSize: 0.1 }, { meshId: 2, minScreenSize: 0.03 }] }); return l; };
const FOV = Math.PI / 2;   // tan(fov/2) = 1, so size = radius / distance

describe('LODSystem', () => {
  it('overrides the mesh per object, culls tiny ones from the visible list, and counts the distribution', () => {
    const rw = world([
      { dist: 2, radius: 1, group: 0 },      // 0.5   -> level 0
      { dist: 8, radius: 1, group: 0 },      // 0.125 -> level 1
      { dist: 20, radius: 1, group: 0 },     // 0.05  -> level 2
      { dist: 100, radius: 1, group: 0 },    // 0.01  -> culled
      { dist: 100, radius: 1, group: -1 },   // no LOD group: untouched even though tiny
    ]);
    const sys = new LODSystem(lib());
    const out = sys.select(rw, { slots: null, count: rw.count }, FOV, [0, 0, 0]);
    expect(Array.from(out.slots!.subarray(0, out.count))).toEqual([0, 1, 2, 4]);
    expect([rw.meshId[0], rw.meshId[1], rw.meshId[2], rw.meshId[4]]).toEqual([0, 1, 2, 10]);
    expect(Array.from(sys.counts.subarray(0, 4))).toEqual([1, 1, 1, 0]);
    expect(sys.culled).toBe(1);
    expect(sys.evaluated).toBe(4);
  });

  it('respects an incoming visible subset (only visible objects are evaluated)', () => {
    const rw = world([{ dist: 2, radius: 1, group: 0 }, { dist: 8, radius: 1, group: 0 }, { dist: 20, radius: 1, group: 0 }]);
    const sys = new LODSystem(lib());
    const out = sys.select(rw, { slots: Uint32Array.from([2, 0]), count: 2 }, FOV, [0, 0, 0]);
    expect(Array.from(out.slots!.subarray(0, out.count))).toEqual([2, 0]);
    expect(sys.evaluated).toBe(2);
    expect(rw.meshId[1]).toBe(10);                                     // slot 1 was not visible: untouched
  });

  it('hysteresis state follows the ENTITY, not the slot (survives swap-removal reordering)', () => {
    const sys = new LODSystem(lib());
    // object sits right at the level 1 / level 2 border (size 0.1); first frame: size 0.12 -> level 1
    let rw = world([{ dist: 1 / 0.12, radius: 1, group: 0, entity: 7 }]);
    sys.select(rw, { slots: null, count: 1 }, FOV, [0, 0, 0]);
    expect(rw.meshId[0]).toBe(1);
    // now a different slot layout, same entity, size 0.095 (inside the dead band) => must STAY level 1
    rw = world([{ dist: 1000, radius: 1, group: -1, entity: 3 }, { dist: 1 / 0.095, radius: 1, group: 0, entity: 7 }]);
    sys.select(rw, { slots: null, count: 2 }, FOV, [0, 0, 0]);
    expect(rw.meshId[1]).toBe(1);
    // clearly smaller => level 2
    rw = world([{ dist: 1 / 0.05, radius: 1, group: 0, entity: 7 }]);
    sys.select(rw, { slots: null, count: 1 }, FOV, [0, 0, 0]);
    expect(rw.meshId[0]).toBe(2);
  });

  it('lodBias scales the projected size (keeps detail longer / drops it sooner)', () => {
    const rw = world([{ dist: 8, radius: 1, group: 0 }]);                  // 0.125 -> level 1
    const sys = new LODSystem(lib());
    sys.lodBias = 4; sys.select(rw, { slots: null, count: 1 }, FOV, [0, 0, 0]); expect(rw.meshId[0]).toBe(0);
    const sys2 = new LODSystem(lib());
    sys2.lodBias = 0.1; sys2.select(rw, { slots: null, count: 1 }, FOV, [0, 0, 0]); expect(sys2.culled).toBe(1);
  });

  it('camera moving toward/away: monotonic level transitions (no oscillation) over a fly-by', () => {
    const sys = new LODSystem(lib());
    const levels: number[] = [];
    for (let d = 3; d < 60; d += 0.05) {
      const rw = world([{ dist: d, radius: 1, group: 0, entity: 0 }]);
      sys.select(rw, { slots: null, count: 1 }, FOV, [0, 0, 0]);
      levels.push(sys.culled ? 3 : rw.meshId[0]);
    }
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]);
    expect(new Set(levels)).toEqual(new Set([0, 1, 2, 3]));
  });

  it('handles 100,000 objects quickly and allocation-free in steady state', () => {
    const N = 100000;
    const rw = new RenderWorld(); rw.ensureCapacity(N); rw.count = N;
    for (let i = 0; i < N; i++) { rw.entityIndex[i] = i; rw.lodGroup[i] = 0; rw.boundsSphere.set([0, 0, -(1 + (i % 500)), 1], i * 4); }
    const sys = new LODSystem(lib());
    sys.select(rw, { slots: null, count: N }, FOV, [0, 0, 0]);
    const buf = (sys as unknown as { out: Uint32Array }).out;
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) sys.select(rw, { slots: null, count: N }, FOV, [0, 0, 0]);
    expect((sys as unknown as { out: Uint32Array }).out).toBe(buf);        // reused, not reallocated
    expect((performance.now() - t0) / 5).toBeLessThan(60);
    expect(sys.counts[0] + sys.counts[1] + sys.counts[2] + sys.culled).toBe(N);
  });
});

describe('LOD through ECS extraction', () => {
  it('extraction copies the group; overrides never stick (next extraction restores the base mesh)', () => {
    const g = makeFakeGPU();
    const library = new LODLibrary(g.meshes);
    const m = [0, 1, 2].map((i) => g.meshes.create('m' + i, tri()));
    const group = library.create({ levels: [{ meshId: m[0], minScreenSize: 0.3 }, { meshId: m[1], minScreenSize: 0.1 }, { meshId: m[2], minScreenSize: 0.03 }] });
    const w = g.world, e = entityIndex(w.create());
    w.transforms.add(e, 0, 0, -30); w.meshRenderers.add(e, m[0], 0); w.bounds.add(e, -1, -1, -1, 1, 1, 1); w.lods.add(e, group);
    const ts = new TransformSystem(w.transforms), bs = new BoundsSystem(w.transforms, w.bounds), ex = new RenderExtractor(w, ts), rw = new RenderWorld();
    const sys = new LODSystem(library);
    const frame = () => { ts.update(); bs.update(ts.updated); ex.extract(rw, 1); return sys.select(rw, { slots: null, count: rw.count }, FOV, [0, 0, 0]); };
    frame();
    expect(rw.lodGroup[0]).toBe(group);
    expect(rw.meshId[0]).toBe(m[2]);                  // far away: coarsest level (radius ~1.7 at distance 30 => 0.057)
    expect(w.meshRenderers.meshId[e]).toBe(m[0]);     // the ECS keeps the level-0 mesh
    w.transforms.setPosition(e, 0, 0, -3);            // close: level 0
    frame();
    expect(rw.meshId[0]).toBe(m[0]);
  });
});
