import type { GPUContext } from '../../gpu/GPUContext';

/** Something drawn into the main pass after the scene geometry (lines, points, sprites, text). Created through the renderer. */
export interface Overlay {
  /** Upload CPU-side changes (called by the renderer once per frame, before the passes are recorded). */
  flush(): void;
  /** Record the draw call(s) into the main pass. */
  encodeDraw(pass: GPURenderPassEncoder, frameBG: GPUBindGroup): void;
  /** The shared colour / depth target changed (MSAA, HDR): re-resolve the render pipeline. */
  retarget(): void;
  /** Cleared after every frame when true (immediate-mode drawing). */
  autoClear: boolean;
  /** Empty the system. */
  clear(): void;
  /** Hide without destroying (default true). */
  visible: boolean;
}

/** Colour with an optional alpha (default 1): linear HDR values, so components may exceed 1 (they bloom). */
export type Color = readonly [number, number, number, number?];

/** Position / vector. */
export type Vec3 = readonly [number, number, number];

/** The colour / depth target description shared by the main pass pipelines. */
export interface OverlayTarget { colorFormat: GPUTextureFormat; depthFormat: GPUTextureFormat; sampleCount: number; }

/**
 * A growing GPU storage buffer mirrored by a CPU Float32Array of `floatsPerItem` floats per item. `data` can be written directly;
 * call `upload(count)` to send the used part. `generation` changes when the GPU buffer is re-created (rebuild bind groups then).
 */
export class StorageArray {
  data: Float32Array;
  capacity: number;
  buffer: GPUBuffer;
  generation = 0;

  constructor(private gpu: GPUContext, private label: string, readonly floatsPerItem: number, capacity: number) {
    this.capacity = Math.max(1, capacity);
    this.data = new Float32Array(this.capacity * floatsPerItem);
    this.buffer = this.create();
  }

  private create(): GPUBuffer {
    this.generation++;
    return this.gpu.resources.buffers.create(this.label, this.capacity * this.floatsPerItem * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  }

  /** Make room for `n` items (doubling), keeping the contents. */
  ensure(n: number): void {
    if (n <= this.capacity) return;
    let c = this.capacity;
    while (c < n) c *= 2;
    const d = new Float32Array(c * this.floatsPerItem);
    d.set(this.data);
    this.data = d;
    this.gpu.resources.buffers.destroy(this.buffer);
    this.capacity = c;
    this.buffer = this.create();
  }

  /** Send the first `n` items to the GPU. */
  upload(n: number): void {
    if (n > 0) this.gpu.queue.writeBuffer(this.buffer, 0, this.data, 0, n * this.floatsPerItem);
  }
}
