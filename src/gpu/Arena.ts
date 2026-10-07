import type { BufferManager } from './BufferManager';

/**
 * Append-only GPU buffer arena addressed in ELEMENTS. Growth reallocates and copies on the GPU
 * (never re-uploading from the CPU) and bumps `generation` so bind groups can be rebuilt.
 */
export class Arena {
  buffer: GPUBuffer;
  generation = 0;
  used = 0;
  private capacity: number;

  constructor(
    private device: GPUDevice, private buffers: BufferManager, readonly label: string, private usage: GPUBufferUsageFlags,
    readonly elementBytes: number, initialCapacity: number,
  ) {
    this.capacity = Math.max(1, initialCapacity);
    this.buffer = this.make();
  }

  private make(): GPUBuffer {
    return this.buffers.create(this.label, this.capacity * this.elementBytes, this.usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
  }

  get capacityElements(): number { return this.capacity; }

  /** Reserve `count` elements; returns the element offset. */
  alloc(count: number): number {
    const need = this.used + count;
    if (need > this.capacity) this.grow(need);
    const off = this.used;
    this.used = need;
    return off;
  }

  write(elementOffset: number, data: ArrayBufferView): void {
    this.device.queue.writeBuffer(this.buffer, elementOffset * this.elementBytes, data.buffer, data.byteOffset, data.byteLength);
  }

  private grow(need: number): void {
    const old = this.buffer, oldBytes = this.used * this.elementBytes;
    while (this.capacity < need) this.capacity *= 2;
    this.buffer = this.make();
    if (oldBytes > 0) {
      const enc = this.device.createCommandEncoder({ label: `${this.label}-grow` });
      enc.copyBufferToBuffer(old, 0, this.buffer, 0, oldBytes);
      this.device.queue.submit([enc.finish()]);
    }
    this.buffers.destroy(old);
    this.generation++;
  }
}
