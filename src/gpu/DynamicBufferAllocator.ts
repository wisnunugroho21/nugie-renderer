import type { BufferManager } from './BufferManager';

export interface DynamicBufferOptions {
  label: string;
  usage: GPUBufferUsageFlags;
  /** Ring depth (frames in flight). */
  frames?: number;
  /** Initial bytes per frame region; grows (power of two) on overflow. */
  capacity?: number;
  /** Allocation alignment in bytes (256 satisfies uniform/storage dynamic offsets). */
  alignment?: number;
}

/**
 * Ring-buffered bump allocator over ONE GPU buffer. Each frame owns a region of
 * `capacity` bytes; allocations are written into a CPU shadow and flushed to the
 * GPU region with a single writeBuffer. Thousands of objects => one buffer.
 *
 * Offsets returned by allocate() are absolute byte offsets into `buffer`, so bind
 * groups referencing `buffer` stay valid across frames; they only need rebuilding
 * when `generation` changes (growth).
 */
export class DynamicBufferAllocator {
  buffer: GPUBuffer;
  /** Bumped whenever `buffer` is recreated (bind groups must be refreshed). */
  generation = 0;
  growths = 0;
  /** Per-frame metrics. */
  allocationsThisFrame = 0;
  bytesUploadedThisFrame = 0;
  totalBytesUploaded = 0;

  readonly frames: number;
  readonly alignment: number;
  private capacity: number;
  private cpu: ArrayBuffer;
  private f32View: Float32Array;
  private u32View: Uint32Array;
  private frame = 0;
  private head = 0;
  private started = false;

  constructor(
    private device: GPUDevice,
    private buffers: BufferManager,
    private opts: DynamicBufferOptions,
  ) {
    this.frames = opts.frames ?? 3;
    this.alignment = opts.alignment ?? 256;
    this.capacity = alignUp(opts.capacity ?? 64 * 1024, this.alignment);
    this.cpu = new ArrayBuffer(this.capacity);
    this.f32View = new Float32Array(this.cpu);
    this.u32View = new Uint32Array(this.cpu);
    this.buffer = this.createGPUBuffer();
  }

  private createGPUBuffer(): GPUBuffer {
    return this.buffers.create(this.opts.label, this.capacity * this.frames, this.opts.usage | GPUBufferUsage.COPY_DST);
  }

  beginFrame(): void {
    if (this.started) this.frame = (this.frame + 1) % this.frames;
    this.started = true;
    this.head = 0;
    this.allocationsThisFrame = 0;
    this.bytesUploadedThisFrame = 0;
  }

  /** Reserve `size` bytes; returns the absolute byte offset into `buffer`. */
  allocate(size: number, alignment = this.alignment): number {
    const local = alignUp(this.head, alignment);
    const end = local + size;
    if (end > this.capacity) this.grow(end);
    this.head = end;
    this.allocationsThisFrame++;
    return this.frame * this.capacity + local;
  }

  /** CPU views onto this frame's region, indexed by (absoluteOffset - regionStart). */
  localOffset(absolute: number): number { return absolute - this.frame * this.capacity; }
  get float32(): Float32Array { return this.f32View; }
  get uint32(): Uint32Array { return this.u32View; }

  /** Allocate and copy `data` in one call. */
  write(data: ArrayBufferView, alignment?: number): number {
    const abs = this.allocate(data.byteLength, alignment);
    new Uint8Array(this.cpu, this.localOffset(abs), data.byteLength)
      .set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return abs;
  }

  /** Upload this frame's used range with a single writeBuffer. */
  flush(): void {
    if (this.head === 0) return;
    this.device.queue.writeBuffer(this.buffer, this.frame * this.capacity, this.cpu, 0, alignUp(this.head, 4));
    this.bytesUploadedThisFrame = this.head;
    this.totalBytesUploaded += this.head;
  }

  private grow(required: number): void {
    let cap = this.capacity;
    while (cap < required) cap *= 2;
    const old = this.cpu;
    this.cpu = new ArrayBuffer(cap);
    new Uint8Array(this.cpu).set(new Uint8Array(old, 0, this.head));
    this.f32View = new Float32Array(this.cpu);
    this.u32View = new Uint32Array(this.cpu);
    this.capacity = cap;
    const oldBuffer = this.buffer;
    this.buffer = this.createGPUBuffer();
    this.buffers.destroy(oldBuffer);
    this.generation++;
    this.growths++;
  }
}

export function alignUp(v: number, a: number): number { return Math.ceil(v / a) * a; }
