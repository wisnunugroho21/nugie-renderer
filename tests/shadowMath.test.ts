import { describe, it, expect } from 'vitest';
import { cascadeSplits, cubeFaceOf, fitCascade, fitPoint, fitSpot } from '../src/rendering/shadows/ShadowMath';
import { Mat4 } from '../src/math/Mat4';

const camWorld = (x: number, y: number, z: number) => Mat4.compose(Mat4.create(), x, y, z, 0, 0, 0, 1, 1, 1, 1);

function project(vp: ArrayLike<number>, p: number[]): number[] {
  const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  return [0, 1, 2].map((r) => (vp[r] * p[0] + vp[4 + r] * p[1] + vp[8 + r] * p[2] + vp[12 + r]) / w);
}

describe('shadow math', () => {
  it('cascade splits are increasing and end at the far distance', () => {
    const s = cascadeSplits(0.1, 80, 4, 0.8) as Float32Array;
    for (let i = 1; i < 4; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
    expect(s[3]).toBeCloseTo(80, 3);
    expect(s[0]).toBeGreaterThan(0.1);
  });

  it('cascade contains its camera-frustum slice (all corners inside NDC)', () => {
    const fov = 1.0, aspect = 1.6, d0 = 5, d1 = 20, dir = [0.3, -1, 0.2];
    const r = fitCascade(camWorld(2, 3, 4), fov, aspect, d0, d1, dir, 1024, 100);
    const th = Math.tan(fov / 2);
    for (const z of [d0, d1]) for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [sx * z * th * aspect + 2, sy * z * th + 3, -z + 4];
      const n = project(r.viewProjection, p);
      expect(Math.abs(n[0])).toBeLessThanOrEqual(1.001);
      expect(Math.abs(n[1])).toBeLessThanOrEqual(1.001);
      expect(n[2]).toBeGreaterThanOrEqual(0);
      expect(n[2]).toBeLessThanOrEqual(1);
    }
  });

  it('cascade size is rotation independent and the projection is texel-snapped when the camera translates', () => {
    const a = fitCascade(camWorld(0, 0, 0), 1, 1.5, 1, 30, [0, -1, 0.3], 1024, 100);
    const b = fitCascade(camWorld(0.123, 0, 0.456), 1, 1.5, 1, 30, [0, -1, 0.3], 1024, 100);
    expect(a.radius).toBe(b.radius);
    // the world origin lands on a whole texel in both
    for (const r of [a, b]) {
      const o = project(r.viewProjection, [0, 0, 0]);
      for (const c of [o[0], o[1]]) expect(Math.abs((c * 512) - Math.round(c * 512))).toBeLessThan(1e-3);
    }
  });

  it('spot matrix maps points on the cone axis to the center of the map', () => {
    const s = fitSpot([0, 5, 0], [0, -1, 0], 0.5, 20);
    const n = project(s.viewProjection, [0, 0, 0]);
    expect(Math.abs(n[0])).toBeLessThan(1e-4);
    expect(Math.abs(n[1])).toBeLessThan(1e-4);
    expect(n[2]).toBeGreaterThan(0);
    expect(n[2]).toBeLessThan(1);
    expect(s.tanHalfFov).toBeCloseTo(Math.tan(0.53), 5);
  });

  it('point-light cube faces: the face picked by the major axis always contains the point (NDC xy inside, depth in range)', () => {
    const pos = [3, 2, -1], range = 20, r = fitPoint(pos, range);
    let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 2000; i++) {
      const d = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1], len = Math.hypot(...d), dist = 0.5 + rnd() * 18;
      const p = [pos[0] + d[0] / len * dist, pos[1] + d[1] / len * dist, pos[2] + d[2] / len * dist];
      const n = project(r.faces[cubeFaceOf(d[0], d[1], d[2])], p);
      expect(Math.abs(n[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(n[1])).toBeLessThanOrEqual(1);
      expect(n[2]).toBeGreaterThan(0);
      expect(n[2]).toBeLessThan(1);
    }
    expect(r.tanHalfFov).toBeGreaterThan(1);
  });
});
