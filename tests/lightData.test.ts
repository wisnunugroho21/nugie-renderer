import { describe, it, expect } from 'vitest';
import { LightData, LIGHT_FLOATS, GPU_LIGHT_TYPE } from '../src/rendering/lighting/LightData';
import { LightType } from '../src/ecs/components/LightStore';

const base = { position: [1, 2, 3], direction: [0, 0, -1], color: [1, 0.5, 0.25], intensity: 2, range: 10, innerCone: 0.2, outerCone: 0.5 };

describe('LightData', () => {
  it('packs a point light into the 6 x vec4 layout', () => {
    const L = new LightData();
    L.add({ ...base, type: LightType.Point });
    L.finalize();
    expect(L.count).toBe(1);
    const f = L.data;
    expect([f[0], f[1], f[2], f[3]]).toEqual([1, 2, 3, 10]);
    expect([f[4], f[5], f[6], f[7]]).toEqual([1, 0.5, 0.25, 2]);
    expect(f[11]).toBe(GPU_LIGHT_TYPE.point);
  });

  it('precomputes spot cone cosines and the inverse smoothing range', () => {
    const L = new LightData();
    L.add({ ...base, type: LightType.Spot });
    L.finalize();
    const co = Math.cos(0.5), ci = Math.cos(0.2);
    expect(L.data[12]).toBeCloseTo(co, 6);
    expect(L.data[13]).toBeCloseTo(1 / (ci - co), 4);
  });

  it('folds ambient lights into hemisphere colors without taking a slot', () => {
    const L = new LightData();
    L.add({ ...base, type: LightType.Ambient, color: [0.1, 0.2, 0.3], intensity: 2, groundColor: [0.05, 0.05, 0.05] });
    L.finalize();
    expect(L.count).toBe(0);
    expect(Array.from(L.ambientSky)).toEqual([expect.closeTo(0.2), expect.closeTo(0.4), expect.closeTo(0.6)]);
    expect(L.ambientGround[0]).toBeCloseTo(0.1);
  });

  it('orders directional lights first and keeps relative order', () => {
    const L = new LightData();
    L.add({ ...base, type: LightType.Point, range: 1 });
    L.add({ ...base, type: LightType.Directional, intensity: 5 });
    L.add({ ...base, type: LightType.Point, range: 2 });
    L.finalize();
    expect(L.directionalCount).toBe(1);
    expect(L.data[11]).toBe(GPU_LIGHT_TYPE.directional);
    expect(L.data[LIGHT_FLOATS + 3]).toBe(1);
    expect(L.data[2 * LIGHT_FLOATS + 3]).toBe(2);
  });

  it('groups lights: directional | global (area, unlimited range) | ranged', () => {
    const L = new LightData();
    L.add({ ...base, type: LightType.Point, range: 4 });                    // ranged
    L.add({ ...base, type: LightType.Area, range: 0, halfWidth: 1, halfHeight: 1 });   // global
    L.add({ ...base, type: LightType.Point, range: 0 });                    // unlimited -> global
    L.add({ ...base, type: LightType.Directional });
    L.add({ ...base, type: LightType.Spot, range: 9 });                     // ranged
    L.finalize();
    expect(L.directionalCount).toBe(1);
    expect(L.globalCount).toBe(3);
    expect(L.count).toBe(5);
    expect(L.data[11]).toBe(GPU_LIGHT_TYPE.directional);
    expect(L.data[4 * LIGHT_FLOATS + 3]).toBe(9);   // spot is last (stable order inside the ranged group)
    expect(L.data[3 * LIGHT_FLOATS + 3]).toBe(4);
  });

  it('bumps version only when contents change', () => {
    const L = new LightData();
    const frame = (range: number) => { L.clear(); L.add({ ...base, type: LightType.Point, range }); L.finalize(); return L.version; };
    const v0 = frame(5);
    expect(frame(5)).toBe(v0);
    expect(frame(6)).toBe(v0 + 1);
  });

  it('grows beyond the initial capacity', () => {
    const L = new LightData();
    for (let i = 0; i < 200; i++) L.add({ ...base, type: LightType.Point, range: i });
    L.finalize();
    expect(L.count).toBe(200);
    expect(L.data[199 * LIGHT_FLOATS + 3]).toBe(199);
  });
});
