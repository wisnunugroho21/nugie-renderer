/**
 * GPU pass timing with timestamp queries. Passes request `timestampWrites` by name; repeated names within a frame are summed.
 * Results are read back asynchronously (a few frames late) through a small ring of staging buffers, so profiling never stalls
 * the frame. Without the 'timestamp-query' feature every method is a cheap no-op.
 */
export class GPUProfiler {
  readonly supported: boolean;
  enabled = true;
  /** Latest resolved timings in milliseconds, by scope name. */
  results = new Map<string, number>();
  /** Smoothed (exponential average) timings. */
  smoothed = new Map<string, number>();
  private querySet: GPUQuerySet | null = null;
  private resolveBuf: GPUBuffer | null = null;
  private staging: { buf: GPUBuffer; names: string[]; busy: boolean }[] = [];
  private names: string[] = [];
  private ringIndex = 0;

  constructor(private device: GPUDevice, private maxPasses = 64) {
    this.supported = device.features.has('timestamp-query');
    if (!this.supported) return;
    this.querySet = device.createQuerySet({ type: 'timestamp', count: maxPasses * 2 });
    this.resolveBuf = device.createBuffer({ label: 'gpu-profiler-resolve', size: maxPasses * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    for (let i = 0; i < 3; i++) {
      this.staging.push({ buf: device.createBuffer({ label: 'gpu-profiler-staging', size: maxPasses * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), names: [], busy: false });
    }
  }

  beginFrame(): void { this.names.length = 0; }

  /** `timestampWrites` for a render/compute pass descriptor (undefined when profiling is off or full). */
  writes(name: string): GPUComputePassTimestampWrites | undefined {
    if (!this.supported || !this.enabled || this.names.length >= this.maxPasses) return undefined;
    const i = this.names.length;
    this.names.push(name);
    return { querySet: this.querySet!, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 };
  }

  /** Resolve this frame's queries into a staging buffer; call once before submitting the encoder. */
  resolve(enc: GPUCommandEncoder): void {
    if (!this.supported || !this.enabled || this.names.length === 0) return;
    const slot = this.staging[this.ringIndex];
    if (slot.busy) return;   // readback still in flight: skip this frame
    this.ringIndex = (this.ringIndex + 1) % this.staging.length;
    const n = this.names.length;
    enc.resolveQuerySet(this.querySet!, 0, n * 2, this.resolveBuf!, 0);
    enc.copyBufferToBuffer(this.resolveBuf!, 0, slot.buf, 0, n * 16);
    slot.names = this.names.slice();
    slot.busy = true;
    // mapAsync must be issued after submit; do it in a microtask-safe way
    queueMicrotask(() => this.read(slot, n));
  }

  private async read(slot: { buf: GPUBuffer; names: string[]; busy: boolean }, n: number): Promise<void> {
    try {
      await this.device.queue.onSubmittedWorkDone();
      await slot.buf.mapAsync(GPUMapMode.READ, 0, n * 16);
      const t = new BigUint64Array(slot.buf.getMappedRange(0, n * 16).slice(0));
      slot.buf.unmap();
      const sum = new Map<string, number>();
      for (let i = 0; i < n; i++) {
        const ms = Number(t[i * 2 + 1] - t[i * 2]) / 1e6;
        if (ms >= 0 && ms < 1000) sum.set(slot.names[i], (sum.get(slot.names[i]) ?? 0) + ms);
      }
      this.results = sum;
      for (const [k, v] of sum) this.smoothed.set(k, (this.smoothed.get(k) ?? v) * 0.9 + v * 0.1);
    } catch { /* device lost or buffer destroyed */ }
    slot.busy = false;
  }
}
