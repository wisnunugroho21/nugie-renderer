import type { GPUContext } from '../gpu/GPUContext';
import type { MeshManager } from './MeshManager';
import type { MaterialManager } from './materials/MaterialManager';
import type { RendererStats } from '../profiling/RendererStats';
import type { FrameUniform } from './FrameUniform';
import type { SceneResources } from './lighting/SceneResources';
import type { GPUCuller } from './GPUCuller';
import type { MeshletDraws } from './MeshletDraws';
import type { ViewState } from './RenderDrawState';
import type { BatchingMode } from './Renderer';
import { TrackedRenderPass } from './graph/TrackedRenderPass';
import { MaterialFeature } from './materials/MaterialFlags';
import { drawVariant, type DrawVariant } from './materials/DrawVariant';

/** Which half of the main view's geometry a draw call covers: opaque + alpha-mask ('early'), blended + transmissive ('late'), or everything. */
export type DrawPart = 'all' | 'early' | 'late';

/** The draw path chosen for a view this frame (see `DrawRecorder.resolveDrawPath`). */
interface DrawPath {
  retained: boolean;
  directional: boolean;
  variant: DrawVariant;
  /** Group-1 bind group: the full scene resources, or the small directional-lights-only group. */
  sceneGroup: GPUBindGroup;
}

/** The pipeline / material currently bound on an encoder, so redundant binds can be skipped. */
interface BoundState { pipeline: GPURenderPipeline | null; material: number; }

/** True when `part` excludes a batch (`late`: drawn after the sky, i.e. blended or transmissive). */
function isSkippedPart(part: DrawPart, late: boolean): boolean {
  return (part === 'early' && late) || (part === 'late' && !late);
}

/** What the draw recorder needs from the renderer: the managers it reads, the retained-path switches and the shared bind-group / pipeline lookups. */
export interface DrawHost {
  readonly gpu: GPUContext;
  readonly stats: RendererStats;
  readonly meshes: MeshManager;
  readonly materials: MaterialManager;
  readonly frameUniform: FrameUniform;
  readonly sceneResources: SceneResources;
  readonly mainView: ViewState;
  readonly culler: GPUCuller | null;
  /** Per-meshlet culled draws of the main view's batches this frame. */
  readonly meshlets: MeshletDraws;
  readonly batching: BatchingMode;
  readonly retainedVertex: boolean;
  readonly retainedLighting: boolean;
  readonly directionalLighting: boolean;
  readonly retainedBundles: boolean;
  /** Generation of the instance ring buffer (part of the storage-path bundle key). */
  readonly instanceGeneration: number;
  objectBindGroup(culled?: boolean): GPUBindGroup;
  directionalObjectBindGroup(): GPUBindGroup;
  pipelineFor(view: ViewState, materialId: number, deformMask: number, variant?: DrawVariant): GPURenderPipeline;
}

/**
 * Records the geometry draw calls of a view into a pass or render bundle: picks the draw path (standard, retained vertex stream,
 * directional-lights-only), issues direct instanced draws, GPU-culled indirect draws or meshlet-culled indirect draws, and replays cached bundles
 * for still scenes.
 */
export class DrawRecorder {
  /** @param host the renderer's state and lookups (see {@link DrawHost}) */
  constructor(private readonly host: DrawHost) {}

  /**
   * Which draw path a view's batches take this frame. The specialised paths (packed per-instance vertex stream, cheap directional-only
   * fragment stage) apply to the main view when its draw preparation was reused, nothing else rewrites the instance records
   * (prepass, GPU culling, off-screen appends) and every batch is an undeformed map-free PBR material.
   */
  private resolveDrawPath(view: ViewState): DrawPath {
    const f = view.draw.frame, cache = view.draw.retained;
    const eligible = view === this.host.mainView && this.host.stats.drawPreparationReused && !view.prepassActive && !f.gpuCull
      && f.byteOffset === 0 && cache.supportsPacked() && this.host.meshes.compactVerticesSupported;
    const retained = this.host.retainedVertex && eligible;
    const directional = this.host.retainedLighting && this.host.directionalLighting && eligible;
    return {
      retained, directional,
      variant: drawVariant({ retained, directional, uniformNormals: cache.uniformNormals }),
      sceneGroup: directional ? this.host.sceneResources.directionalBindGroup : view.sceneBindGroup ?? this.host.sceneResources.bindGroup,
    };
  }

  /** Group-2 bind group of a material for the given path (the directional path binds a small uniform instead of the shared record buffer). */
  private materialGroupFor(path: DrawPath, materialId: number): GPUBindGroup {
    return path.directional ? this.host.materials.getDirectionalBindGroup(materialId) : this.host.materials.getBindGroup(materialId);
  }

  /**
   * Draw loop for opaque / alpha batches. With GPU culling, `'culled'` issues one indirect draw per (batch, LOD level) from the
   * compacted set (arguments start at `argBase`), `'rest'` draws the batches the GPU path does not cover, `'all'` does both.
   * Without GPU culling every batch is drawn directly. `part` selects the early (opaque + alpha-mask) or late (blended + transmissive) half.
   */
  drawGeometry(pass: TrackedRenderPass, view: ViewState, which: 'all' | 'culled' | 'rest', argBase: number, part: DrawPart = 'all'): void {
    const path = this.resolveDrawPath(view);
    if ((path.retained || path.directional) && this.host.retainedBundles && !pass.isBundle) {
      this.drawThroughBundle(pass, view, which, argBase, part, path);
      return;
    }
    const f = view.draw.frame, gpuCull = f.gpuCull, culledDraws = gpuCull && which !== 'rest';
    pass.setBindGroup(0, view.frameBindGroup ?? this.host.frameUniform.bindGroup);
    pass.setBindGroup(1, path.sceneGroup);
    if (!path.retained) pass.setBindGroup(3, path.directional ? this.host.directionalObjectBindGroup() : this.host.objectBindGroup(culledDraws));
    pass.setVertexBuffer(0, (path.retained || path.directional) ? this.host.meshes.compactVertexBuffer : this.host.meshes.vertexBuffer);
    pass.setIndexBuffer(this.host.meshes.indexBuffer, 'uint32');
    const bound: BoundState = { pipeline: null, material: -1 };
    if (culledDraws) this.drawIndirect(pass, view, argBase, part, bound);
    if (which === 'culled') return;
    if (gpuCull && which === 'all') pass.setBindGroup(3, this.host.objectBindGroup());   // remaining batches use the uncompacted records
    if (path.retained) pass.setVertexBuffer(1, view.draw.retained.packedBuffer(this.host.gpu));
    this.drawBatches(pass, view, gpuCull ? f.nCullBatches : 0, part, path, bound);
  }

  /** GPU-compacted draws: one indirect draw per (batch, LOD level) in the culler's output. */
  private drawIndirect(pass: TrackedRenderPass, view: ViewState, argBase: number, part: DrawPart, bound: BoundState): void {
    const cu = this.host.culler!, mats = this.host.materials.materials, st = this.host.stats;
    for (let v = 0; v < cu.virtualCount; v++) {
      if (isSkippedPart(part, (mats[cu.virtualMaterial[v]].features & MaterialFeature.Transmission) !== 0)) continue;
      const matId = cu.virtualMaterial[v];
      this.bindPipelineAndMaterial(pass, bound, this.host.pipelineFor(view, matId, this.host.meshes.get(cu.virtualMesh[v]).deformMask), matId, this.host.materials.getBindGroup(matId));
      pass.drawIndexedIndirect(cu.argsBuffer, (argBase + v) * 20);
      st.drawCalls++;
    }
  }

  /** Direct instanced draws of batches `first..count`, switching pipeline and material bind group only when they change. */
  private drawBatches(pass: TrackedRenderPass, view: ViewState, first: number, part: DrawPart, path: DrawPath, bound: BoundState): void {
    const b = view.draw.batches, st = this.host.stats, unsorted = this.host.batching === 'unsorted';
    const meshlets = view === this.host.mainView ? this.host.meshlets : null;
    let curMesh = -1;
    for (let i = first; i < b.count; i++) {
      if (isSkippedPart(part, b.late[i] === 1)) continue;
      const matId = b.materialId[i], meshId = b.meshId[i];
      const mesh = this.host.meshes.get(meshId);
      const pipe = this.host.pipelineFor(view, matId, mesh.deformMask, path.variant);
      // the unsorted baseline reports its (large) state-change counts here, since nothing was sorted to count them from
      if (pipe !== bound.pipeline && unsorted) st.pipelineSwitches++;
      if (matId !== bound.material && unsorted) st.materialSwitches++;
      if (unsorted && meshId !== curMesh) st.meshSwitches++;
      curMesh = meshId;
      this.bindPipelineAndMaterial(pass, bound, pipe, matId, this.materialGroupFor(path, matId));
      const culler = meshlets?.cullerFor(i) ?? null;
      if (culler) {
        // the surviving triangles of the culling pass (mesh-local indices; the arguments carry baseVertex / firstInstance)
        pass.setIndexBuffer(culler.indexBuffer, 'uint32');
        pass.drawIndexedIndirect(culler.argsBuffer, 0);
        pass.setIndexBuffer(this.host.meshes.indexBuffer, 'uint32');
      } else {
        pass.drawIndexed(mesh.indexCount, b.instanceCount[i], mesh.firstIndex, mesh.baseVertex, b.firstInstance[i]);
        st.triangles += (mesh.indexCount / 3) * b.instanceCount[i];   // (meshlet draws: the GPU decides; see `stats.meshlets`)
      }
      if (path.retained) st.retainedVertexDraws++;
      if (path.directional) st.retainedLightingDraws++;
      st.drawCalls++;
      st.instances += b.instanceCount[i];
    }
  }

  /** Set the pipeline / material bind group (group 2) unless they are already the bound ones. */
  private bindPipelineAndMaterial(pass: TrackedRenderPass, bound: BoundState, pipeline: GPURenderPipeline, materialId: number, materialGroup: GPUBindGroup): void {
    if (pipeline !== bound.pipeline) { pass.setPipeline(pipeline); bound.pipeline = pipeline; }
    if (materialId !== bound.material) { pass.setBindGroup(2, materialGroup); bound.material = materialId; }
  }

  /**
   * Draw a specialised-path part through a cached render bundle. The bundle is re-recorded only when its signature changes: target formats,
   * the bind groups / buffers it references and, per draw, the pipeline, material group and geometry ranges. Camera, light and material
   * contents change inside the same buffers, so a still scene replays its commands unchanged.
   */
  private drawThroughBundle(pass: TrackedRenderPass, view: ViewState, which: 'all' | 'culled' | 'rest', argBase: number, part: DrawPart, path: DrawPath): void {
    const st = this.host.stats, target = view.target, cache = view.draw.retained, b = view.draw.batches;
    const signature: unknown[] = [target.colorFormat, target.depthFormat, target.sampleCount,
      this.host.frameUniform.bindGroup, path.sceneGroup, this.host.meshes.compactVertexBuffer, this.host.meshes.indexBuffer,
      path.retained ? cache.packedBuffer(this.host.gpu) : this.host.directionalObjectBindGroup()];
    let draws = 0;
    for (let i = 0; i < b.count; i++) {
      if (isSkippedPart(part, b.late[i] === 1)) continue;
      const m = this.host.meshes.get(b.meshId[i]);
      signature.push(this.host.pipelineFor(view, b.materialId[i], 0, path.variant), this.materialGroupFor(path, b.materialId[i]),
        m.indexCount, m.firstIndex, m.baseVertex, b.instanceCount[i], b.firstInstance[i], this.host.meshlets.cullerFor(i));
      draws++;
    }
    if (draws === 0) return;
    // the packed stream is rebuilt per retained revision; the storage-based path binds the current ring slot's buffer
    const bundleKey = path.retained ? part : `${part}:${this.host.instanceGeneration}`;
    let saved = view.draw.bundles.get(bundleKey, signature);
    if (!saved) {
      const encoder = this.host.gpu.device.createRenderBundleEncoder({ label: 'retained-' + part,
        colorFormats: [target.colorFormat!], depthStencilFormat: target.depthFormat, sampleCount: target.sampleCount });
      const before = [st.drawCalls, st.instances, st.triangles];
      this.drawGeometry(new TrackedRenderPass(encoder), view, which, argBase, part);   // records through the ordinary path (a bundle encoder is not a pass, so no recursion)
      const counts: [number, number, number] = [st.drawCalls - before[0], st.instances - before[1], st.triangles - before[2]];
      saved = view.draw.bundles.set(bundleKey, signature, encoder.finish(), counts);
    } else {
      if (path.retained) st.retainedVertexDraws += saved.counts[0];
      if (path.directional) st.retainedLightingDraws += saved.counts[0];
      st.drawCalls += saved.counts[0]; st.instances += saved.counts[1]; st.triangles += saved.counts[2];
    }
    pass.executeBundles([saved.bundle]);   // (clears the wrapper's cache: a replayed bundle leaves the pass with no bindings)
    st.retainedBundleDraws += draws;
  }
}
