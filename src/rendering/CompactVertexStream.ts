import type { BufferManager } from '../gpu/BufferManager';
import type { Arena } from '../gpu/Arena';
import packSource from '../shaders/pack_position_normal.wgsl?raw';
import { STANDARD_VERTEX_FLOATS, STANDARD_VERTEX_STRIDE } from './VertexLayouts';

/** Bytes per vertex of the derived stream: position (3 floats) + normal (3 floats). */
export const COMPACT_VERTEX_FLOATS = 6;
export const COMPACT_VERTEX_STRIDE = COMPACT_VERTEX_FLOATS * 4;

const WORKGROUP_SIZE = 64;
const MAX_WORKGROUPS_PER_DIMENSION = 65535;

/**
 * A position + normal vertex stream derived on the GPU from the shared standard-vertex arena (no extra CPU geometry copy). The retained
 * draw paths bind it instead of the 48-byte vertices, cutting vertex fetch bandwidth in half. It is rebuilt lazily whenever the source
 * arena was written to, grown or appended to since the last build.
 */
export class CompactVertexStream {
  private target: GPUBuffer | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private builtVersion = -1;
  private builtGeneration = -1;
  private builtUsed = -1;

  constructor(private device: GPUDevice, private buffers: BufferManager, private source: Arena) {}

  /** False when the source arena is too large to bind as one storage buffer (the specialised draw paths must then stay off). */
  get supported(): boolean {
    const limit = (this.device as { limits?: GPUSupportedLimits }).limits?.maxStorageBufferBindingSize ?? Infinity;
    return this.source.used * STANDARD_VERTEX_STRIDE <= limit;
  }

  /** The up-to-date stream (a derived buffer is recomputed and submitted first if the source changed). Throws when the arena is empty. */
  get buffer(): GPUBuffer {
    const src = this.source;
    if (this.target && this.builtVersion === src.version && this.builtGeneration === src.generation && this.builtUsed === src.used) return this.target;
    if (!src.used) throw new Error('Cannot compact an empty vertex arena');
    if (!this.supported) throw new Error('The vertex arena exceeds maxStorageBufferBindingSize; it cannot be compacted');
    const bytes = src.used * COMPACT_VERTEX_STRIDE;
    if (!this.target || this.target.size < bytes) {
      if (this.target) this.buffers.destroy(this.target);
      this.target = this.buffers.create('mesh-compact-vertices', bytes, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    }
    this.rebuild(this.target, bytes);
    this.builtVersion = src.version; this.builtGeneration = src.generation; this.builtUsed = src.used;
    return this.target;
  }

  /** Dispatch the packing shader over every used vertex and submit it immediately (it must finish before this frame's draws). */
  private rebuild(target: GPUBuffer, bytes: number): void {
    const { device, source } = this;
    this.pipeline ??= device.createComputePipeline({
      label: 'pack-position-normal', layout: 'auto',
      compute: {
        module: device.createShaderModule({ label: 'pack-position-normal', code: packSource }), entryPoint: 'main',
        constants: { SRC_FLOATS: STANDARD_VERTEX_FLOATS, DST_FLOATS: COMPACT_VERTEX_FLOATS },
      },
    });
    const group = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: source.buffer, size: source.used * STANDARD_VERTEX_STRIDE } },
      { binding: 1, resource: { buffer: target, size: bytes } },
    ] });
    const encoder = device.createCommandEncoder({ label: 'pack-position-normal' });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, group);
    const workgroups = Math.ceil(source.used / WORKGROUP_SIZE);
    pass.dispatchWorkgroups(Math.min(workgroups, MAX_WORKGROUPS_PER_DIMENSION), Math.ceil(workgroups / MAX_WORKGROUPS_PER_DIMENSION));
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
}
