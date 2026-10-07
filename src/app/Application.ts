import { GPUContext } from '../gpu/GPUContext';

export type FrameCallback = (dt: number, time: number) => void;
export type ResizeCallback = (width: number, height: number) => void;

/** Owns the GPU context, frame loop and resize handling. */
export class Application {
  gpu!: GPUContext;
  onFrame: FrameCallback = () => {};
  onResize: ResizeCallback = () => {};
  /** Frames rendered so far. */
  frame = 0;
  private last = 0;
  private running = false;

  constructor(readonly canvas: HTMLCanvasElement) {}

  async init(): Promise<void> {
    this.gpu = await GPUContext.create(this.canvas);
    this.gpu.onDeviceLost = () => { this.running = false; };
    this.gpu.resize();
    this.onResize(this.canvas.width, this.canvas.height);
    new ResizeObserver(() => {
      if (this.gpu.resize()) this.onResize(this.canvas.width, this.canvas.height);
    }).observe(this.canvas);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      const dt = (now - this.last) / 1000;
      this.last = now;
      this.onFrame(dt, now / 1000);
      this.frame++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop(): void { this.running = false; }
}
