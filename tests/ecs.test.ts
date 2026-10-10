import { describe, expect, it } from 'vitest';
import { BitSet } from '../src/core/BitSet';
import { World } from '../src/ecs/World';
import { Query } from '../src/ecs/Query';
import { entityIndex, entityGeneration } from '../src/ecs/Entity';
import { TransformSystem } from '../src/ecs/systems/TransformSystem';
import { BoundsSystem } from '../src/ecs/systems/BoundsSystem';
import { Mat4 } from '../src/math/Mat4';

describe('BitSet', () => {
  it('rejects invalid writes without aliasing bit zero, and ignores invalid reads and clears', () => {
    const bits = new BitSet();
    bits.set(0);
    for (const i of [-1, -0x100000000, NaN, Infinity, 0.5, 0x100000000]) {
      expect(bits.has(i)).toBe(false);
      bits.clear(i);
      expect(() => bits.set(i)).toThrow(RangeError);
      expect(bits.has(0)).toBe(true);
    }
    for (const size of [-1, NaN, Infinity, 0.5, 0x100000001]) {
      expect(() => new BitSet(size)).toThrow(RangeError);
      expect(() => bits.ensure(size)).toThrow(RangeError);
    }
  });

  it('an empty intersection has no enumerable members', () => {
    const out: number[] = [];
    BitSet.forEachAnd([], i => out.push(i));
    expect(out).toEqual([]);
  });
  it('set/clear/has/grow/count', () => {
    const b = new BitSet(8);
    b.set(3); b.set(100); b.set(1000);
    expect(b.has(3) && b.has(100) && b.has(1000)).toBe(true);
    expect(b.has(4)).toBe(false);
    b.clear(100);
    expect(b.count()).toBe(2);
  });
  it('forEachAnd intersects, ascending', () => {
    const a = new BitSet(), b = new BitSet();
    [1, 5, 33, 64, 70].forEach((i) => a.set(i));
    [5, 33, 70, 99].forEach((i) => b.set(i));
    const out: number[] = [];
    BitSet.forEachAnd([a, b], (i) => out.push(i));
    expect(out).toEqual([5, 33, 70]);
  });
});

describe('Entities', () => {
  it('reuses indices with bumped generation; stale ids are dead', () => {
    const w = new World();
    const a = w.create();
    expect(w.destroy(a)).toBe(true);
    const b = w.create();
    expect(entityIndex(b)).toBe(entityIndex(a));
    expect(entityGeneration(b)).toBe(entityGeneration(a) + 1);
    expect(w.isAlive(a)).toBe(false);
    expect(w.isAlive(b)).toBe(true);
    expect(w.destroy(a)).toBe(false);
  });
  it('destroy removes components', () => {
    const w = new World();
    const e = w.create();
    w.transforms.add(entityIndex(e));
    w.meshRenderers.add(entityIndex(e), 1, 2);
    w.destroy(e);
    expect(w.transforms.has.has(entityIndex(e))).toBe(false);
    expect(w.meshRenderers.has.has(entityIndex(e))).toBe(false);
  });
  it('query returns entities having all components', () => {
    const w = new World();
    const idx: number[] = [];
    for (let i = 0; i < 10; i++) {
      const i0 = entityIndex(w.create());
      idx.push(i0);
      w.transforms.add(i0);
      if (i % 2 === 0) w.meshRenderers.add(i0, 0, 0);
    }
    const out: number[] = [];
    new Query(w.transforms, w.meshRenderers).forEach((i) => out.push(i));
    expect(out).toEqual(idx.filter((_, k) => k % 2 === 0));
  });
});

function makeWorld(n: number) {
  const w = new World();
  const idx: number[] = [];
  for (let i = 0; i < n; i++) { const i0 = entityIndex(w.create()); w.transforms.add(i0, i, 0, 0); idx.push(i0); }
  return { w, idx, sys: new TransformSystem(w.transforms) };
}

describe('Transform hierarchy', () => {
  it('child world = parent world * local', () => {
    const { w, idx, sys } = makeWorld(2);
    const t = w.transforms;
    t.setParent(idx[1], idx[0]);
    t.setPosition(idx[0], 10, 0, 0);
    t.setScale(idx[0], 2, 2, 2);
    t.setPosition(idx[1], 1, 0, 0);
    sys.update();
    const p = Mat4.transformPoint([0, 0, 0], t.worldMatrices, 0, 0, 0, idx[1] * 16);
    expect(p[0]).toBeCloseTo(12); // 10 + 2*1
  });
  it('rejects cycles and self parent', () => {
    const { w, idx } = makeWorld(3);
    w.transforms.setParent(idx[1], idx[0]);
    w.transforms.setParent(idx[2], idx[1]);
    expect(() => w.transforms.setParent(idx[0], idx[2])).toThrow();
    expect(() => w.transforms.setParent(idx[0], idx[0])).toThrow();
  });
  it('destroying a parent orphans children as roots at their local pose', () => {
    const { w, idx, sys } = makeWorld(2);
    const t = w.transforms;
    t.setParent(idx[1], idx[0]);
    t.setPosition(idx[0], 100, 0, 0);
    t.setPosition(idx[1], 1, 0, 0);
    sys.update();
    t.remove(idx[0]);
    sys.update();
    expect(t.parent[idx[1]]).toBe(-1);
    expect(t.worldMatrices[idx[1] * 16 + 12]).toBeCloseTo(1);
    expect(t.depth[idx[1]]).toBe(0);
  });
  it('reparent updates depth of whole subtree', () => {
    const { w, idx } = makeWorld(4);
    const t = w.transforms;
    t.setParent(idx[1], idx[0]); t.setParent(idx[2], idx[1]); t.setParent(idx[3], idx[2]);
    expect(t.depth[idx[3]]).toBe(3);
    t.setParent(idx[1], -1);
    expect(t.depth[idx[3]]).toBe(2);
  });
  it('very deep chain does not overflow the stack', () => {
    const { w, idx, sys } = makeWorld(30000);
    const t = w.transforms;
    for (let i = 1; i < idx.length; i++) t.setParent(idx[i], idx[i - 1]);
    sys.update();
    expect(sys.matricesUpdated).toBe(30000);
    t.setPosition(idx[0], 5, 0, 0);
    sys.update();
    expect(sys.matricesUpdated).toBe(30000);
  });
});

describe('Dirty transform system (benchmark A: 10,000 entities / 100 dirty)', () => {
  // 100 trees of 100 nodes: each root has 99 children
  function forest() {
    const { w, idx, sys } = makeWorld(10000);
    for (let r = 0; r < 100; r++) for (let c = 1; c < 100; c++) w.transforms.setParent(idx[r * 100 + c], idx[r * 100]);
    sys.update();
    return { w, idx, sys };
  }
  it('initial pass computes everything once', () => {
    const { sys } = forest();
    expect(sys.matricesUpdated).toBe(10000);
    sys.update(); // nothing dirty any more
    expect(sys.matricesUpdated).toBe(0);
  });
  it('100 dirty leaves recompute exactly 100 matrices', () => {
    const { w, idx, sys } = forest();
    for (let r = 0; r < 100; r++) w.transforms.setPosition(idx[r * 100 + 50], 1, 2, 3);
    sys.update();
    expect(sys.matricesUpdated).toBe(100);
  });
  it('dirty parent + its dirty children: subtree computed once', () => {
    const { w, idx, sys } = forest();
    w.transforms.setPosition(idx[0], 1, 1, 1);
    w.transforms.setPosition(idx[5], 2, 2, 2); // child of root 0
    w.transforms.setPosition(idx[6], 2, 2, 2);
    sys.update();
    expect(sys.matricesUpdated).toBe(100);
  });
  it('unaffected transforms keep their matrices bit-exact', () => {
    const { w, idx, sys } = forest();
    const before = w.transforms.worldMatrices.slice(idx[9999] * 16, idx[9999] * 16 + 16);
    w.transforms.setPosition(idx[0], 9, 9, 9);
    sys.update();
    expect(Array.from(w.transforms.worldMatrices.subarray(idx[9999] * 16, idx[9999] * 16 + 16))).toEqual(Array.from(before));
  });
  it('dirtying the same entity twice queues it once', () => {
    const { w, idx, sys } = forest();
    w.transforms.setPosition(idx[3], 1, 1, 1);
    w.transforms.setPosition(idx[3], 2, 2, 2);
    expect(w.transforms.dirtyList.length).toBe(1);
    sys.update();
    expect(sys.matricesUpdated).toBe(1);
  });
  it('reports updated indices for sparse GPU upload', () => {
    const { w, idx, sys } = forest();
    w.transforms.setPosition(idx[7], 1, 1, 1);
    sys.update();
    expect(sys.updated).toEqual([idx[7]]);
  });
});

describe('BoundsSystem', () => {
  it('world AABB follows transform; only changed entities updated', () => {
    const w = new World();
    const a = entityIndex(w.create()), b = entityIndex(w.create());
    for (const i of [a, b]) { w.transforms.add(i); w.bounds.add(i, -1, -1, -1, 1, 1, 1); }
    const ts = new TransformSystem(w.transforms), bs = new BoundsSystem(w.transforms, w.bounds);
    ts.update(); bs.update(ts.updated);
    w.transforms.setPosition(a, 10, 0, 0);
    ts.update(); bs.update(ts.updated);
    expect(bs.boundsUpdated).toBe(1);
    expect(w.bounds.world[a * 6]).toBeCloseTo(9);
    expect(w.bounds.world[b * 6]).toBeCloseTo(-1);
    expect(w.bounds.sphere[a * 4]).toBeCloseTo(10);
    expect(w.bounds.sphere[a * 4 + 3]).toBeCloseTo(Math.sqrt(3));
  });
  it('padding expands bounds conservatively', () => {
    const w = new World();
    const a = entityIndex(w.create());
    w.transforms.add(a); w.bounds.add(a, -1, -1, -1, 1, 1, 1); w.bounds.padding[a] = 0.5;
    const ts = new TransformSystem(w.transforms), bs = new BoundsSystem(w.transforms, w.bounds);
    ts.update(); bs.update(ts.updated);
    expect(w.bounds.world[a * 6]).toBeCloseTo(-1.5);
  });
});

describe('TransformStore.setRotation', () => {
  it('stores unit quaternions (identity for zero input)', async () => {
    const { TransformStore } = await import('../src/ecs/components/TransformStore');
    const t = new TransformStore();
    t.add(0);
    t.setRotation(0, 0, 2, 0, 2);
    expect(Math.hypot(t.rotationX[0], t.rotationY[0], t.rotationZ[0], t.rotationW[0])).toBeCloseTo(1, 6);
    t.setRotation(0, 0, 0, 0, 0);
    expect([t.rotationX[0], t.rotationY[0], t.rotationZ[0], t.rotationW[0]]).toEqual([0, 0, 0, 1]);
  });
});

describe('entity and hierarchy validation regressions', () => {
  it('rejects malformed handles rather than aliasing live entities', () => {
    const world = new World();
    const entity = world.create();
    for (const handle of [NaN, Infinity, 0.5, entity + 2 ** 31, entity + 2 ** 32]) {
      expect(world.isAlive(handle)).toBe(false);
      expect(world.destroy(handle)).toBe(false);
    }
    expect(world.isAlive(entity)).toBe(true);
  });
  it('rejects missing parents and children without changing the hierarchy', () => {
    const { w, idx } = makeWorld(2);
    w.transforms.setParent(idx[1], idx[0]);
    for (const parent of [-2, 100000, NaN, 0.5]) {
      expect(() => w.transforms.setParent(idx[1], parent)).toThrow(/Parent/);
    }
    expect(() => w.transforms.setParent(100000, -1)).toThrow(/Child/);
    expect(w.transforms.parent[idx[1]]).toBe(idx[0]);
  });
  it('resetting an existing transform detaches it and orphans its children coherently', () => {
    const { w, idx, sys } = makeWorld(3);
    const t = w.transforms;
    t.setParent(idx[1], idx[0]); t.setParent(idx[2], idx[1]);
    sys.update();
    t.add(idx[1], 5, 0, 0);
    sys.update();
    expect(t.firstChild[idx[0]]).toBe(-1);
    expect(t.parent[idx[1]]).toBe(-1);
    expect(t.parent[idx[2]]).toBe(-1);
    expect(t.depth[idx[2]]).toBe(0);
    expect(t.worldMatrices[idx[1] * 16 + 12]).toBe(5);
    expect(t.worldMatrices[idx[2] * 16 + 12]).toBe(2);
  });
});
