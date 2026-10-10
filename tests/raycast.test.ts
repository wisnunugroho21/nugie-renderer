import { describe, expect, it } from 'vitest';
import { makeFakeGPU } from './helpers/fakeGPU';
import { entityIndex } from '../src/ecs/Entity';
import { TransformSystem } from '../src/ecs/systems/TransformSystem';
import { BoundsSystem } from '../src/ecs/systems/BoundsSystem';
import { RenderFlags } from '../src/ecs/components/MeshRendererStore';
import { createCube, createUVSphere } from '../src/rendering/primitives';
import { Mat4 } from '../src/math/Mat4';
import { raycastWorld, rayFromNDC, type Ray } from '../src/picking/Raycaster';

function setup() {
  const g = makeFakeGPU();
  const cube = g.meshes.create('cube', createCube());
  const sphere = g.meshes.create('sphere', createUVSphere());
  const ts = new TransformSystem(g.world.transforms);
  const bs = new BoundsSystem(g.world.transforms, g.world.bounds);
  const spawn = (mesh: number, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], flags = 0) => {
    const w = g.world, e = entityIndex(w.create());
    w.transforms.add(e, ...pos);
    w.transforms.setScale(e, ...scale);
    w.meshRenderers.add(e, mesh, 0, flags);
    const b = g.meshes.get(mesh).bounds;
    w.bounds.add(e, b[0], b[1], b[2], b[3], b[4], b[5]);
    return e;
  };
  const update = () => { ts.update(); bs.update(ts.updated); };
  return { ...g, cube, sphere, spawn, update };
}
const ray = (o: [number, number, number], d: [number, number, number]): Ray => ({ origin: o, direction: d });

describe('raycastWorld', () => {
  it('hits a cube face with the right distance, point and normal', () => {
    const s = setup();
    const e = s.spawn(s.cube, [0, 0, -5]);
    s.update();
    const [h] = raycastWorld(s.world, s.meshes, ray([0, 0, 0], [0, 0, -1]));
    expect(h.entity).toBe(e);
    expect(h.distance).toBeCloseTo(4.5);
    expect(h.point[2]).toBeCloseTo(-4.5);
    expect(h.normal[2]).toBeCloseTo(1);
    expect(h.triangle).toBeGreaterThanOrEqual(0);
  });

  it('measures world distance under non-uniform scale and returns the nearest first', () => {
    const s = setup();
    const far = s.spawn(s.cube, [0, 0, -10], [2, 2, 4]);   // front face at z = -8
    const near = s.spawn(s.cube, [0, 0, -4]);              // front face at z = -3.5
    s.update();
    const hits = raycastWorld(s.world, s.meshes, ray([0, 0, 0], [0, 0, -1]));
    expect(hits.map((h) => h.entity)).toEqual([near, far]);
    expect(hits[0].distance).toBeCloseTo(3.5);
    expect(hits[1].distance).toBeCloseTo(8);
    expect(raycastWorld(s.world, s.meshes, ray([0, 0, 0], [0, 0, -1]), {}, true)).toHaveLength(1);
  });

  it('misses when the box overlaps but the triangles do not (sphere corner)', () => {
    const s = setup();
    s.spawn(s.sphere, [0, 0, -5]);                          // radius 0.5 sphere, AABB corner is empty
    s.update();
    const diag = ray([0.45, 0.45, 0], [0, 0, -1]);          // inside the AABB, outside the sphere (0.636 > 0.5)
    expect(raycastWorld(s.world, s.meshes, diag)).toHaveLength(0);
    const loose = raycastWorld(s.world, s.meshes, diag, { precise: false });
    expect(loose).toHaveLength(1);
    expect(loose[0].triangle).toBe(-1);
  });

  it('honours maxDistance, filter and Hidden', () => {
    const s = setup();
    const a = s.spawn(s.cube, [0, 0, -3]);
    const hidden = s.spawn(s.cube, [0, 0, -6], [1, 1, 1], RenderFlags.Hidden);
    s.update();
    const r = ray([0, 0, 0], [0, 0, -1]);
    expect(raycastWorld(s.world, s.meshes, r).map((h) => h.entity)).toEqual([a]);
    expect(raycastWorld(s.world, s.meshes, r, { skipHidden: false }).map((h) => h.entity)).toEqual([a, hidden]);
    expect(raycastWorld(s.world, s.meshes, r, { maxDistance: 2 })).toHaveLength(0);
    expect(raycastWorld(s.world, s.meshes, r, { filter: (e) => e !== a })).toHaveLength(0);
  });

  it('back-face culling: inside a cube only hits without culling; mirrored scale keeps the same answer', () => {
    const s = setup();
    s.spawn(s.cube, [0, 0, 0], [4, 4, 4]);
    s.update();
    const inside = ray([0, 0, 0], [0, 0, -1]);
    expect(raycastWorld(s.world, s.meshes, inside)[0].distance).toBeCloseTo(2);
    expect(raycastWorld(s.world, s.meshes, inside, { cullBackfaces: true })).toHaveLength(0);

    const m = setup();
    m.spawn(m.cube, [0, 0, -5], [-1, 1, 1]);                // mirrored: winding flips, front must still be front
    m.update();
    const out = ray([0, 0, 0], [0, 0, -1]);
    expect(raycastWorld(m.world, m.meshes, out, { cullBackfaces: true })[0].distance).toBeCloseTo(4.5);
    expect(raycastWorld(m.world, m.meshes, out)[0].normal[2]).toBeCloseTo(1);
  });

  it('falls back to bounds when CPU geometry is not kept', () => {
    const s = setup();
    s.meshes.keepCpuGeometry = false;
    const m = s.meshes.create('c2', createCube());
    s.spawn(m, [0, 0, -5]);
    s.update();
    const [h] = raycastWorld(s.world, s.meshes, ray([0, 0, 0], [0, 0, -1]));
    expect(h.triangle).toBe(-1);
    expect(h.distance).toBeCloseTo(4.5);
  });
});

describe('rayFromNDC', () => {
  it('centre of the screen looks along the camera forward, corners fan out', () => {
    const view = Mat4.lookAt(Mat4.create(), 0, 0, 5, 0, 0, 0);
    const proj = Mat4.perspective(Mat4.create(), Math.PI / 2, 1, 0.1, 100);
    const inv = Mat4.invert(Mat4.create(), Mat4.multiply(Mat4.create(), proj, view))!;
    const c = rayFromNDC(inv, 0, 0);
    expect(c.origin[0]).toBeCloseTo(0); expect(c.origin[2]).toBeCloseTo(4.9, 1);
    expect(c.direction[2]).toBeCloseTo(-1);
    const r = rayFromNDC(inv, 1, 0);                       // fov 90 deg: right edge is 45 deg off axis
    expect(r.direction[0]).toBeCloseTo(Math.SQRT1_2);
    expect(r.direction[2]).toBeCloseTo(-Math.SQRT1_2);
    expect(rayFromNDC(inv, 0, 1).direction[1]).toBeGreaterThan(0);
  });
});

it('uses animated bounds padding exactly once for bounds-only picking', () => {
  const s = setup();
  const object = s.spawn(s.cube, [0, 0, -5]);
  s.world.bounds.padding[object] = 1;
  s.update();
  const hit = raycastWorld(s.world, s.meshes, ray([0, 0, 0], [0, 0, -1]), { precise: false })[0];
  expect(hit.distance).toBeCloseTo(3.5);
  expect(raycastWorld(s.world, s.meshes, ray([2, 0, 0], [0, 0, -1]), { precise: false })).toEqual([]);
});
