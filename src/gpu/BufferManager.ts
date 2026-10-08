import type { GPUStats } from './GPUStats';

/** Tracked buffer creation/destruction. All GPU buffers should come from here. */
export class BufferManager {
  private live = new Map<GPUBuffer, number>();

  /** Create a manager that counts live buffers and bytes in `stats`. */
  constructor(private device: GPUDevice, private stats: GPUStats) {}

  /** Create a tracked buffer; `size` is rounded up to a multiple of 4 bytes. */
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

  /** Destroy a buffer created here and update the stats (unknown buffers are ignored). */
  destroy(buffer: GPUBuffer): void {
    const size = this.live.get(buffer);
    if (size === undefined) return;
    this.live.delete(buffer);
    this.stats.buffers = this.live.size;
    this.stats.bufferBytes -= size;
    buffer.destroy();
  }

  /** Number of live buffers. */
  get count(): number { return this.live.size; }
}
