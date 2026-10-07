import { GPUResources } from './GPUResources';

/** Vertex-stage storage buffers the engine binds (materials, params, transforms, instances, joints, morph weights, skin, 3 morph deltas). */
export const MIN_VERTEX_STORAGE_BUFFERS = 10;

export class GPUContext {
  adapter!: GPUAdapter;
  device!: GPUDevice;
  queue!: GPUQueue;
  context!: GPUCanvasContext;
  format!: GPUTextureFormat;
  resources!: GPUResources;
  lost = false;
  /** Validation / uncaptured errors seen so far (acceptance: stays empty). */
  readonly errors: string[] = [];
  onDeviceLost: ((info: GPUDeviceLostInfo) => void) | null = null;

  private constructor(readonly canvas: HTMLCanvasElement) {}

  static async create(canvas: HTMLCanvasElement): Promise<GPUContext> {
    if (!navigator.gpu) throw new Error('WebGPU is not supported in this browser.');
    const gc = new GPUContext(canvas);
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No suitable GPUAdapter found.');
    gc.adapter = adapter;
    // Opt in to optional features we use when available.
    const features: GPUFeatureName[] = [];
    for (const f of ['timestamp-query', 'float32-filterable', 'indirect-first-instance'] as GPUFeatureName[]) {
      if (adapter.features.has(f)) features.push(f);
    }
    // Skinning/morphing read several storage buffers in the vertex stage (see common.wgsl group 3).
    const wanted = Math.min(adapter.limits.maxStorageBuffersPerShaderStage, 12);
    const requiredLimits: Record<string, number> = { maxStorageBuffersPerShaderStage: wanted };
    const vertexLimit = (adapter.limits as unknown as Record<string, number>).maxStorageBuffersInVertexStage;
    if (vertexLimit !== undefined) requiredLimits.maxStorageBuffersInVertexStage = Math.min(vertexLimit, 12);
    requiredLimits.maxStorageBufferBindingSize = Math.min(adapter.limits.maxStorageBufferBindingSize, 1 << 30);
    requiredLimits.maxBufferSize = Math.min(adapter.limits.maxBufferSize, 1 << 30);
    if (wanted < MIN_VERTEX_STORAGE_BUFFERS) console.warn('Adapter exposes only ' + wanted + ' storage buffers per stage; skinning/morphing need ' + MIN_VERTEX_STORAGE_BUFFERS + '.');
    gc.device = await adapter.requestDevice({ requiredFeatures: features, requiredLimits });
    gc.queue = gc.device.queue;
    gc.resources = new GPUResources(gc.device);

    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('Failed to acquire WebGPU canvas context.');
    gc.context = ctx;
    gc.format = navigator.gpu.getPreferredCanvasFormat();
    gc.configure();

    gc.device.lost.then((info) => {
      gc.lost = true;
      console.error(`WebGPU device lost (${info.reason}): ${info.message}`);
      gc.onDeviceLost?.(info);
    });
    gc.device.addEventListener('uncapturederror', (e) => {
      const msg = (e as GPUUncapturedErrorEvent).error.message;
      gc.errors.push(msg);
      console.error('WebGPU uncaptured error:', msg);
    });
    return gc;
  }

  configure(): void {
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
  }

  /** Sync canvas backing size to its CSS size; returns true if it changed. */
  resize(): boolean {
    const dpr = window.devicePixelRatio || 1;
    const max = this.device.limits.maxTextureDimension2D;
    const w = Math.max(1, Math.min(max, Math.floor(this.canvas.clientWidth * dpr)));
    const h = Math.max(1, Math.min(max, Math.floor(this.canvas.clientHeight * dpr)));
    if (w === this.canvas.width && h === this.canvas.height) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }
}
