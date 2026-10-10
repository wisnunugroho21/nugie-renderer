import { GPUContext } from '../gpu/GPUContext';

/** Per-frame callback: `dt` = seconds since the previous frame, `time` = absolute seconds. */
export type FrameCallback = (dt: number, time: number) => void;
/** Called with the new canvas backing-store size (pixels) whenever it changes. */
export type ResizeCallback = (width: number, height: number) => void;

/** Owns the GPU context, frame loop and resize handling. */
export class Application {
  gpu!: GPUContext;
  /** Runs once per animation frame while started. */
  onFrame: FrameCallback = () => {};
  /** Runs after the canvas backing size changed (and once at startup). */
  onResize: ResizeCallback = () => {};
  /** Frames rendered so far. */
  frame = 0;
  private last = 0;
  private running = false;
  private loopGeneration = 0;
  private rafId = 0;
  private resizeObserver: ResizeObserver | null = null;

  /** @param canvas the canvas to render into; its CSS size drives the backing-store size */
  constructor(readonly canvas: HTMLCanvasElement) {}

  /** Acquire the WebGPU device, size the canvas and start observing it for resizes. Rejects if WebGPU is unavailable. */
  async init(): Promise<void> {
    this.gpu = await GPUContext.create(this.canvas);
    this.gpu.onDeviceLost = () => { this.stop(); };
    this.gpu.resize();
    this.onResize(this.canvas.width, this.canvas.height);
    this.resizeObserver = new ResizeObserver(() => {
      if (this.gpu.resize()) this.onResize(this.canvas.width, this.canvas.height);
    });
    this.resizeObserver.observe(this.canvas);
  }

  /** Begin the requestAnimationFrame loop (no-op if already running). */
  start(): void {
    if (this.running) return;
    this.running = true;
    const generation = ++this.loopGeneration;
    this.last = performance.now();
    /** One animation frame: compute dt, run `onFrame`, schedule the next frame. */
    const tick = (now: number) => {
      if (!this.running || generation !== this.loopGeneration) return;
      const dt = (now - this.last) / 1000;
      this.last = now;
      try {
        this.onFrame(dt, now / 1000);
      } catch (error) {
        if (generation === this.loopGeneration) this.stop();
        throw error;
      }
      this.frame++;
      // A callback may stop or restart the loop. Only its current generation may reschedule.
      if (this.running && generation === this.loopGeneration) this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** Stop the loop; the pending animation frame is cancelled so a later `start()` cannot run two loops. */
  stop(): void {
    this.running = false;
    this.loopGeneration++;
    cancelAnimationFrame(this.rafId);
  }

  /** Stop the loop and stop observing the canvas for size changes. */
  dispose(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }
}
