import { describe, expect, it } from 'vitest';
import { World } from '../src/ecs/World';
import { entityIndex } from '../src/ecs/Entity';
import { TransformSystem } from '../src/ecs/systems/TransformSystem';
import { BoundsSystem } from '../src/ecs/systems/BoundsSystem';
import { RenderExtractor } from '../src/rendering/RenderExtractor';
import { RenderWorld } from '../src/rendering/RenderWorld';
import { RenderFlags } from '../src/ecs/components/MeshRendererStore';

function setup() {
  const world = new World();
  const ts = new TransformSystem(world.transforms);
  const bs = new BoundsSystem(world.transforms, world.bounds);
  const ex = new RenderExtractor(world, ts);
  const rw = new RenderWorld();
  const spawn = (x: number, mesh = 1, mat = 2) => {
    const e = world.create(), i = entityIndex(e);
    world.transforms.add(i, x, 0, 0);
    world.meshRenderers.add(i, mesh, mat);
    world.bounds.add(i, -1, -1, -1, 1, 1, 1);
    return { e, i };
  };
  const frame = () => { ts.update(); bs.update(ts.updated); ex.extract(rw, 1.5); };
  return { world, ts, ex, rw, spawn, frame };
}

describe('RenderExtractor', () => {
  it('extracts renderables with matrices and bounds', () => {
    const { rw, spawn, frame } = setup();
    const a = spawn(5), b = spawn(7);
    frame();
    expect(rw.count).toBe(2);
    const sa = rw.entityIndex[0] === a.i ? 0 : 1;
    expect(rw.transforms[sa * 16 + 12]).toBeCloseTo(5);
    expect(rw.boundsSphere[sa * 4]).toBeCloseTo(5);
    expect(rw.get(sa)).toMatchObject({ entityId: a.i, meshId: 1, materialId: 2, skinInstanceId: -1, morphStateId: -1 });
    void b;
  });

  it('entities without MeshRenderer are not extracted', () => {
    const { world, rw, frame } = setup();
    const i = entityIndex(world.create());
    world.transforms.add(i);
    frame();
    expect(rw.count).toBe(0);
  });

  it('copies only changed matrices after the first frame', () => {
    const { world, rw, ex, spawn, frame } = setup();
    const objs = Array.from({ length: 100 }, (_, k) => spawn(k));
    frame();
    expect(ex.matricesCopied).toBe(100);
    world.transforms.setPosition(objs[10].i, 42, 0, 0);
    frame();
    expect(ex.matricesCopied).toBe(1);
    expect(rw.changedSlots.length).toBe(1);
    const s = ex.slotForEntity(objs[10].i);
    expect(rw.transforms[s * 16 + 12]).toBeCloseTo(42);
    frame();
    expect(ex.matricesCopied).toBe(0);
  });

  it('swap-removes destroyed entities and keeps data consistent', () => {
    const { world, rw, ex, spawn, frame } = setup();
    const o = [spawn(0), spawn(10), spawn(20), spawn(30)];
    frame();
    world.destroy(o[1].e);
    frame();
    expect(rw.count).toBe(3);
    expect(ex.removed).toBe(1);
    const xs = new Set<number>();
    for (let s = 0; s < rw.count; s++) {
      xs.add(rw.transforms[s * 16 + 12]);
      expect(ex.slotForEntity(rw.entityIndex[s])).toBe(s);
    }
    expect(xs).toEqual(new Set([0, 20, 30]));
    expect(ex.slotForEntity(o[1].i)).toBe(-1);
  });

  it('removing several including the tail works', () => {
    const { world, rw, spawn, frame } = setup();
    const o = Array.from({ length: 6 }, (_, k) => spawn(k));
    frame();
    world.destroy(o[5].e); world.destroy(o[0].e); world.destroy(o[3].e);
    frame();
    expect(rw.count).toBe(3);
    const xs = Array.from({ length: rw.count }, (_, s) => rw.transforms[s * 16 + 12]).sort();
    expect(xs).toEqual([1, 2, 4]);
  });

  it('Hidden flag removes and re-adds objects', () => {
    const { world, rw, spawn, frame } = setup();
    const a = spawn(3);
    frame();
    world.meshRenderers.flags[a.i] |= RenderFlags.Hidden;
    frame();
    expect(rw.count).toBe(0);
    world.meshRenderers.flags[a.i] &= ~RenderFlags.Hidden;
    frame();
    expect(rw.count).toBe(1);
    expect(rw.transforms[12]).toBeCloseTo(3); // re-added with correct matrix though not dirty
  });

  it('mesh/material changes propagate', () => {
    const { world, rw, spawn, frame } = setup();
    const a = spawn(0);
    frame();
    world.meshRenderers.materialId[a.i] = 9;
    frame();
    expect(rw.materialId[0]).toBe(9);
  });

  it('structureVersion changes only on add/remove', () => {
    const { world, rw, spawn, frame } = setup();
    const a = spawn(0);
    frame();
    const v = rw.structureVersion;
    frame();
    expect(rw.structureVersion).toBe(v);
    world.destroy(a.e);
    frame();
    expect(rw.structureVersion).toBe(v + 1);
  });

  it('extracts the camera from the ECS', () => {
    const { world, rw, frame } = setup();
    const c = entityIndex(world.create());
    world.transforms.add(c, 0, 0, 5);
    world.cameras.add(c, Math.PI / 2, 0.1, 100);
    frame();
    expect(rw.hasCamera).toBe(true);
    expect(rw.camera.position[2]).toBeCloseTo(5);
    expect(rw.camera.frustum.intersectsSphere(0, 0, 0, 1)).toBe(true);
    expect(rw.camera.frustum.intersectsSphere(0, 0, 20, 1)).toBe(false);
  });

  it('grows past initial capacity', () => {
    const { rw, spawn, frame } = setup();
    for (let k = 0; k < 1000; k++) spawn(k);
    frame();
    expect(rw.count).toBe(1000);
    const xs = new Set<number>();
    for (let s = 0; s < rw.count; s++) xs.add(rw.transforms[s * 16 + 12]);
    expect(xs.size).toBe(1000);
  });
});
