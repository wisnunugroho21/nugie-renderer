import { describe, expect, it } from 'vitest';
import { World } from '../src/ecs/World';
import { entityIndex } from '../src/ecs/Entity';

function setup() {
  const world = new World();
  const mk = () => entityIndex(world.create());
  return { world, mk, m: world.morphs };
}

describe('MorphStore', () => {
  it('allocates contiguous ranges from one shared pool', () => {
    const { m, mk } = setup();
    const a = mk(), b = mk();
    m.add(a, 3, [1, 2, 3]); m.add(b, 2, [4, 5]);
    expect(m.weightOffset[a]).toBe(0); expect(m.weightOffset[b]).toBe(3);
    expect(Array.from(m.weights.subarray(0, 5))).toEqual([1, 2, 3, 4, 5]);
    expect(m.poolUsed).toBe(5);
  });
  it('grows the pool preserving data', () => {
    const { m, mk } = setup();
    const e = mk(); m.add(e, 2, [9, 8]);
    for (let i = 0; i < 300; i++) m.add(mk(), 4);
    expect(m.weights[0]).toBe(9); expect(m.weights[1]).toBe(8);
    expect(m.weights.length).toBeGreaterThanOrEqual(m.poolUsed);
  });
  it('tracks changed entities once, and only when a weight actually changes', () => {
    const { m, mk } = setup();
    const e = mk(); m.add(e, 2, [0, 0]);
    m.consumeChanged();
    m.setWeights(e, [0, 0]);
    expect(m.changed.length).toBe(0);            // unchanged => nothing to upload
    m.setWeights(e, [0.5, 0]); m.setWeights(e, [0.6, 0.1]);
    expect(m.changed).toEqual([e]);               // deduplicated
    m.consumeChanged();
    expect(m.changed.length).toBe(0);
    m.setWeights(e, [0.6, 0.1]);
    expect(m.changed.length).toBe(0);
  });
  it('freed ranges are reused for same-size allocations (no pool growth)', () => {
    const { world, m, mk } = setup();
    const a = world.create(), ai = entityIndex(a);
    m.add(ai, 4);
    const used = m.poolUsed, off = m.weightOffset[ai];
    world.destroy(a);
    const b = mk(); m.add(b, 4, [1, 1, 1, 1]);
    expect(m.weightOffset[b]).toBe(off);
    expect(m.poolUsed).toBe(used);
  });
  it('offset reads reflect setWeights source offset', () => {
    const { m, mk } = setup();
    const e = mk(); m.add(e, 2);
    m.setWeights(e, [0, 0, 7, 8], 2);
    expect(Array.from(m.weights.subarray(m.weightOffset[e], m.weightOffset[e] + 2))).toEqual([7, 8]);
  });
});
