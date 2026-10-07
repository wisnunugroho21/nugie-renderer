import type { BufferManager } from '../gpu/BufferManager';
import type { RenderWorld } from './RenderWorld';

/**
 * ONE shared GPU buffer of compacted morph state (u32 pairs) mirroring RenderWorld.morph.pool (same offsets).
 * Only changed ranges are uploaded (coalesced); growth triggers one full re-upload.
 */
export class MorphWeightBuffer {
  buffer: GPUBuffer;
  generation = 0;
  uploadBytes = 0;
  uploadRanges = 0;
  private capacity: number; // u32 words

  constructor(private device: GPUDevice, private buffers: BufferManager, initialCapacity = 256) {
    this.capacity = Math.max(4, initialCapacity);
    this.buffer = this.make();
  }

  private make(): GPUBuffer {
    return this.buffers.create('MorphWeightBuffer', this.capacity * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  }

  sync(rw: RenderWorld): void {
    this.uploadBytes = 0; this.uploadRanges = 0;
    const m = rw.morph;
    if (m.pool.length > this.capacity) {
      while (this.capacity < m.pool.length) this.capacity *= 2;
      this.buffers.destroy(this.buffer);
      this.buffer = this.make();
      this.generation++;
      this.write(m.pool, 0, m.pool.length);
      m.changedRanges.length = 0;
      return;
    }
    const r = m.changedRanges;
    if (r.length === 0) return;
    const pairs: [number, number][] = [];
    for (let i = 0; i < r.length; i += 2) pairs.push([r[i], r[i] + r[i + 1]]);
    pairs.sort((a, b) => a[0] - b[0]);
    let [s, e] = pairs[0];
    for (let i = 1; i < pairs.length; i++) {
      if (pairs[i][0] <= e) e = Math.max(e, pairs[i][1]);
      else { this.write(m.pool, s, e); [s, e] = pairs[i]; }
    }
    this.write(m.pool, s, e);
  }

  private write(src: Uint32Array, from: number, to: number): void {
    this.device.queue.writeBuffer(this.buffer, from * 4, src.buffer, src.byteOffset + from * 4, (to - from) * 4);
    this.uploadBytes += (to - from) * 4; this.uploadRanges++;
  }
}
