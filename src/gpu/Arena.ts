import type { BufferManager } from './BufferManager';

/**
 * Append-only GPU buffer arena addressed in ELEMENTS. Growth reallocates and copies on the GPU
 * (never re-uploading from the CPU) and bumps `generation` so bind groups can be rebuilt.
 */
/** Thrown when an arena would have to grow past what the device can bind / allocate. */
export class ArenaCapacityError extends Error {
  constructor(readonly label: string, readonly requestedBytes: number, readonly limitBytes: number) {
    super(`Arena '${label}' needs ${requestedBytes} bytes but the device allows at most ${limitBytes} bytes per buffer binding (maxStorageBufferBindingSize / maxBufferSize). ` +
      'Reduce the amount of mesh / morph / skin data or split it across meshes loaded later.');
  }
}

export class Arena {
  buffer: GPUBuffer;
  /** Largest size (bytes) this arena may reach: the device's buffer limit, and for STORAGE arenas also the binding-size limit (Infinity if unknown). */
  readonly maxBytes: number;
  /** Set once the arena passed 80% of `maxBytes` (a warning has been logged). */
  nearLimit = false;
  generation = 0;
  used = 0;
  private capacity: number;

  /** Create the arena with room for `initialCapacity` elements of `elementBytes` bytes each. */
  constructor(
    private device: GPUDevice, private buffers: BufferManager, readonly label: string, private usage: GPUBufferUsageFlags,
    readonly elementBytes: number, initialCapacity: number,
  ) {
    if (!Number.isSafeInteger(elementBytes) || elementBytes <= 0 || elementBytes % 4 !== 0) throw new RangeError('Arena elementBytes must be a positive multiple of four');
    if (!Number.isSafeInteger(initialCapacity) || initialCapacity < 0) throw new RangeError('Arena initialCapacity must be a nonnegative integer');
    const lim = (device as { limits?: GPUSupportedLimits }).limits;
    let max = Infinity;
    if (lim) {
      max = lim.maxBufferSize;
      if (usage & GPUBufferUsage.STORAGE) max = Math.min(max, lim.maxStorageBufferBindingSize);
    }
    this.maxBytes = max;
    // Initial capacity is a growth hint; start smaller on devices with tighter buffer limits.
    this.capacity = Math.max(1, Math.min(initialCapacity, Math.floor(this.maxBytes / elementBytes)));
    if (this.capacity * elementBytes > this.maxBytes) throw new ArenaCapacityError(label, this.capacity * elementBytes, this.maxBytes);
    this.buffer = this.make();
  }

  /** Allocate the backing GPU buffer for the current capacity. */
  private make(): GPUBuffer {
    return this.buffers.create(this.label, this.capacity * this.elementBytes, this.usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
  }

  /** Elements that fit before the next growth. */
  get capacityElements(): number { return this.capacity; }

  /**
   * Make sure `count` more elements fit (growing the buffer if needed) WITHOUT consuming them. Throws ArenaCapacityError if they
   * can never fit. Lets callers that allocate from several arenas check everything before taking any space.
   */
  ensureRoom(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Arena allocation count must be a nonnegative integer');
    const need = this.used + count;
    if (need > this.capacity) this.grow(need);
  }

  /** Reserve `count` elements; returns the element offset. */
  alloc(count: number): number {
    this.ensureRoom(count);
    const need = this.used + count;
    const off = this.used;
    this.used = need;
    return off;
  }

  /** Upload `data` at element offset `elementOffset` (a range previously returned by `alloc`). */
  write(elementOffset: number, data: ArrayBufferView): void {
    this.device.queue.writeBuffer(this.buffer, elementOffset * this.elementBytes, data.buffer, data.byteOffset, data.byteLength);
  }

  /** Double the capacity until `need` fits, copy the old contents on the GPU, destroy the old buffer and bump `generation`. */
  private grow(need: number): void {
    const old = this.buffer, oldBytes = this.used * this.elementBytes;
    if (need * this.elementBytes > this.maxBytes) throw new ArenaCapacityError(this.label, need * this.elementBytes, this.maxBytes);
    let cap = this.capacity;
    while (cap < need) cap *= 2;
    this.capacity = Math.min(cap, Math.floor(this.maxBytes / this.elementBytes));   // never double past the limit
    if (!this.nearLimit && need * this.elementBytes > this.maxBytes * 0.8) {
      this.nearLimit = true;
      console.warn(`Arena '${this.label}' is above 80% of the device buffer limit (${(need * this.elementBytes / 1048576).toFixed(0)} of ${(this.maxBytes / 1048576).toFixed(0)} MB).`);
    }
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
