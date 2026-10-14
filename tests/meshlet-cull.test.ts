import { describe, expect, it } from 'vitest';
import { buildMeshlets, coneBackfacing } from '../src/geometry/MeshOptimizer';
import { meshletVisible } from '../src/rendering/MeshletCuller';
import { Mat4 } from '../src/math/Mat4';
import { Frustum } from '../src/math/Frustum';

function sphere(seg: number): { positions: Float32Array; indices: Uint32Array } {
  const positions: number[] = [], indices: number[] = [];
  for (let r = 0; r <= seg; r++) for (let s = 0; s <= seg; s++) {
    const th = (r / seg) * Math.PI, ph = (s / seg) * 2 * Math.PI;
    positions.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
  }
  for (let r = 0; r < seg; r++) for (let s = 0; s < seg; s++) {
    const a = r * (seg + 1) + s, b = a + seg + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

/** Six planes that contain everything (no frustum culling). */
const EVERYTHING = Float32Array.from([1, 0, 0, 1e6, -1, 0, 0, 1e6, 0, 1, 0, 1e6, 0, -1, 0, 1e6, 0, 0, 1, 1e6, 0, 0, -1, 1e6]);

describe('meshletVisible (CPU reference of the GPU meshlet culling)', () => {
  const s = sphere(24), set = buildMeshlets(s.positions, s.indices, 64, 124);

  it('with an identity model and no frustum it agrees with the cone test', () => {
    const model = Mat4.create();
    for (const eye of [[0, 0, 5], [4, 3, 2], [-6, 1, -1], [0.2, 9, 0.1]]) {
      for (let i = 0; i < set.count; i++) expect(meshletVisible(set, i, model, EVERYTHING, eye)).toBe(!coneBackfacing(set, i, eye));
    }
  });

  it('culls meshlets outside the frustum', () => {
    const frustum = new Frustum();
    const view = Mat4.lookAt(Mat4.create(), 0, 0, 5, 0, 0, 20);   // looking away from the sphere
    frustum.setFromViewProjection(Mat4.multiply(Mat4.create(), Mat4.perspective(Mat4.create(), 1, 1.5, 0.1, 100), view));
    for (let i = 0; i < set.count; i++) expect(meshletVisible(set, i, Mat4.create(), frustum.planes, [0, 0, 5])).toBe(false);
  });

  it('follows the model transform: a far-away object is outside a near-only frustum', () => {
    const frustum = new Frustum();
    const view = Mat4.lookAt(Mat4.create(), 0, 0, 5, 0, 0, 0);
    frustum.setFromViewProjection(Mat4.multiply(Mat4.create(), Mat4.perspective(Mat4.create(), 1, 1, 0.1, 20), view));
    const moved = Mat4.compose(Mat4.create(), 0, 0, -200, 0, 0, 0, 1, 1, 1, 1);
    let kept = 0, keptMoved = 0;
    for (let i = 0; i < set.count; i++) {
      if (meshletVisible(set, i, Mat4.create(), frustum.planes, [0, 0, 5])) kept++;
      if (meshletVisible(set, i, moved, frustum.planes, [0, 0, 5])) keptMoved++;
    }
    expect(kept).toBeGreaterThan(0);
    expect(keptMoved).toBe(0);
  });

  it('a positive margin never keeps fewer meshlets than a negative one', () => {
    const frustum = new Frustum();
    const view = Mat4.lookAt(Mat4.create(), 3, 2, 3, 0, 0, 0);
    frustum.setFromViewProjection(Mat4.multiply(Mat4.create(), Mat4.perspective(Mat4.create(), 0.5, 1, 0.1, 50), view));
    for (let i = 0; i < set.count; i++) {
      const strict = meshletVisible(set, i, Mat4.create(), frustum.planes, [3, 2, 3], -0.01);
      const loose = meshletVisible(set, i, Mat4.create(), frustum.planes, [3, 2, 3], 0.01);
      if (strict) expect(loose).toBe(true);
    }
  });
});
