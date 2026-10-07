import type { GPUStats } from './GPUStats';

/** Tracked buffer creation/destruction. All GPU buffers should come from here. */
export class BufferManager {
  private live = new Map<GPUBuffer, number>();

  constructor(private device: GPUDevice, private stats: GPUStats) {}

  create(label: string, size: number, usage: GPUBufferUsageFlags, mappedAtCreation = false): GPUBuffer {
    // Round to 4 bytes (writeBuffer / copy alignment).
    const aligned = (size + 3) & ~3;
    const buffer = this.device.createBuffer({ label, size: aligned, usage, mappedAtCreation });
    this.live.set(buffer, aligned);
    this.stats.buffers = this.live.size;
    this.stats.bufferBytes += aligned;
    return buffer;
  }

  /** Create + upload initial contents. */
  createWithData(label: string, data: ArrayBufferView, usage: GPUBufferUsageFlags): GPUBuffer {
    const buffer = this.create(label, data.byteLength, usage | GPUBufferUsage.COPY_DST);
    this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
    return buffer;
  }

  destroy(buffer: GPUBuffer): void {
    const size = this.live.get(buffer);
    if (size === undefined) return;
    this.live.delete(buffer);
    this.stats.buffers = this.live.size;
    this.stats.bufferBytes -= size;
    buffer.destroy();
  }

  get count(): number { return this.live.size; }
}
