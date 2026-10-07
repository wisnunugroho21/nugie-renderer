import type { MeshData } from '../rendering/primitives';
import { optimizeVertexCache, optimizeVertexFetch, remapVertices, simplify } from './MeshOptimizer';

const STRIDE = 12;   // position(3) normal(3) uv(2) tangent(4)

export interface GeneratedLOD {
  mesh: MeshData;
  /** Triangle count of the result and the achieved fraction of the source. */
  triangles: number;
  ratio: number;
  /** Largest collapse error (squared distance, mesh units). */
  error: number;
}

/**
 * Simplifies a standard-layout mesh to `ratio` of its triangles (quadric edge collapse), re-normalises the moved vertices'
 * attributes from the survivors, compacts the vertex buffer and optimises it for the vertex cache / fetch.
 * Vertices at UV / normal seams are welded by position so the surface stays closed (each welded group keeps one attribute set).
 */
export function simplifyMesh(src: MeshData, ratio: number): GeneratedLOD {
  const nv = src.vertices.length / STRIDE;
  // weld by position so collapses cannot open cracks at attribute seams
  const keyOf = (v: number) => `${src.vertices[v * STRIDE].toFixed(5)},${src.vertices[v * STRIDE + 1].toFixed(5)},${src.vertices[v * STRIDE + 2].toFixed(5)}`;
  const canon = new Int32Array(nv), byKey = new Map<string, number>();
  for (let v = 0; v < nv; v++) { const k = keyOf(v); const c = byKey.get(k); if (c === undefined) { byKey.set(k, v); canon[v] = v; } else canon[v] = c; }
  const positions = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) positions.set(src.vertices.subarray(v * STRIDE, v * STRIDE + 3), v * 3);
  const welded = Uint32Array.from(src.indices, (i) => canon[i]);
  const target = Math.max(3, Math.floor((src.indices.length * ratio) / 3) * 3);
  const r = simplify(positions, welded, target);
  // output: surviving canonical vertices keep their original attributes but take the optimised position
  const out = new Float32Array(src.vertices.length);
  out.set(src.vertices);
  for (let v = 0; v < nv; v++) if (canon[v] === v) out.set(positions.subarray(v * 3, v * 3 + 3), v * STRIDE);
  let indices = optimizeVertexCache(r.indices, nv);
  const { remap, vertexCount } = optimizeVertexFetch(indices, nv);
  indices = Uint32Array.from(indices);
  const vertices = remapVertices(out, STRIDE, remap, vertexCount);
  return { mesh: { vertices, indices }, triangles: indices.length / 3, ratio: indices.length / src.indices.length, error: r.error };
}

/** A chain of simplified levels (level 0 is the source mesh, optimised for cache/fetch only). */
export function generateLODChain(src: MeshData, ratios: number[] = [0.5, 0.25, 0.1]): GeneratedLOD[] {
  const nv = src.vertices.length / STRIDE;
  let idx0 = optimizeVertexCache(src.indices, nv);
  const f0 = optimizeVertexFetch(idx0, nv);
  idx0 = Uint32Array.from(idx0);
  const base: GeneratedLOD = { mesh: { vertices: remapVertices(src.vertices, STRIDE, f0.remap, f0.vertexCount), indices: idx0 }, triangles: idx0.length / 3, ratio: 1, error: 0 };
  const levels = [base];
  for (const r of ratios) levels.push(simplifyMesh(src, r));
  return levels;
}
