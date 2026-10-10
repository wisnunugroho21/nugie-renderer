import { BatchList } from './BatchBuilder';
import { RenderQueueBuilder, RenderQueues } from './RenderQueue';
import type { MaterialManager, PassTarget } from './materials/MaterialManager';

/** Reused batch state shared by frame preparation and pass recording. */
export interface FrameState {
  /** Clustered lights are active for this view. */
  useClusters: boolean;
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

/** Draw preparation owned by one view. Swap this one object when rendering another camera,
 * keeping its queue sort history, batch scratch and pipelines together.
 */
export class RenderDrawState {
  readonly queueBuilder = new RenderQueueBuilder();
  readonly queues = new RenderQueues();
  readonly batches = new BatchList();
  readonly pipelines = new DrawPipelineCache();
  readonly frame: FrameState = {
    useClusters: false, total: 0, total01: 0, byteOffset: 0, instData: new Uint32Array(0),
    gpuCull: false, nCullBatches: 0, transmissive: false,
  };
}
