import type { BufferManager } from '../gpu/BufferManager';
import type { RenderWorld } from './RenderWorld';

/**
 * Persistent GPU mirror of RenderWorld.transforms (one 64-byte matrix per slot).
 * Only changed slots are uploaded, coalesced into contiguous ranges (small gaps are merged).
 */
export class TransformBuffer {
  buffer: GPUBuffer;
  /** Bumped when the buffer is reallocated (object bind groups must be rebuilt). */
  generation = 0;
  lastUploadBytes = 0;
  lastUploadRanges = 0;

  private capacity: number; // in matrices
  private scratch = new Uint32Array(0);

  /** Create the storage buffer (64 bytes per renderable); `mergeGap` = max gap between changed slots that is still uploaded as one range. */
  constructor(private device: GPUDevice, private buffers: BufferManager, initialCapacity = 1024, private mergeGap = 8) {
    this.capacity = initialCapacity;
    this.buffer = this.create();
  }

  /** Allocate the GPU buffer for the current capacity. */
  private create(): GPUBuffer {
    return this.buffers.create('TransformBuffer', this.capacity * 64, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  }

  /** Upload the world matrices of changed slots as a few coalesced ranges (one full write when many changed or after growth). */
  sync(rw: RenderWorld): void {
    this.lastUploadBytes = 0; this.lastUploadRanges = 0;
    if (rw.count === 0) return;
    if (rw.count > this.capacity) {
      while (this.capacity < rw.count) this.capacity *= 2;
      this.buffers.destroy(this.buffer);
      this.buffer = this.create();
      this.generation++;
      this.writeRange(rw, 0, rw.count); // full re-upload after growth
      return;
    }
    const changed = rw.changedSlots;
    const n = changed.length;
    if (n === 0) return;
    // Many changes: one big write is cheaper than many small ones.
    if (n * 4 > rw.count) { this.writeRange(rw, 0, rw.count); return; }

    if (this.scratch.length < n) this.scratch = new Uint32Array(Math.max(n, this.scratch.length * 2));
    const s = this.scratch.subarray(0, n);
    for (let i = 0; i < n; i++) s[i] = changed[i];
    s.sort();
    let start = s[0], end = s[0];
    for (let i = 1; i < n; i++) {
      const v = s[i];
      if (v <= end + 1 + this.mergeGap) { if (v > end) end = v; continue; }
      this.writeRange(rw, start, end + 1);
      start = end = v;
    }
    this.writeRange(rw, start, end + 1);
  }

  /** Upload slots [from, to) of the render world's matrix array. */
  private writeRange(rw: RenderWorld, from: number, to: number): void {
    to = Math.min(to, rw.count);
    if (to <= from) return;
    this.device.queue.writeBuffer(this.buffer, from * 64, rw.transforms.buffer, rw.transforms.byteOffset + from * 64, (to - from) * 64);
    this.lastUploadBytes += (to - from) * 64;
    this.lastUploadRanges++;
  }
}
