import { describe, expect, it } from 'vitest';
import type { MeshData } from '../src/rendering/primitives';
import { createCube, createUVSphere } from '../src/rendering/primitives';
import {
  createCylinder, createCone, createCapsule, createLathe, createTorus, createTorusKnot, createTube, sampleCatmullRom, createQuad,
  createPlaneGrid, createCircle, createRing, createShape, createExtrude, triangulatePolygon, polygonArea,
  createTetrahedron, createOctahedron, createIcosahedron, createDodecahedron,
} from '../src/rendering/shapes';

const F = 12;

interface Report { triangles: number; degenerate: number; volume: number; area: number; openEdges: number; badEdges: number; badWinding: number; bounds: number[]; }

/** Structural checks shared by every shape + a few measurements (signed volume, area, boundary edges after welding positions). */
function inspect(m: MeshData): Report {
  const v = m.vertices, idx = m.indices, n = v.length / F;
  expect(Number.isInteger(n)).toBe(true);
  expect(idx.length % 3).toBe(0);
  for (let i = 0; i < v.length; i++) expect(Number.isFinite(v[i])).toBe(true);
  for (let i = 0; i < idx.length; i++) expect(idx[i]).toBeLessThan(n);
  for (let i = 0; i < n; i++) {
    const o = i * F;
    expect(Math.hypot(v[o + 3], v[o + 4], v[o + 5])).toBeCloseTo(1, 3);          // unit normal
    expect(Math.hypot(v[o + 8], v[o + 9], v[o + 10])).toBeCloseTo(1, 3);         // unit tangent
    expect(Math.abs(v[o + 11])).toBe(1);                                          // handedness
    expect(v[o + 6]).toBeGreaterThanOrEqual(-1e-6); expect(v[o + 7]).toBeGreaterThanOrEqual(-1e-6);
  }
  const key = (i: number) => `${Math.round(v[i * F] * 1e4)},${Math.round(v[i * F + 1] * 1e4)},${Math.round(v[i * F + 2] * 1e4)}`;
  const edges = new Map<string, number>();
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { bounds[k] = Math.min(bounds[k], v[i * F + k]); bounds[k + 3] = Math.max(bounds[k + 3], v[i * F + k]); }
  let volume = 0, area = 0, degenerate = 0, badWinding = 0, triangles = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const p = (i: number) => [v[i * F], v[i * F + 1], v[i * F + 2]];
    const pa = p(a), pb = p(b), pc = p(c);
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const ar = Math.hypot(cr[0], cr[1], cr[2]) / 2;
    if (ar < 1e-9) { degenerate++; continue; }
    triangles++;
    area += ar;
    volume += (pa[0] * (pb[1] * pc[2] - pb[2] * pc[1]) - pa[1] * (pb[0] * pc[2] - pb[2] * pc[0]) + pa[2] * (pb[0] * pc[1] - pb[1] * pc[0])) / 6;
    const nsum = [0, 1, 2].map((k) => v[a * F + 3 + k] + v[b * F + 3 + k] + v[c * F + 3 + k]);
    if (cr[0] * nsum[0] + cr[1] * nsum[1] + cr[2] * nsum[2] <= 0) badWinding++;
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const kx = key(x), ky = key(y);
      if (kx === ky) continue;
      const ek = kx < ky ? `${kx}|${ky}` : `${ky}|${kx}`;
      edges.set(ek, (edges.get(ek) ?? 0) + 1);
    }
  }
  let openEdges = 0, badEdges = 0;
  for (const c of edges.values()) { if (c === 1) openEdges++; else if (c !== 2) badEdges++; }
  return { triangles, degenerate, volume, area, openEdges, badEdges, badWinding, bounds };
}

const closeTo = (a: number, b: number, rel = 0.01) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.abs(b));

describe('closed shapes are watertight, outward and have the analytic volume', () => {
  it('cylinder / cone / capsule / torus', () => {
    let r = inspect(createCylinder({ radiusTop: 0.5, radiusBottom: 0.5, height: 1, radialSegments: 96 }));
    expect([r.openEdges, r.badEdges, r.badWinding]).toEqual([0, 0, 0]);
    closeTo(r.volume, Math.PI * 0.25 * 1, 0.002);
    expect(r.bounds.map((x) => +x.toFixed(3))).toEqual([-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]);

    r = inspect(createCone({ radius: 0.5, height: 1, radialSegments: 96 }));
    expect([r.openEdges, r.badEdges, r.badWinding]).toEqual([0, 0, 0]);
    closeTo(r.volume, Math.PI * 0.25 / 3, 0.002);

    r = inspect(createCylinder({ radiusTop: 0.3, radiusBottom: 0.6, height: 2, radialSegments: 96, heightSegments: 3 }));
    expect([r.openEdges, r.badEdges, r.badWinding]).toEqual([0, 0, 0]);
    closeTo(r.volume, (Math.PI * 2 / 3) * (0.09 + 0.18 + 0.36), 0.002);   // frustum

    r = inspect(createCapsule({ radius: 0.25, length: 0.5, radialSegments: 96, capSegments: 24 }));
    expect([r.openEdges, r.badEdges, r.badWinding]).toEqual([0, 0, 0]);
    closeTo(r.volume, Math.PI * 0.0625 * 0.5 + (4 / 3) * Math.PI * 0.015625, 0.005);
    expect(r.bounds[4]).toBeCloseTo(0.5, 3);                              // half height = length / 2 + radius

    r = inspect(createTorus({ radius: 0.4, tube: 0.1, tubularSegments: 96, radialSegments: 48 }));
    expect([r.openEdges, r.badEdges, r.badWinding]).toEqual([0, 0, 0]);
    closeTo(r.volume, 2 * Math.PI * Math.PI * 0.4 * 0.01, 0.005);
  });

  it('torus knot and tubes are closed surfaces with unit normals', () => {
    const k = inspect(createTorusKnot({ tubularSegments: 200, radialSegments: 12 }));
    expect([k.openEdges, k.badEdges]).toEqual([0, 0]);
    expect(k.volume).toBeGreaterThan(0);
    expect(k.badWinding).toBe(0);

    const ring = Array.from({ length: 24 }, (_, i): [number, number, number] => [Math.cos((i / 24) * 2 * Math.PI), Math.sin((i / 24) * 2 * Math.PI) * 0.5, 0]);
    const t = inspect(createTube(ring, { radius: 0.1, radialSegments: 12, closed: true }));
    expect([t.openEdges, t.badEdges, t.badWinding]).toEqual([0, 0, 0]);
    expect(t.volume).toBeGreaterThan(0);

    const open = inspect(createTube([[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 1, 1]], { radius: 0.05 }));
    expect(open.badEdges).toBe(0);
    expect(open.badWinding).toBe(0);
    expect(open.openEdges).toBe(2 * 8);                                    // two open rings of 8 edges
  });

  it('polyhedra match the closed-form volumes of the regular solids', () => {
    const R = 0.5;
    const cases: [string, MeshData, number][] = [
      ['tetrahedron', createTetrahedron(R), Math.pow(R * Math.sqrt(8 / 3), 3) / (6 * Math.SQRT2)],
      ['octahedron', createOctahedron(R), (Math.SQRT2 / 3) * Math.pow(R * Math.SQRT2, 3)],
      ['icosahedron', createIcosahedron(R), (5 / 12) * (3 + Math.sqrt(5)) * Math.pow(R / Math.sin(2 * Math.PI / 5), 3)],
      ['dodecahedron', createDodecahedron(R), ((15 + 7 * Math.sqrt(5)) / 4) * Math.pow((2 * R) / (Math.sqrt(3) * (1 + Math.sqrt(5)) / 2), 3)],
    ];
    for (const [name, mesh, volume] of cases) {
      const r = inspect(mesh);
      expect(r.openEdges, name).toBe(0);
      expect(r.badEdges, name).toBe(0);
      expect(r.badWinding, name).toBe(0);
      closeTo(r.volume, volume, 0.001);
    }
    expect(inspect(createDodecahedron(R)).triangles).toBe(36);
    expect(inspect(createIcosahedron(R)).triangles).toBe(20);
  });

  it('subdividing (detail) approaches a sphere and uses smooth normals', () => {
    const m = createIcosahedron(0.5, 3);
    const r = inspect(m);
    expect(r.triangles).toBe(20 * 16);
    expect([r.openEdges, r.badEdges, r.badWinding]).toEqual([0, 0, 0]);
    closeTo(r.volume, (4 / 3) * Math.PI * 0.125, 0.04);
    for (let i = 0; i < m.vertices.length / F; i++) {                       // smooth: the normal is the radial direction
      const o = i * F, l = Math.hypot(m.vertices[o], m.vertices[o + 1], m.vertices[o + 2]);
      expect(l).toBeCloseTo(0.5, 4);
      expect(m.vertices[o + 3] * m.vertices[o] / l + m.vertices[o + 4] * m.vertices[o + 1] / l + m.vertices[o + 5] * m.vertices[o + 2] / l).toBeCloseTo(1, 4);
    }
    const flat = createIcosahedron(0.5, 0);
    const n0 = [flat.vertices[3], flat.vertices[4], flat.vertices[5]], n1 = [flat.vertices[F + 3], flat.vertices[F + 4], flat.vertices[F + 5]];
    expect(n0).toEqual(n1);                                                 // flat shading: the three corners of a face share its normal
  });

  it('extrude is a closed prism with area * depth volume', () => {
    const L = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]] as const;     // L-shaped (concave)
    const r = inspect(createExtrude(L, { depth: 0.5 }));
    expect([r.openEdges, r.badEdges, r.badWinding]).toEqual([0, 0, 0]);
    closeTo(r.volume, 3 * 0.5, 1e-6);
    const cw = inspect(createExtrude([...L].reverse(), { depth: 0.5 }));      // winding of the input does not matter
    expect([cw.openEdges, cw.badEdges, cw.badWinding]).toEqual([0, 0, 0]);
    closeTo(cw.volume, 1.5, 1e-6);
  });

  it('sphere and cube stay valid under the same checks', () => {
    for (const m of [createUVSphere(32, 16), createCube()]) {
      const r = inspect(m);
      expect(r.badWinding).toBe(0);
      expect(r.volume).toBeGreaterThan(0);
    }
  });
});

describe('open and flat shapes', () => {
  it('lathe of a vase profile has outward normals and the profile bounds', () => {
    const profile: [number, number][] = [[0.1, -0.5], [0.3, -0.3], [0.2, 0], [0.35, 0.3], [0.25, 0.5]];
    const m = createLathe(profile, { segments: 32 });
    const r = inspect(m);
    expect(r.badWinding).toBe(0);
    expect(r.bounds[1]).toBeCloseTo(-0.5, 5); expect(r.bounds[4]).toBeCloseTo(0.5, 5);
    expect(r.bounds[3]).toBeCloseTo(0.35, 3);
    for (let i = 0; i < m.vertices.length / F; i++) {                       // at least roughly pointing away from the axis
      const o = i * F;
      expect(m.vertices[o + 3] * m.vertices[o] + m.vertices[o + 5] * m.vertices[o + 2]).toBeGreaterThan(-1e-6);
    }
    expect(() => createLathe([[1, 0]])).toThrow();
    const flipped = createLathe(profile, { flipNormals: true });
    expect(flipped.vertices[3]).toBeCloseTo(-m.vertices[3], 6);
  });

  it('quad, plane grid, circle and ring face the documented directions with the right area', () => {
    const q = inspect(createQuad());
    closeTo(q.area, 1, 1e-6); expect(q.badWinding).toBe(0);
    const qm = createQuad(); expect([qm.vertices[3], qm.vertices[4], qm.vertices[5]]).toEqual([0, 0, 1]);

    const g = createPlaneGrid(4, 6);
    const gr = inspect(g);
    closeTo(gr.area, 1, 1e-6); expect(gr.badWinding).toBe(0); expect(g.vertices.length / F).toBe(5 * 7);
    expect(g.vertices[4]).toBe(1);

    const c = inspect(createCircle({ radius: 0.5, segments: 256 }));
    closeTo(c.area, Math.PI * 0.25, 0.001); expect(c.badWinding).toBe(0);

    const ring = inspect(createRing({ innerRadius: 0.25, outerRadius: 0.5, thetaSegments: 256 }));
    closeTo(ring.area, Math.PI * (0.25 - 0.0625), 0.001); expect(ring.badWinding).toBe(0);
  });

  it('triangulatePolygon handles concave polygons of either winding and rejects nothing silently', () => {
    const star: [number, number][] = [];
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.4 : 1, a = (i / 10) * Math.PI * 2; star.push([r * Math.cos(a), r * Math.sin(a)]); }
    for (const poly of [star, [...star].reverse()]) {
      const tris = triangulatePolygon(poly);
      expect(tris.length).toBe((poly.length - 2) * 3);
      let area = 0;
      for (let i = 0; i < tris.length; i += 3) area += polygonArea([poly[tris[i]], poly[tris[i + 1]], poly[tris[i + 2]]]);
      closeTo(Math.abs(area), Math.abs(polygonArea(poly)), 1e-9);
      expect(Math.sign(area)).toBe(Math.sign(polygonArea(poly)));            // winding is preserved
    }
    expect(triangulatePolygon([[0, 0], [1, 0]])).toEqual([]);
    const s = inspect(createShape(star));
    closeTo(s.area, Math.abs(polygonArea(star)), 1e-6);   // vertices are stored as float32
    expect(s.badWinding).toBe(0);
  });

  it('sampleCatmullRom passes through the control points', () => {
    const pts: [number, number, number][] = [[0, 0, 0], [1, 2, 0], [3, 2, 1], [4, 0, 1]];
    const s = sampleCatmullRom(pts, 5);
    expect(s.length).toBe(3 * 5 + 1);
    expect(s[0]).toEqual([0, 0, 0]); expect(s[5]).toEqual(pts[1]); expect(s[10]).toEqual(pts[2]); expect(s[15]).toEqual(pts[3]);
    expect(sampleCatmullRom(pts, 4, true).length).toBe(16);
  });
});
