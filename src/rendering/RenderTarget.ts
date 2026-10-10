import type { GPUContext } from '../gpu/GPUContext';
import { DEPTH_FORMAT } from './formats';
import type { TextureRef } from './materials/Material';

/** Format of render targets: linear HDR radiance (no tone mapping, no sRGB encoding), so the colour can be used as a texture. */
export const RENDER_TARGET_FORMAT: GPUTextureFormat = 'rgba16float';

export interface RenderTargetDesc {
  /** Size in pixels. With `scale` set these are only the initial size. */
  width?: number;
  height?: number;
  /** Follow the canvas size times this factor (e.g. 0.5 = half resolution); the texture is re-created on canvas resize. */
  scale?: number;
  label?: string;
}

let nextId = 0;

/**
 * An off-screen colour + depth buffer that a {@link RenderView} draws into and materials can sample. The colour is linear HDR
 * (`rgba16float`); use `target.ref` as a `TextureRef` in `createPBR({ textures: { emissive: target.ref } })` or in a custom material.
 */
export class RenderTarget {
  readonly id = nextId++;
  readonly label: string;
  /** Canvas-relative size factor, or 0 for a fixed size. */
  readonly scale: number;
  width: number;
  height: number;
  texture!: GPUTexture;
  view!: GPUTextureView;
  depthTexture!: GPUTexture;
  depthView!: GPUTextureView;
  /** Texture handle for materials; `view` is updated in place when the target is resized (see `onResized`). */
  readonly ref: TextureRef;
  /** Called after the textures were re-created (the renderer uses it to refresh material bind groups). */
  onResized: ((t: RenderTarget) => void) | null = null;
  private destroyed = false;

  constructor(private gpu: GPUContext, desc: RenderTargetDesc = {}) {
    this.scale = desc.scale ?? 0;
    this.width = Math.max(1, Math.round(desc.width ?? (this.scale ? gpu.canvas.width * this.scale : 256)));
    this.height = Math.max(1, Math.round(desc.height ?? (this.scale ? gpu.canvas.height * this.scale : 256)));
    this.label = desc.label ?? `rt-${this.id}`;
    this.allocate();
    this.ref = { id: `rendertarget:${this.id}`, view: this.view };
  }

  private allocate(): void {
    const { textures } = this.gpu.resources;
    this.texture = textures.create({
      label: this.label, size: [this.width, this.height], format: RENDER_TARGET_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this.view = this.texture.createView();
    this.depthTexture = textures.create({ label: `${this.label}-depth`, size: [this.width, this.height], format: DEPTH_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.depthView = this.depthTexture.createView();
  }

  /** Re-create the textures at a new size (contents are lost until the next render). */
  resize(width: number, height: number): void {
    width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
    if (this.destroyed || (width === this.width && height === this.height)) return;
    const { textures } = this.gpu.resources;
    textures.destroy(this.texture); textures.destroy(this.depthTexture);
    this.width = width; this.height = height;
    this.allocate();
    this.ref.view = this.view;
    this.onResized?.(this);
  }

  /** Read the colour back as linear RGBA floats (row 0 = top). Slow (waits for the GPU): for tests, debugging and CPU-side analysis. */
  async readPixels(): Promise<Float32Array> {
    const { device } = this.gpu;
    const bpr = Math.ceil(this.width * 8 / 256) * 256;
    const buf = device.createBuffer({ label: `${this.label}-readback`, size: bpr * this.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: this.texture }, { buffer: buf, bytesPerRow: bpr }, [this.width, this.height]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const halves = new Uint16Array(buf.getMappedRange().slice(0));
    buf.unmap(); buf.destroy();
    const out = new Float32Array(this.width * this.height * 4);
    const rowHalves = bpr / 2;
    for (let y = 0; y < this.height; y++) {
      for (let i = 0; i < this.width * 4; i++) out[y * this.width * 4 + i] = halfToFloat(halves[y * rowHalves + i]);
    }
    return out;
  }

  /** Free the GPU textures. Materials still referencing `ref` would read a destroyed texture: remove them first. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const { textures } = this.gpu.resources;
    textures.destroy(this.texture); textures.destroy(this.depthTexture);
  }
}

/** IEEE 754 half -> float. */
export function halfToFloat(h: number): number {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (m / 1024);
  if (e === 31) return m ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + m / 1024);
}
