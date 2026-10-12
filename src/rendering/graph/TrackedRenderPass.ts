/**
 * A render pass encoder that remembers what is bound and skips redundant state changes. A `render` node (see TechniqueTypes.ts) hands one to the host's
 * `record` function: the host issues its draws in any order (a batch list, one draw per material and mesh) and only the pipeline, bind group, vertex buffer or
 * index buffer switches that actually change anything reach the GPU.
 *
 * Bind groups set with dynamic offsets are always forwarded (the same group at another offset is a different binding); the cache then forgets that group.
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

  /** `encoder` is the real pass, for anything not covered here (viewport, scissor, blend constant ...). */
  constructor(readonly encoder: GPURenderPassEncoder) {}

  setPipeline(pipeline: GPURenderPipeline): void {
    if (pipeline === this.pipeline) { this.skipped.pipeline++; return; }
    this.encoder.setPipeline(pipeline);
    this.pipeline = pipeline;
    this.switches.pipeline++;
  }

  setBindGroup(index: number, bindGroup: GPUBindGroup, dynamicOffsets?: readonly number[]): void {
    if (dynamicOffsets && dynamicOffsets.length) {
      this.encoder.setBindGroup(index, bindGroup, dynamicOffsets as number[]);
      this.groups[index] = null;
      this.switches.bindGroup++;
      return;
    }
    if (this.groups[index] === bindGroup) { this.skipped.bindGroup++; return; }
    this.encoder.setBindGroup(index, bindGroup);
    this.groups[index] = bindGroup;
    this.switches.bindGroup++;
  }

  setVertexBuffer(slot: number, buffer: GPUBuffer, offset = 0, size?: number): void {
    const bound = this.vertex[slot];
    if (bound && bound.buffer === buffer && bound.offset === offset && bound.size === size) { this.skipped.vertexBuffer++; return; }
    this.encoder.setVertexBuffer(slot, buffer, offset, size);
    this.vertex[slot] = { buffer, offset, size };
    this.switches.vertexBuffer++;
  }

  setIndexBuffer(buffer: GPUBuffer, format: GPUIndexFormat, offset = 0): void {
    const bound = this.index;
    if (bound && bound.buffer === buffer && bound.format === format && bound.offset === offset) { this.skipped.indexBuffer++; return; }
    this.encoder.setIndexBuffer(buffer, format, offset);
    this.index = { buffer, format, offset };
    this.switches.indexBuffer++;
  }

  draw(vertexCount: number, instanceCount = 1, firstVertex = 0, firstInstance = 0): void {
    this.encoder.draw(vertexCount, instanceCount, firstVertex, firstInstance);
    this.drawCalls++;
  }

  drawIndexed(indexCount: number, instanceCount = 1, firstIndex = 0, baseVertex = 0, firstInstance = 0): void {
    this.encoder.drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
    this.drawCalls++;
  }

  drawIndirect(buffer: GPUBuffer, offset: number): void {
    this.encoder.drawIndirect(buffer, offset);
    this.drawCalls++;
  }

  drawIndexedIndirect(buffer: GPUBuffer, offset: number): void {
    this.encoder.drawIndexedIndirect(buffer, offset);
    this.drawCalls++;
  }
}
