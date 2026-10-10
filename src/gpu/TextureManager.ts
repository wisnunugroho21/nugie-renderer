import type { GPUStats } from './GPUStats';

const BYTES_PER_PIXEL: Partial<Record<GPUTextureFormat, number>> = {
  r8unorm: 1, rg8unorm: 2, rgba8unorm: 4, 'rgba8unorm-srgb': 4, bgra8unorm: 4, 'bgra8unorm-srgb': 4,
  r16float: 2, rg16float: 4, rgba16float: 8, r32float: 4, rg32float: 8, rgba32float: 16,
  depth24plus: 4, depth32float: 4, 'depth24plus-stencil8': 4, 'depth16unorm': 2,
  rgb10a2unorm: 4, rg11b10ufloat: 4,
};

/** Estimated GPU bytes for a full mip chain (or `mips` levels). */
export function estimateTextureBytes(w: number, h: number, layers: number, format: GPUTextureFormat, mips: number, dimension: GPUTextureDimension = '2d'): number {
  const bpp = BYTES_PER_PIXEL[format] ?? 4;
  let total = 0;
  for (let m = 0; m < mips; m++) {
    const depth = dimension === '3d' ? Math.max(1, layers >> m) : layers;
    total += Math.max(1, w >> m) * Math.max(1, h >> m) * depth * bpp;
  }
  return total;
}

/** Number of mip levels of a full chain for a `w` x `h` base size. */
export function mipLevelCount(w: number, h: number): number {
  return Math.floor(Math.log2(Math.max(w, h))) + 1;
}

/** Tracked texture creation with optional key-based deduplication. */
export class TextureManager {
  private byKey = new Map<string, GPUTexture>();
  private live = new Map<GPUTexture, number>();

  /** Create a manager that tracks texture counts and estimated bytes in `stats`. */
  constructor(private device: GPUDevice, private stats: GPUStats) {}

  /** Create a tracked texture from `desc`, recording its estimated memory. */
  create(desc: GPUTextureDescriptor): GPUTexture {
    const t = this.device.createTexture(desc);
    const size = Array.isArray(desc.size) ? desc.size : [(desc.size as GPUExtent3DDict).width, (desc.size as GPUExtent3DDict).height ?? 1, (desc.size as GPUExtent3DDict).depthOrArrayLayers ?? 1];
    const bytes = estimateTextureBytes(size[0], size[1] ?? 1, size[2] ?? 1, desc.format, desc.mipLevelCount ?? 1, desc.dimension) * (desc.sampleCount ?? 1);
    this.live.set(t, bytes);
    this.stats.textures = this.live.size;
    this.stats.textureBytes += bytes;
    return t;
  }

  /** Return an existing texture for `key` or create one via `factory` (deduplication). */
  getOrCreate(key: string, factory: () => GPUTexture): GPUTexture {
    const hit = this.byKey.get(key);
    if (hit) { this.stats.textureHits++; return hit; }
    this.stats.textureMisses++;
    const t = factory();
    this.byKey.set(key, t);
    return t;
  }

  /** Destroy a texture created here, forget its dedupe key and update the stats. */
  destroy(t: GPUTexture): void {
    const bytes = this.live.get(t);
    if (bytes === undefined) return;
    this.live.delete(t);
    for (const [k, v] of this.byKey) if (v === t) this.byKey.delete(k);
    this.stats.textures = this.live.size;
    this.stats.textureBytes -= bytes;
    t.destroy();
  }
}
