import { describe, it, expect } from 'vitest';
import { averageCacheMissRatio, optimizeVertexCache, optimizeVertexFetch, remapVertices, simplify, buildMeshlets, coneBackfacing } from '../src/geometry/MeshOptimizer';

function grid(n: number): { positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array((n + 1) * (n + 1) * 3), idx: number[] = [];
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) { const o = (y * (n + 1) + x) * 3; positions[o] = x / n; positions[o + 1] = Math.sin(x * 0.3) * 0.02 + Math.cos(y * 0.2) * 0.02; positions[o + 2] = y / n; }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = y * (n + 1) + x, b = a + 1, c = a + n + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  return { positions, indices: Uint32Array.from(idx) };
}

function sphere(seg: number): { positions: Float32Array; indices: Uint32Array } {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) for (let j = 0; j <= seg * 2; j++) {
    const th = (i / seg) * Math.PI, ph = (j / (seg * 2)) * Math.PI * 2;
    pos.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
  }
  const w = seg * 2 + 1;
  for (let i = 0; i < seg; i++) for (let j = 0; j < seg * 2; j++) {
    const a = i * w + j, b = a + 1, c = a + w, d = c + 1;
    if (i > 0) idx.push(a, b, c);
    if (i < seg - 1) idx.push(b, d, c);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

function shuffleTris(indices: Uint32Array, seed = 1): Uint32Array {
  const n = indices.length / 3, order = Array.from({ length: n }, (_, i) => i);
  let s = seed;
  for (let i = n - 1; i > 0; i--) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const j = s % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const out = new Uint32Array(indices.length);
  order.forEach((t, i) => { out.set(indices.subarray(t * 3, t * 3 + 3), i * 3); });
  return out;
}

const triSet = (idx: Uint32Array) => {
  const s: string[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    let a = idx[i], b = idx[i + 1], c = idx[i + 2];
    while (!(a <= b && a <= c)) { const t = a; a = b; b = c; c = t; }   // rotate to smallest first: winding-preserving canonical form
    s.push([a, b, c].join(','));
  }
  return s.sort();
};

describe('vertex cache optimisation', () => {
  it('keeps the same triangles (and winding) and improves ACMR on a shuffled mesh', () => {
    const g = grid(40), shuffled = shuffleTris(g.indices);
    const nv = g.positions.length / 3;
    const opt = optimizeVertexCache(shuffled, nv);
    expect(triSet(opt)).toEqual(triSet(shuffled));
    const before = averageCacheMissRatio(shuffled), after = averageCacheMissRatio(opt);
    expect(before).toBeGreaterThan(1.5);
    expect(after).toBeLessThan(0.9);
    expect(after).toBeLessThan(before * 0.5);
  });
  it('vertex fetch optimisation renumbers in first-use order without changing the geometry', () => {
    const g = grid(20), idx = optimizeVertexCache(shuffleTris(g.indices), g.positions.length / 3);
    const original = Uint32Array.from(idx);
    const { remap, vertexCount } = optimizeVertexFetch(idx, g.positions.length / 3);
    const pos = remapVertices(g.positions, 3, remap, vertexCount);
    expect(vertexCount).toBe(g.positions.length / 3);
    for (let i = 0; i < idx.length; i++) for (let k = 0; k < 3; k++) expect(pos[idx[i] * 3 + k]).toBe(g.positions[original[i] * 3 + k]);
    expect(idx[0]).toBe(0);
    expect(Math.max(...idx.subarray(0, 6))).toBeLessThan(6);
  });
});

describe('simplify', () => {
  it('reduces a sphere to the target with small geometric error and no degenerate triangles', () => {
    const s = sphere(32), before = s.indices.length / 3;
    const target = Math.floor(s.indices.length * 0.25 / 3) * 3;
    const r = simplify(s.positions, s.indices, target);
    expect(r.indices.length / 3).toBeLessThanOrEqual(before * 0.3);
    expect(r.indices.length / 3).toBeGreaterThan(before * 0.2);
    for (let i = 0; i < r.indices.length; i += 3) {
      const a = r.indices[i], b = r.indices[i + 1], c = r.indices[i + 2];
      expect(a !== b && b !== c && a !== c).toBe(true);
    }
    let worst = 0;
    for (const v of new Set(r.indices)) worst = Math.max(worst, Math.abs(Math.hypot(s.positions[v * 3], s.positions[v * 3 + 1], s.positions[v * 3 + 2]) - 1));
    expect(worst).toBeLessThan(0.05);
  });
  it('keeps a flat grid flat and preserves its boundary', () => {
    const g = grid(30);
    for (let i = 1; i < g.positions.length; i += 3) g.positions[i] = 0;   // planar
    const r = simplify(g.positions, g.indices, g.indices.length / 4);
    expect(r.indices.length).toBeLessThan(g.indices.length / 3);
    const used = new Set(r.indices);
    let minX = 9, maxX = -9, minZ = 9, maxZ = -9;
    for (const v of used) { minX = Math.min(minX, g.positions[v * 3]); maxX = Math.max(maxX, g.positions[v * 3]); minZ = Math.min(minZ, g.positions[v * 3 + 2]); maxZ = Math.max(maxZ, g.positions[v * 3 + 2]); }
    expect([minX, maxX, minZ, maxZ].map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 1, 0, 1]);
    for (const v of used) expect(Math.abs(g.positions[v * 3 + 1])).toBeLessThan(1e-4);
  });
});

describe('meshlets', () => {
  it('covers every triangle exactly once within the limits, with valid bounds', () => {
    const s = sphere(40);
    const m = buildMeshlets(s.positions, s.indices, 64, 124);
    let tris = 0;
    const seen: string[] = [];
    for (let i = 0; i < m.count; i++) {
      expect(m.vertexCount[i]).toBeLessThanOrEqual(64);
      expect(m.triangleCount[i]).toBeLessThanOrEqual(124);
      tris += m.triangleCount[i];
      for (let t = 0; t < m.triangleCount[i]; t++) {
        const o = (m.triangleOffset[i] + t) * 3;
        const g = [0, 1, 2].map((k) => m.vertices[m.vertexOffset[i] + m.triangles[o + k]]);
        seen.push(g.join(','));
        for (const v of g) {
          const d = Math.hypot(s.positions[v * 3] - m.spheres[i * 4], s.positions[v * 3 + 1] - m.spheres[i * 4 + 1], s.positions[v * 3 + 2] - m.spheres[i * 4 + 2]);
          expect(d).toBeLessThanOrEqual(m.spheres[i * 4 + 3] + 1e-5);
        }
      }
    }
    expect(tris).toBe(s.indices.length / 3);
    expect(new Set(seen).size).toBe(seen.length);
    expect(m.count).toBeLessThan((s.indices.length / 3 / 40) * 3);   // reasonably full clusters
  });
  it('cone culling never removes a meshlet that has a front-facing triangle', () => {
    const s = sphere(24), m = buildMeshlets(s.positions, s.indices, 64, 124);
    const eyes = [[0, 0, 5], [4, 3, 2], [-6, 1, -1], [0.2, 9, 0.1], [1.5, -0.5, 1.2]];
    let culled = 0;
    for (const e of eyes) for (let i = 0; i < m.count; i++) {
      if (!coneBackfacing(m, i, e)) continue;
      culled++;
      for (let t = 0; t < m.triangleCount[i]; t++) {
        const o = (m.triangleOffset[i] + t) * 3, g = [0, 1, 2].map((k) => m.vertices[m.vertexOffset[i] + m.triangles[o + k]]);
        const P = (v: number) => [s.positions[v * 3], s.positions[v * 3 + 1], s.positions[v * 3 + 2]];
        const [a, b, c] = g.map(P);
        const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
        const toTri = [a[0] - e[0], a[1] - e[1], a[2] - e[2]];
        expect(n[0] * toTri[0] + n[1] * toTri[1] + n[2] * toTri[2]).toBeGreaterThanOrEqual(-1e-6);   // facing away (or edge-on)
      }
    }
    expect(culled).toBeGreaterThan(m.count / 2);   // a good share of the back-facing clusters get culled (conservatively)
  });
});
