import { BatchList } from './BatchBuilder';
import { RenderQueueBuilder, RenderQueues } from './RenderQueue';
import type { MaterialManager, PassTarget } from './materials/MaterialManager';

/** Reused batch state shared by frame preparation and pass recording. */
export interface FrameState {
  /** Objects across all queues / opaque and alpha-mask queues. */
  total: number;
  total01: number;
  /** Instance records' byte offset in the current ring buffer. */
  byteOffset: number;
  instData: Uint32Array;
  /** The leading `nCullBatches` batches use GPU compaction and indirect draws. */
  gpuCull: boolean;
  nCullBatches: number;
  /** A visible batch requires the opaque colour copy for refraction. */
  transmissive: boolean;
}

/** Pipeline lookups for a single render target; invalidated when its format or sample count changes. */
class DrawPipelineCache {
  private pipelines: (GPURenderPipeline | undefined)[] = [];
  private sortIds: number[] = [];
  private failures: boolean[] = [];

  get(materials: MaterialManager, target: PassTarget, materialId: number, deformMask: number): GPURenderPipeline {
    const material = materials.get(materialId);
    const slot = materialId * 4 + deformMask;
    const cached = this.pipelines[slot];
    if (cached && this.sortIds[slot] === material.pipelineSortId && this.failures[slot] === material.failed) return cached;
    const pipeline = materials.getPipeline(materialId, target, deformMask);
    this.pipelines[slot] = pipeline;
    this.sortIds[slot] = material.pipelineSortId;
    this.failures[slot] = material.failed;
    return pipeline;
  }

  clear(): void {
    this.pipelines.length = 0;
    this.sortIds.length = 0;
    this.failures.length = 0;
  }
}

/** Draw preparation owned by one view: queue sort history, batch scratch and the pipeline lookups, kept together. */
export class RenderDrawState {
  readonly queueBuilder = new RenderQueueBuilder();
  readonly queues = new RenderQueues();
  readonly batches = new BatchList();
  readonly pipelines = new DrawPipelineCache();
  readonly frame: FrameState = {
    total: 0, total01: 0, byteOffset: 0, instData: new Uint32Array(0),
    gpuCull: false, nCullBatches: 0, transmissive: false,
  };
}

/**
 * Everything that differs between the views the renderer draws: the main view and the off-screen views (mirrors, minimaps, probes). The
 * renderer keeps one `ViewState` per kind and points `view` at the one being drawn, instead of saving and restoring its own fields.
 */
export class ViewState {
  readonly draw = new RenderDrawState();
  /** Formats of the pass this view renders into. Mutated in place when the framebuffer configuration changes. */
  readonly target: PassTarget;
  /** The same target with depth test 'equal': used after a depth prepass. (Off-screen views have no prepass: it is `target` itself.) */
  readonly targetPre: PassTarget;
  /** A depth prepass was laid down this frame, so shading uses `targetPre`. */
  prepassActive = false;
  /** Triangle winding of this view's draws is reversed (mirrors). */
  readonly flipWinding: boolean;

  constructor(target: PassTarget, o: { prepassTarget?: boolean } = {}) {
    this.target = target;
    this.targetPre = o.prepassTarget ? { ...target, depthEqual: true } : target;
    this.flipWinding = target.flipWinding ?? false;
  }

  /** The pass's colour format / sample count changed: update the targets and drop the cached pipelines (they are rebuilt on demand). */
  retarget(colorFormat: GPUTextureFormat, sampleCount: number): void {
    for (const t of new Set([this.target, this.targetPre])) { t.colorFormat = colorFormat; t.sampleCount = sampleCount; }
    this.draw.pipelines.clear();
  }

  /** The target to shade with this frame. */
  get shadingTarget(): PassTarget { return this.prepassActive ? this.targetPre : this.target; }
}
