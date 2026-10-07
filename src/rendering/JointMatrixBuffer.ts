import type { BufferManager } from '../gpu/BufferManager';

/**
 * ONE shared joint-matrix pool for all skeleton instances (never a buffer per character).
 * CPU shadow (Float32Array, 16 floats per joint) mirrored to one GPU storage buffer; only the dirty
 * instance ranges are uploaded each frame (adjacent ranges are coalesced).
 */
export class JointMatrixBuffer {
  buffer: GPUBuffer;
  /** Bumped when the GPU buffer is reallocated (bind groups must be rebuilt). */
  generation = 0;
  /** CPU copy; matrices of instance i live at [offset*16, (offset+count)*16). */
  cpu: Float32Array;
  /** Metrics (reset by beginFrame). */
  uploadBytes = 0;
  uploadRanges = 0;

  private capacity: number; // matrices
  private used = 0;
  private free = new Map<number, number[]>(); // count -> offsets
  private dirty: number[] = []; // [offset, count] pairs

  constructor(private device: GPUDevice, private buffers: BufferManager, initialCapacity = 256) {
    // Matrix 0 is reserved as identity so that "no skeleton" (offset 0) is always valid to read.
    this.capacity = Math.max(2, initialCapacity);
    this.cpu = new Float32Array(this.capacity * 16);
    this.cpu[0] = this.cpu[5] = this.cpu[10] = this.cpu[15] = 1;
    this.used = 1;
    this.buffer = this.makeBuffer();
    this.markDirty(0, 1);
  }

  private makeBuffer(): GPUBuffer {
    return this.buffers.create('JointMatrixBuffer', this.capacity * 64, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  }

  get usedMatrices(): number { return this.used; }

  /** Reserve `count` matrices; returns the matrix offset. Reuses freed blocks of the same size. */
  allocate(count: number): number {
    const reuse = this.free.get(count)?.pop();
    if (reuse !== undefined) { this.markDirty(reuse, count); return reuse; }
    const off = this.used;
    if (off + count > this.capacity) this.grow(off + count);
    this.used = off + count;
    this.markDirty(off, count);
    return off;
  }

  release(offset: number, count: number): void {
    const list = this.free.get(count) ?? [];
    list.push(offset);
    this.free.set(count, list);
  }

  markDirty(offset: number, count: number): void { this.dirty.push(offset, count); }

  private grow(needed: number): void {
    let cap = this.capacity;
    while (cap < needed) cap *= 2;
    const n = new Float32Array(cap * 16); n.set(this.cpu);
    this.cpu = n; this.capacity = cap;
    this.buffers.destroy(this.buffer);
    this.buffer = this.makeBuffer();
    this.generation++;
    this.dirty.length = 0;
    this.dirty.push(0, this.used); // re-upload everything after reallocation
  }

  beginFrame(): void { this.uploadBytes = 0; this.uploadRanges = 0; }

  /** Upload dirty ranges (sorted + coalesced). */
  flush(): void {
    const d = this.dirty;
    if (d.length === 0) return;
    const ranges: [number, number][] = [];
    for (let i = 0; i < d.length; i += 2) ranges.push([d[i], d[i] + d[i + 1]]);
    ranges.sort((a, b) => a[0] - b[0]);
    let [start, end] = ranges[0];
    const write = (s: number, e: number) => {
      this.device.queue.writeBuffer(this.buffer, s * 64, this.cpu.buffer, this.cpu.byteOffset + s * 64, (e - s) * 64);
      this.uploadBytes += (e - s) * 64; this.uploadRanges++;
    };
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i][0] <= end) end = Math.max(end, ranges[i][1]);
      else { write(start, end); [start, end] = ranges[i]; }
    }
    write(start, end);
    d.length = 0;
  }
}
