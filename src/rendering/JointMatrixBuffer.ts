import type { BufferManager } from '../gpu/BufferManager';

/** Skinning matrices are affine, so a joint stores 3 rows of (m_r0 m_r1 m_r2 t_r) = 12 floats (48 B), not a full 4x4 (64 B). */
export const JOINT_MATRIX_FLOATS = 12;
export const JOINT_MATRIX_BYTES = JOINT_MATRIX_FLOATS * 4;

/** Write the affine part of column-major 4x4 `m` (at `mo`) as three rows into `out` at `o`. */
export function packJointMatrix(out: Float32Array, o: number, m: ArrayLike<number>, mo = 0): void {
  out[o] = m[mo]; out[o + 1] = m[mo + 4]; out[o + 2] = m[mo + 8]; out[o + 3] = m[mo + 12];
  out[o + 4] = m[mo + 1]; out[o + 5] = m[mo + 5]; out[o + 6] = m[mo + 9]; out[o + 7] = m[mo + 13];
  out[o + 8] = m[mo + 2]; out[o + 9] = m[mo + 6]; out[o + 10] = m[mo + 10]; out[o + 11] = m[mo + 14];
}

/** Expand the packed joint matrix `index` of `cpu` back into a column-major 4x4 (`out`, 16 floats). */
export function unpackJointMatrix(out: Float32Array | number[], cpu: Float32Array, index: number): void {
  const o = index * JOINT_MATRIX_FLOATS;
  out[0] = cpu[o]; out[4] = cpu[o + 1]; out[8] = cpu[o + 2]; out[12] = cpu[o + 3];
  out[1] = cpu[o + 4]; out[5] = cpu[o + 5]; out[9] = cpu[o + 6]; out[13] = cpu[o + 7];
  out[2] = cpu[o + 8]; out[6] = cpu[o + 9]; out[10] = cpu[o + 10]; out[14] = cpu[o + 11];
  out[3] = out[7] = out[11] = 0; out[15] = 1;
}

/**
 * ONE shared joint-matrix pool for all skeleton instances (never a buffer per character).
 * CPU shadow (Float32Array, 12 floats per joint: see `packJointMatrix`) mirrored to one GPU storage buffer; only the dirty
 * instance ranges are uploaded each frame (adjacent ranges are coalesced).
 */
export class JointMatrixBuffer {
  buffer: GPUBuffer;
  /** Bumped when the GPU buffer is reallocated (bind groups must be rebuilt). */
  generation = 0;
  /** CPU copy; matrices of instance i live at [offset*12, (offset+count)*12). */
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
    this.cpu = new Float32Array(this.capacity * JOINT_MATRIX_FLOATS);
    this.cpu[0] = this.cpu[5] = this.cpu[10] = 1;   // identity: rows (1 0 0 0) (0 1 0 0) (0 0 1 0)
    this.used = 1;
    this.buffer = this.makeBuffer();
    this.markDirty(0, 1);
  }

  /** Allocate the GPU storage buffer for the current capacity. */
  private makeBuffer(): GPUBuffer {
    return this.buffers.create('JointMatrixBuffer', this.capacity * JOINT_MATRIX_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  }

  /** Matrices handed out so far (including released holes). */
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

  /** Return a skeleton's joint range to the free list (keyed by joint count) for reuse by an equally sized skeleton. */
  release(offset: number, count: number): void {
    const list = this.free.get(count) ?? [];
    list.push(offset);
    this.free.set(count, list);
  }

  /** Queue the range [offset, offset + count) for upload at the next `flush`. */
  markDirty(offset: number, count: number): void { this.dirty.push(offset, count); }

  /** Double the capacity, recreate the GPU buffer (bumping `generation`) and schedule a full re-upload. */
  private grow(needed: number): void {
    let cap = this.capacity;
    while (cap < needed) cap *= 2;
    const n = new Float32Array(cap * JOINT_MATRIX_FLOATS); n.set(this.cpu);
    this.cpu = n; this.capacity = cap;
    this.buffers.destroy(this.buffer);
    this.buffer = this.makeBuffer();
    this.generation++;
    this.dirty.length = 0;
    this.dirty.push(0, this.used); // re-upload everything after reallocation
  }

  /** Reset the per-frame upload counters. */
  beginFrame(): void { this.uploadBytes = 0; this.uploadRanges = 0; }

  /** Upload dirty ranges (sorted + coalesced). */
  flush(): void {
    const d = this.dirty;
    if (d.length === 0) return;
    const ranges: [number, number][] = [];
    for (let i = 0; i < d.length; i += 2) ranges.push([d[i], d[i] + d[i + 1]]);
    ranges.sort((a, b) => a[0] - b[0]);
    let [start, end] = ranges[0];
    /** Upload matrices [s, e) to the GPU buffer. */
    const write = (s: number, e: number) => {
      this.device.queue.writeBuffer(this.buffer, s * JOINT_MATRIX_BYTES, this.cpu.buffer, this.cpu.byteOffset + s * JOINT_MATRIX_BYTES, (e - s) * JOINT_MATRIX_BYTES);
      this.uploadBytes += (e - s) * JOINT_MATRIX_BYTES; this.uploadRanges++;
    };
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i][0] <= end) end = Math.max(end, ranges[i][1]);
      else { write(start, end); [start, end] = ranges[i]; }
    }
    write(start, end);
    d.length = 0;
  }
}
