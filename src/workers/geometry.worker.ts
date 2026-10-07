/// <reference lib="webworker" />
import { generateLODChain } from '../geometry/LODGenerator';
import { buildMeshlets } from '../geometry/MeshOptimizer';

/** Geometry jobs run off the main thread. Messages: { type: 'lod', vertices, indices, ratios } | { type: 'meshlets', positions, indices }. */
self.onmessage = (e: MessageEvent) => {
  const m = e.data as { type: string; vertices?: Float32Array; indices: Uint32Array; ratios?: number[]; positions?: Float32Array };
  try {
    if (m.type === 'lod') {
      const levels = generateLODChain({ vertices: m.vertices!, indices: m.indices }, m.ratios);
      const transfer: Transferable[] = [];
      for (const l of levels) transfer.push(l.mesh.vertices.buffer, l.mesh.indices.buffer);
      (self as unknown as Worker).postMessage({ levels }, transfer);
    } else if (m.type === 'meshlets') {
      const set = buildMeshlets(m.positions!, m.indices);
      (self as unknown as Worker).postMessage({ set }, [set.vertices.buffer, set.triangles.buffer, set.spheres.buffer, set.cones.buffer]);
    } else (self as unknown as Worker).postMessage({ error: 'unknown job ' + m.type });
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: String(err) });
  }
};
