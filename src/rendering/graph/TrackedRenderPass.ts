/** What a render pass and a render bundle encoder have in common: binding and draw commands. */
type RenderCommands = GPUBindingCommandsMixin & GPURenderCommandsMixin;

/**
 * A render pass encoder (or a render bundle encoder) that remembers what is bound and skips redundant state changes. A `render` node (see TechniqueTypes.ts) hands one to the
 * host's `record` function and to each of its segments: the host issues its draws in any order (a batch list, one draw per material and mesh, the sky, particles) and only the
 * pipeline, bind group, vertex buffer or index buffer switches that actually change anything reach the GPU. Everything that draws into one pass should go through the same
 * wrapper, so the cache describes what is really bound.
 *
 * Bind groups set with dynamic offsets are always forwarded (the same group at another offset is a different binding); the cache then forgets that group. Call
 * `invalidate()` after anything that changes the encoder's state behind the wrapper's back (the raw `encoder`, `executeBundles`).
 */
export class TrackedRenderPass {
  private pipeline: GPURenderPipeline | null = null;
  private groups: (GPUBindGroup | null)[] = [null, null, null, null];
  private vertex: { buffer: GPUBuffer; offset: number; size: number | undefined }[] = [];
  private index: { buffer: GPUBuffer; format: GPUIndexFormat; offset: number } | null = null;

  /** Draw calls issued through this wrapper. */
  drawCalls = 0;
  /** State changes that reached the GPU, and the ones that were already in effect. */
  switches = { pipeline: 0, bindGroup: 0, vertexBuffer: 0, indexBuffer: 0 };
  skipped = { pipeline: 0, bindGroup: 0, vertexBuffer: 0, indexBuffer: 0 };

  private readonly commands: RenderCommands;

  /** `encoder` is the real pass or bundle encoder, for anything not covered here (viewport, scissor, blend constant ...); use `invalidate()` after changing state on it directly. */
  constructor(readonly encoder: GPURenderPassEncoder | GPURenderBundleEncoder) {
    this.commands = encoder;
  }

  /** Recording into a render bundle (which cannot execute other bundles, and starts with no state). */
  get isBundle(): boolean { return !('executeBundles' in this.encoder); }

  /** Forget everything that is bound (after raw encoder use or a bundle replay, which leaves the pass with no bindings). */
  invalidate(): void {
    this.pipeline = null;
    this.groups.fill(null);
    this.vertex.length = 0;
    this.index = null;
  }

  /** Replay recorded bundles; the pass's bound state is undefined afterwards, so the cache is cleared. */
  executeBundles(bundles: Iterable<GPURenderBundle>): void {
    if (this.isBundle) throw new Error('a render bundle cannot execute bundles');
    (this.encoder as GPURenderPassEncoder).executeBundles(bundles);
    this.invalidate();
  }

  setPipeline(pipeline: GPURenderPipeline): void {
    if (pipeline === this.pipeline) { this.skipped.pipeline++; return; }
    this.commands.setPipeline(pipeline);
    this.pipeline = pipeline;
    this.switches.pipeline++;
  }

  setBindGroup(index: number, bindGroup: GPUBindGroup, dynamicOffsets?: readonly number[]): void {
    if (dynamicOffsets && dynamicOffsets.length) {
      this.commands.setBindGroup(index, bindGroup, dynamicOffsets as number[]);
      this.groups[index] = null;
      this.switches.bindGroup++;
      return;
    }
    if (this.groups[index] === bindGroup) { this.skipped.bindGroup++; return; }
    this.commands.setBindGroup(index, bindGroup);
    this.groups[index] = bindGroup;
    this.switches.bindGroup++;
  }

  setVertexBuffer(slot: number, buffer: GPUBuffer, offset = 0, size?: number): void {
    const bound = this.vertex[slot];
    if (bound && bound.buffer === buffer && bound.offset === offset && bound.size === size) { this.skipped.vertexBuffer++; return; }
    this.commands.setVertexBuffer(slot, buffer, offset, size);
    this.vertex[slot] = { buffer, offset, size };
    this.switches.vertexBuffer++;
  }

  setIndexBuffer(buffer: GPUBuffer, format: GPUIndexFormat, offset = 0): void {
    const bound = this.index;
    if (bound && bound.buffer === buffer && bound.format === format && bound.offset === offset) { this.skipped.indexBuffer++; return; }
    this.commands.setIndexBuffer(buffer, format, offset);
    this.index = { buffer, format, offset };
    this.switches.indexBuffer++;
  }

  draw(vertexCount: number, instanceCount = 1, firstVertex = 0, firstInstance = 0): void {
    this.commands.draw(vertexCount, instanceCount, firstVertex, firstInstance);
    this.drawCalls++;
  }

  drawIndexed(indexCount: number, instanceCount = 1, firstIndex = 0, baseVertex = 0, firstInstance = 0): void {
    this.commands.drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
    this.drawCalls++;
  }

  drawIndirect(buffer: GPUBuffer, offset: number): void {
    this.commands.drawIndirect(buffer, offset);
    this.drawCalls++;
  }

  drawIndexedIndirect(buffer: GPUBuffer, offset: number): void {
    this.commands.drawIndexedIndirect(buffer, offset);
    this.drawCalls++;
  }
}
