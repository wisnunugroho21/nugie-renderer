import { describe, it, expect } from 'vitest';
import { generateLODChain } from '../src/geometry/LODGenerator';
import { createUVSphere } from '../src/rendering/primitives';
import { averageCacheMissRatio } from '../src/geometry/MeshOptimizer';

describe('LOD generation', () => {
  const src = createUVSphere(48, 24);
  const chain = generateLODChain(src, [0.5, 0.25, 0.1]);

  it('produces strictly decreasing triangle counts near the requested ratios', () => {
    expect(chain.length).toBe(4);
    for (let i = 1; i < chain.length; i++) expect(chain[i].triangles).toBeLessThan(chain[i - 1].triangles);
    expect(chain[1].ratio).toBeGreaterThan(0.45);
    expect(chain[1].ratio).toBeLessThan(0.62);
    expect(chain[3].ratio).toBeLessThan(0.2);
  });
  it('keeps the silhouette: every vertex of every level stays close to the source sphere', () => {
    for (const lod of chain) {
      const v = lod.mesh.vertices;
      let worst = 0;
      for (let i = 0; i < v.length; i += 12) worst = Math.max(worst, Math.abs(Math.hypot(v[i], v[i + 1], v[i + 2]) - 0.5));
      expect(worst).toBeLessThan(0.07);   // <= 14% of the radius even at 10% of the triangles
      for (const x of v) expect(Number.isFinite(x)).toBe(true);
      for (const i of lod.mesh.indices) expect(i).toBeLessThan(v.length / 12);
    }
  });
  it('outputs are cache-optimised (ACMR is low) and compact (no unused vertices)', () => {
    for (const lod of chain) {
      expect(averageCacheMissRatio(lod.mesh.indices, 16)).toBeLessThan(1.1);
      expect(new Set(lod.mesh.indices).size).toBe(lod.mesh.vertices.length / 12);
    }
  });
});
