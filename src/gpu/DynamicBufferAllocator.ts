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
 * Ring-buffered bump allocator. Each in-flight frame owns its OWN GPU buffer (created lazily); allocations are written into
 * one CPU shadow and flushed to the current frame's buffer with a single writeBuffer. Thousands of objects => one buffer per frame.
 *
 * Offsets returned by allocate() are byte offsets into the CURRENT frame's `buffer`. Because each frame has its own buffer, growing
 * mid-frame never moves earlier allocations of that frame (offsets stay valid; only `buffer` is replaced and `generation` changes).
 * Bind groups referencing `buffer` must be keyed by `generation`, which is unique per GPU buffer (so it also differs between ring slots).
 */
export class DynamicBufferAllocator {
  /** Unique id source for GPU buffers created by any allocator (see `generation`). */
  private static nextId = 1;

  /** Number of buffer re-creations caused by growth (diagnostics / tests). */
  growths = 0;
  /** Per-frame metrics. */
  allocationsThisFrame = 0;
  bytesUploadedThisFrame = 0;
  totalBytesUploaded = 0;

  readonly frames: number;
  readonly alignment: number;
  private readonly maxBytes: number;
  private capacity: number;
  private cpu: ArrayBuffer;
  private f32View: Float32Array;
  private u32View: Uint32Array;
  private slots: ({ buffer: GPUBuffer; size: number; id: number } | undefined)[];
  private frame = 0;
  private head = 0;
  private started = false;

  /** Allocate the CPU shadow region and the GPU ring (`frames` slots of `capacity` bytes) described by `opts`. */
  constructor(
    private device: GPUDevice,
    private buffers: BufferManager,
    private opts: DynamicBufferOptions,
  ) {
    this.frames = opts.frames ?? 3;
    this.alignment = opts.alignment ?? 256;
    if (!Number.isSafeInteger(this.frames) || this.frames < 1) throw new RangeError('Dynamic buffer frames must be a positive integer');
    if (!Number.isSafeInteger(this.alignment) || this.alignment < 4 || this.alignment % 4 !== 0) throw new RangeError('Dynamic buffer alignment must be a positive multiple of four');
    if (!Number.isSafeInteger(opts.capacity ?? 64 * 1024) || (opts.capacity ?? 64 * 1024) < 1) throw new RangeError('Dynamic buffer capacity must be a positive integer');
    const limits = (device as { limits?: GPUSupportedLimits }).limits;
    this.maxBytes = Math.min(limits?.maxBufferSize ?? Infinity, opts.usage & GPUBufferUsage.STORAGE ? limits?.maxStorageBufferBindingSize ?? Infinity : Infinity);
    this.capacity = alignUp(opts.capacity ?? 64 * 1024, this.alignment);
    if (this.capacity > this.maxBytes) throw new RangeError('Dynamic buffer capacity exceeds the device limit');
    this.cpu = new ArrayBuffer(this.capacity);
    this.f32View = new Float32Array(this.cpu);
    this.u32View = new Uint32Array(this.cpu);
    this.slots = new Array(this.frames).fill(undefined);
    this.ensureSlot();
  }

  /** The GPU buffer of the frame currently being recorded. */
  get buffer(): GPUBuffer { return this.slots[this.frame]!.buffer; }

  /** Id of the current GPU buffer: changes when the buffer is recreated and differs between ring slots. Use it in bind-group cache keys. */
  get generation(): number { return this.slots[this.frame]!.id; }

  /** Make sure the current frame's GPU buffer exists and is at least `capacity` bytes (recreating it otherwise). */
  private ensureSlot(): void {
    const cur = this.slots[this.frame];
    if (cur && cur.size >= this.capacity) return;
    if (cur) { this.buffers.destroy(cur.buffer); this.growths++; }
    this.slots[this.frame] = {
      buffer: this.buffers.create(this.opts.label, this.capacity, this.opts.usage | GPUBufferUsage.COPY_DST),
      size: this.capacity, id: DynamicBufferAllocator.nextId++,
    };
  }

  /** Advance to the next ring slot and reset the bump pointer and per-frame counters. Call once per frame before allocating. */
  beginFrame(): void {
    if (this.started) this.frame = (this.frame + 1) % this.frames;
    this.started = true;
    this.head = 0;
    this.allocationsThisFrame = 0;
    this.bytesUploadedThisFrame = 0;
    this.ensureSlot();
  }

  /** Reserve `size` bytes; returns the byte offset into `buffer` (aligned to `alignment`). */
  allocate(size: number, alignment = this.alignment): number {
    if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('Dynamic buffer size must be a nonnegative integer');
    if (!Number.isSafeInteger(alignment) || alignment < 1) throw new RangeError('Dynamic buffer allocation alignment must be a positive integer');
    const local = alignUp(this.head, alignment);
    const end = local + size;
    if (!Number.isSafeInteger(end) || alignUp(end, 4) > this.maxBytes) throw new RangeError('Dynamic buffer allocation exceeds the device limit');
    if (end > this.capacity) this.grow(end);
    this.head = end;
    this.allocationsThisFrame++;
    return local;
  }

  /** Index into the CPU views for an offset returned by `allocate` (identical, kept for call-site clarity). */
  localOffset(offset: number): number { return offset; }
  /** Float32 view of the CPU shadow of the current frame. */
  get float32(): Float32Array { return this.f32View; }
  /** Uint32 view of the CPU shadow of the current frame. */
  get uint32(): Uint32Array { return this.u32View; }

  /** Allocate and copy `data` in one call. */
  write(data: ArrayBufferView, alignment?: number): number {
    const off = this.allocate(data.byteLength, alignment);
    new Uint8Array(this.cpu, off, data.byteLength)
      .set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return off;
  }

  /** Upload this frame's used range with a single writeBuffer. */
  flush(): void {
    if (this.head === 0) return;
    const bytes = alignUp(this.head, 4);
    this.device.queue.writeBuffer(this.buffer, 0, this.cpu, 0, bytes);
    this.bytesUploadedThisFrame = bytes;
    this.totalBytesUploaded += bytes;
  }

  /** Double the capacity until `required` bytes fit, keeping the CPU contents and recreating the current frame's GPU buffer. Earlier offsets of this frame stay valid. */
  private grow(required: number): void {
    let cap = this.capacity;
    while (cap < required) cap *= 2;
    cap = Math.min(cap, Math.floor(this.maxBytes / this.alignment) * this.alignment);
    // The tail can use the remaining four-byte aligned space even if the device limit is not allocation-aligned.
    if (cap < required) cap = alignUp(required, 4);
    const old = this.cpu;
    this.cpu = new ArrayBuffer(cap);
    new Uint8Array(this.cpu).set(new Uint8Array(old, 0, this.head));
    this.f32View = new Float32Array(this.cpu);
    this.u32View = new Uint32Array(this.cpu);
    this.capacity = cap;
    this.ensureSlot();
  }
}

/** Round `v` up to a multiple of `a`. */
export function alignUp(v: number, a: number): number { return Math.ceil(v / a) * a; }
