import type { GPUStats } from './GPUStats';

/** Everything that distinguishes one render pipeline from another. */
export interface PipelineKey {
  /** Shader identity incl. variant defines (see ShaderManager.key). */
  shader: string;
  vertexEntry?: string;
  fragmentEntry?: string | null;
  vertexLayout: { stride: number; stepMode?: GPUVertexStepMode; attributes: { location: number; offset: number; format: GPUVertexFormat }[] }[];
  topology: GPUPrimitiveTopology;
  cullMode: GPUCullMode;
  frontFace?: GPUFrontFace;
  depth: { format: GPUTextureFormat; write: boolean; compare: GPUCompareFunction; bias?: number; slopeBias?: number } | null;
  targets: { format: GPUTextureFormat; blend?: GPUBlendState | null; writeMask?: number }[];
  sampleCount: number;
  /** Distinguishes pipeline layouts (e.g. bind-group layout set id). */
  layout?: string;
}

/** Canonical string for a pipeline key. */
export function pipelineKeyString(k: PipelineKey): string {
  return JSON.stringify([
    k.shader, k.vertexEntry ?? 'vs_main', k.fragmentEntry === undefined ? 'fs_main' : k.fragmentEntry,
    k.vertexLayout.map((l) => [l.stride, l.stepMode ?? 'vertex', l.attributes.map((a) => [a.location, a.offset, a.format])]),
    k.topology, k.cullMode, k.frontFace ?? 'ccw', k.depth,
    k.targets.map((t) => [t.format, t.blend ?? null, t.writeMask ?? 0xf]),
    k.sampleCount, k.layout ?? 'auto',
  ]);
}

/**
 * Pipeline cache. Rule: no createRenderPipeline() during steady-state rendering. After
 * `freeze()`, any miss still works but is counted (and warned about once) as a violation.
 */
export class PipelineCache {
  private render = new Map<string, GPURenderPipeline>();
  private compute = new Map<string, GPUComputePipeline>();
  private priming = new Map<string, Promise<void>>();
  private frozen = false;
  private warned = false;

  /** Create an empty cache that reports to `stats`. */
  constructor(private stats: GPUStats) {}

  /** Mark end of warm-up; further creations are counted as violations. */
  freeze(): void { this.frozen = true; }
  /** True once `freeze()` was called. */
  get isFrozen(): boolean { return this.frozen; }
  /** Allow pipeline creation again without counting violations. */
  unfreeze(): void { this.frozen = false; }

  /** Return the render pipeline for `key`, calling `create` on a miss (counted as a violation after `freeze()`). */
  getRender(key: PipelineKey, create: () => GPURenderPipeline): GPURenderPipeline {
    return this.lookup(this.render, pipelineKeyString(key), create);
  }

  /** Warm-up: build a pipeline asynchronously (no main-thread stall) and store it; counted as a creation but never as a violation. */
  async primeRender(key: PipelineKey, createAsync: () => Promise<GPURenderPipeline>): Promise<void> {
    const k = pipelineKeyString(key);
    if (this.render.has(k)) return;
    const pending = this.priming.get(k);
    if (pending) return pending;
    // Defer creation one microtask so the promise is registered even for synchronous factory failures.
    const task = Promise.resolve().then(createAsync).then((pipeline) => {
      if (this.render.has(k)) return; // lost a race with synchronous creation
      this.stats.pipelineCreations++;
      this.render.set(k, pipeline);
    });
    this.priming.set(k, task);
    try { await task; } finally { this.priming.delete(k); }
  }

  /** Return the compute pipeline stored under the string `key`, creating it on a miss. */
  getCompute(key: string, create: () => GPUComputePipeline): GPUComputePipeline {
    return this.lookup(this.compute, key, create);
  }

  /** Shared hit / miss logic for both pipeline maps, including the post-freeze violation accounting. */
  private lookup<T>(map: Map<string, T>, key: string, create: () => T): T {
    const hit = map.get(key);
    if (hit) { this.stats.pipelineHits++; return hit; }
    this.stats.pipelineMisses++;
    this.stats.pipelineCreations++;
    if (this.frozen) {
      this.stats.pipelineCreationsAfterFreeze++;
      if (!this.warned) { this.warned = true; console.warn('Pipeline created after freeze (steady-state violation):', key.slice(0, 120)); }
    }
    const p = create();
    map.set(key, p);
    return p;
  }

  /** Total cached pipelines (render + compute). */
  get size(): number { return this.render.size + this.compute.size; }
}
