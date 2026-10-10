import { describe, expect, it } from 'vitest';
import { makeFakeGPU } from './helpers/fakeGPU';
import { TransformSystem } from '../src/ecs/systems/TransformSystem';
import { BoundsSystem } from '../src/ecs/systems/BoundsSystem';
import { RenderFlags } from '../src/ecs/components/MeshRendererStore';
import { entityIndex } from '../src/ecs/Entity';
import { Mat4 } from '../src/math/Mat4';
import { Quat } from '../src/math/Quat';
import { createCube, createUVSphere } from '../src/rendering/primitives';
import {
  createGroup, childrenOf, descendantsOf, rootOf, setParent, setVisible, destroyTree, findByName, worldPosition,
} from '../src/ecs/Hierarchy';
import { InstancedMesh } from '../src/scene/InstancedMesh';
import { BatchedMesh } from '../src/scene/BatchedMesh';

function setup() {
  const g = makeFakeGPU();
  const cube = g.meshes.create('cube', createCube());
  const sphere = g.meshes.create('sphere', createUVSphere(8, 4));
  const ts = new TransformSystem(g.world.transforms);
  const bs = new BoundsSystem(g.world.transforms, g.world.bounds);
  const update = () => { ts.update(); bs.update(ts.updated); };
  return { ...g, cube, sphere, update };
}

const wm = (world: { transforms: { worldMatrices: Float32Array } }, e: number) => Array.from(world.transforms.worldMatrices.subarray(e * 16, e * 16 + 16));

describe('Mat4.decompose', () => {
  it('inverts compose, including a mirrored scale', () => {
    const q = Quat.fromAxisAngle(Quat.create(), 0.3, 0.9, -0.2, 1.1);
    for (const s of [[1, 1, 1], [2, 0.5, 3], [-1.5, 1, 2]]) {
      const m = Mat4.compose(Mat4.create(), 1, -2, 3, q[0], q[1], q[2], q[3], s[0], s[1], s[2]);
      const p = new Float32Array(3), r = new Float32Array(4), sc = new Float32Array(3);
      Mat4.decompose(m, p, r, sc);
      const back = Mat4.compose(Mat4.create(), p[0], p[1], p[2], r[0], r[1], r[2], r[3], sc[0], sc[1], sc[2]);
      for (let i = 0; i < 16; i++) expect(back[i]).toBeCloseTo(m[i], 4);
      expect(Math.hypot(r[0], r[1], r[2], r[3])).toBeCloseTo(1, 5);
    }
  });
});

describe('groups', () => {
  it('missing transform queries terminate and invalid indices do not alias a live group', () => {
    const { world } = setup();
    const group = createGroup(world);
    createGroup(world, { parent: group });
    for (const root of [-1, 100000, NaN, 0.5, 0x100000000]) {
      expect(childrenOf(world, root)).toEqual([]);
      expect(descendantsOf(world, root)).toEqual([]);
      expect(rootOf(world, root)).toBe(-1);
      expect(destroyTree(world, root)).toBe(0);
      expect(() => worldPosition(world, root)).toThrow('Transform does not exist');
    }
  });

  it('rejects preserving world pose under a singular parent without changing the hierarchy', () => {
    const { world, update } = setup();
    const original = createGroup(world, { position: [2, 0, 0] });
    const singular = createGroup(world, { scale: 0 });
    const child = createGroup(world, { parent: original, position: [1, 0, 0] });
    update();
    const before = wm(world, child);
    expect(() => setParent(world, child, singular, true)).toThrow('singular parent');
    expect(world.transforms.parent[child]).toBe(original);
    update();
    expect(wm(world, child)).toEqual(before);
  });
  it('children, descendants, root, names and cycles', () => {
    const { world } = setup();
    const top = createGroup(world, { name: 'top' });
    const mid = createGroup(world, { parent: top, name: 'mid' });
    const a = createGroup(world, { parent: mid, name: 'a' });
    const b = createGroup(world, { parent: mid, name: 'b' });
    expect(childrenOf(world, mid).sort()).toEqual([a, b].sort());
    expect(descendantsOf(world, top).sort()).toEqual([mid, a, b].sort());
    expect(descendantsOf(world, top)[0]).toBe(mid);                        // parents before children
    expect(rootOf(world, b)).toBe(top);
    expect(findByName(world, 'b')).toBe(b);
    expect(findByName(world, 'b', top)).toBe(b);
    expect(findByName(world, 'b', a)).toBe(-1);
    expect(findByName(world, 'nope')).toBe(-1);
    expect(() => setParent(world, top, a)).toThrow();                      // a group cannot enter its own subtree
  });

  it('children follow the group; keepWorld preserves the world pose when reparenting', () => {
    const s = setup();
    const { world, cube, update } = s;
    const grp = createGroup(world, { position: [10, 0, 0], rotation: [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)], scale: 2 });
    const obj = entityIndex(world.create());
    world.transforms.add(obj, 1, 0, 0);
    world.meshRenderers.add(obj, cube, 0);
    world.bounds.add(obj, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5);
    setParent(world, obj, grp);
    update();
    const p = worldPosition(world, obj, [0, 0, 0]);
    // 90 degrees about Y maps local +x to world -z; scale 2 doubles it
    expect([p[0], p[1], p[2]].map((v) => Math.round(v * 1e3) / 1e3)).toEqual([10, 0, -2]);

    const before = wm(world, obj);
    setParent(world, obj, -1, true);                                        // detach, stay in place
    update();
    const after = wm(world, obj);
    for (let i = 0; i < 16; i++) expect(after[i]).toBeCloseTo(before[i], 4);
    expect(world.transforms.parent[obj]).toBe(-1);

    setParent(world, obj, grp, true);                                       // re-attach, still in place
    update();
    for (let i = 0; i < 16; i++) expect(wm(world, obj)[i]).toBeCloseTo(before[i], 4);
  });

  it('setVisible hides the whole tree and destroyTree removes it', () => {
    const { world, cube } = setup();
    const grp = createGroup(world);
    const kids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const e = entityIndex(world.create());
      world.transforms.add(e, i, 0, 0);
      world.meshRenderers.add(e, cube, 0, RenderFlags.CastShadow);
      world.transforms.setParent(e, grp);
      kids.push(e);
    }
    setVisible(world, grp, false);
    for (const k of kids) expect(world.meshRenderers.flags[k] & RenderFlags.Hidden).toBe(RenderFlags.Hidden);
    setVisible(world, grp, true);
    for (const k of kids) expect(world.meshRenderers.flags[k]).toBe(RenderFlags.CastShadow);

    const alive = world.entities.aliveCount;
    expect(destroyTree(world, grp)).toBe(4);
    expect(world.entities.aliveCount).toBe(alive - 4);
    for (const k of kids) expect(world.entities.handleOf(k)).toBe(-1);
  });
});

describe('InstancedMesh', () => {
  it('creates instances under a group and transforms them by group * local', () => {
    const s = setup();
    const im = new InstancedMesh(s.world, s.meshes, { mesh: s.cube, material: 0, count: 100, position: [0, 5, 0], scale: 2 });
    expect(im.capacity).toBe(100);
    expect(im.count).toBe(100);
    expect(s.world.transforms.parent[im.entityAt(7)]).toBe(im.root);
    expect(im.instanceOf(im.entityAt(42))).toBe(42);
    expect(im.instanceOf(99999)).toBe(-1);

    const q = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, 0.5);
    const m = Mat4.compose(Mat4.create(), 3, 0, 1, q[0], q[1], q[2], q[3], 1, 1, 1);
    im.setMatrixAt(7, m);
    const back = im.getMatrixAt(7);
    for (let i = 0; i < 16; i++) expect(back[i]).toBeCloseTo(m[i], 4);
    s.update();
    const p = worldPosition(s.world, im.entityAt(7), [0, 0, 0]);
    expect([p[0], p[1], p[2]]).toEqual([6, 5, 2]);                           // group scale 2 + translation (0, 5, 0)
    // world bounds are computed for instances (they can be culled individually)
    expect(s.world.bounds.world[im.entityAt(7) * 6 + 4]).toBeGreaterThan(5);
  });

  it('visible count, per-instance visibility, materials and resize', () => {
    const { world, meshes, cube } = setup();
    const im = new InstancedMesh(world, meshes, { mesh: cube, material: 3, count: 10 });
    const hidden = (i: number) => (world.meshRenderers.flags[im.entityAt(i)] & RenderFlags.Hidden) !== 0;
    im.setCount(4);
    expect([0, 3, 4, 9].map(hidden)).toEqual([false, false, true, true]);
    im.setVisibleAt(1, false);
    expect(hidden(1)).toBe(true);
    im.setCount(8);
    expect([1, 5, 7, 8].map(hidden)).toEqual([true, false, false, true]);   // the manual hide survives count changes
    im.setVisibleAt(1, true);
    expect(hidden(1)).toBe(false);

    im.setMaterialAt(2, 7);
    expect(world.meshRenderers.materialId[im.entityAt(2)]).toBe(7);
    expect(world.meshRenderers.materialId[im.entityAt(3)]).toBe(3);

    const alive = world.entities.aliveCount;
    im.resize(25);
    expect(im.capacity).toBe(25);
    expect(world.entities.aliveCount).toBe(alive + 15);
    expect(hidden(20)).toBe(true);                                          // the visible count (8) was kept, so new instances are hidden
    im.resize(5);
    expect(im.capacity).toBe(5);
    expect(im.count).toBe(5);
    expect(world.entities.aliveCount).toBe(alive - 5);

    im.dispose();
    im.dispose();                                                           // idempotent
    expect(world.entities.aliveCount).toBe(alive - 5 - 5 - 1);
  });

  it('handles 100k instances', () => {
    const { world, meshes, cube } = setup();
    const t0 = performance.now();
    const im = new InstancedMesh(world, meshes, { mesh: cube, material: 0, count: 100_000 });
    for (let i = 0; i < 100_000; i++) im.setPositionAt(i, i % 100, Math.floor(i / 10000), Math.floor((i % 10000) / 100));
    const ms = performance.now() - t0;
    expect(im.capacity).toBe(100_000);
    expect(world.transforms.dirtyList.length).toBeGreaterThan(99_000);
    expect(ms).toBeLessThan(5000);
  });
});

describe('BatchedMesh', () => {
  it('registers geometries once, reuses instance ids and tracks geometry changes', () => {
    const s = setup();
    const bm = new BatchedMesh(s.world, s.meshes, { material: 2, position: [1, 0, 0] });
    const gCube = bm.addGeometry(s.cube), gSphere = bm.addGeometry(s.sphere);
    expect(bm.addGeometry(s.cube)).toBe(gCube);
    expect(bm.geometryCount).toBe(2);
    expect(() => bm.addInstance(9)).toThrow();

    const a = bm.addInstance(gCube, { position: [0, 1, 0] });
    const b = bm.addInstance(gSphere, { scale: 3 });
    const c = bm.addInstance(gCube);
    expect(bm.instanceCount).toBe(3);
    expect(s.world.meshRenderers.meshId[bm.entityAt(b)]).toBe(s.sphere);
    expect(s.world.meshRenderers.materialId[bm.entityAt(a)]).toBe(2);

    bm.deleteInstance(b);
    expect(bm.instanceCount).toBe(2);
    expect(bm.entityAt(b)).toBe(-1);
    expect(bm.addInstance(gSphere)).toBe(b);                                 // freed ids are reused

    const e = bm.entityAt(c);
    bm.setGeometryAt(c, gSphere);
    expect(s.world.meshRenderers.meshId[e]).toBe(s.sphere);
    expect(bm.geometryAt(c)).toBe(gSphere);
    const sb = s.meshes.get(s.sphere).bounds;
    expect(s.world.bounds.local[e * 6 + 3]).toBeCloseTo(sb[3], 6);          // bounds follow the geometry
    expect(s.world.transforms.dirtyList).toContain(e);                      // so the world bounds are recomputed

    bm.setVisibleAt(a, false);
    expect(s.world.meshRenderers.flags[bm.entityAt(a)] & RenderFlags.Hidden).toBe(RenderFlags.Hidden);

    const alive = s.world.entities.aliveCount;
    bm.dispose();
    expect(s.world.entities.aliveCount).toBe(alive - 3 - 1);
  });

  it('respects maxInstances', () => {
    const s = setup();
    const bm = new BatchedMesh(s.world, s.meshes, { material: 0, maxInstances: 2 });
    const g = bm.addGeometry(s.cube);
    bm.addInstance(g); bm.addInstance(g);
    expect(() => bm.addInstance(g)).toThrow(/maxInstances/);
    bm.deleteInstance(0);
    expect(() => bm.addInstance(g)).not.toThrow();
  });
});
