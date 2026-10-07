import type { MeshData } from '../rendering/primitives';
import { generateLODChain, type GeneratedLOD } from '../geometry/LODGenerator';
import { WorkerPool, type WorkerLike } from './WorkerPool';

let pool: WorkerPool | null = null;

/** The shared geometry worker pool (created on first use; null where Workers do not exist, e.g. Node tests). */
export function geometryPool(): WorkerPool | null {
  if (pool) return pool;
  if (typeof Worker === 'undefined') return null;
  pool = new WorkerPool(() => new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike);
  return pool;
}

/**
 * LOD chain generation off the main thread. The source buffers are COPIED to the worker (the caller keeps its mesh); results come
 * back as transferred buffers. Falls back to running synchronously when no worker is available.
 */
export async function generateLODChainAsync(src: MeshData, ratios?: number[], priority = 0): Promise<GeneratedLOD[]> {
  const p = geometryPool();
  if (!p) return generateLODChain(src, ratios);
  const vertices = src.vertices.slice(), indices = src.indices.slice();
  const r = await p.run<{ levels: GeneratedLOD[] }>({ type: 'lod', vertices, indices, ratios }, [vertices.buffer, indices.buffer], priority);
  return r.levels;
}
