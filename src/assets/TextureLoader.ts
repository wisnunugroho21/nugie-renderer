import type { GPUContext } from '../gpu/GPUContext';
import { MipmapGenerator } from '../gpu/MipmapGenerator';
import { mipLevelCount } from '../gpu/TextureManager';
import type { TextureRef } from '../rendering/materials/Material';
import type { ImageAsset } from './AssetTypes';

export type UriResolver = (uri: string) => Promise<Uint8Array>;

/**
 * Async image -> GPU texture pipeline:
 *   encoded bytes -> createImageBitmap (off-main-thread decode) -> texture (+full mip chain) -> TextureRef
 * Colour data uses *-srgb formats (hardware decode on sample); data textures are linear.
 * Identical (image, colour space) requests share one texture and one in-flight promise, so unchanged
 * textures are never re-uploaded.
 */
export class TextureLoader {
  private mips: MipmapGenerator;
  private inflight = new Map<string, Promise<TextureRef>>();
  uploads = 0;
  decodeMs = 0;

  /** Create a loader on `gpu`; `resolveUri` fetches external image files (embedded images need none). */
  constructor(private gpu: GPUContext, private resolveUri?: UriResolver) {
    this.mips = new MipmapGenerator(gpu.device, gpu.resources);
  }

  /** `key` identifies the source image (e.g. asset id + image index) for de-duplication. */
  load(key: string, image: ImageAsset, srgb: boolean): Promise<TextureRef> {
    const k = `${key}|${srgb ? 'srgb' : 'linear'}`;
    let p = this.inflight.get(k);
    if (!p) {
      p = this.loadImpl(k, image, srgb).catch((error: unknown) => {
        this.inflight.delete(k); // transient fetch / decode failures can be retried
        throw error;
      });
      this.inflight.set(k, p);
    }
    return p;
  }

  /** Decode the image bytes with `createImageBitmap` (no colour-space conversion, no premultiply) and upload them as a mip-mapped texture. */
  private async loadImpl(id: string, image: ImageAsset, srgb: boolean): Promise<TextureRef> {
    const bytes = image.data ?? (image.uri && this.resolveUri ? await this.resolveUri(image.uri) : undefined);
    if (!bytes) throw new Error(`Image '${image.name}' has no data and cannot be resolved`);
    const t0 = performance.now();
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: image.mimeType }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    this.decodeMs += performance.now() - t0;
    return this.upload(id, bitmap, srgb);
  }

  /** Upload an already decoded bitmap (also used for procedural textures). */
  upload(id: string, bitmap: ImageBitmap, srgb: boolean): TextureRef {
    const { queue, resources } = this.gpu;
    const format: GPUTextureFormat = srgb ? 'rgba8unorm-srgb' : 'rgba8unorm';
    const mips = mipLevelCount(bitmap.width, bitmap.height);
    let texture: GPUTexture | undefined;
    try {
      texture = resources.textures.create({
        label: id, size: [bitmap.width, bitmap.height], format, mipLevelCount: mips,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      queue.copyExternalImageToTexture({ source: bitmap, flipY: false }, { texture }, [bitmap.width, bitmap.height]);
      this.mips.generate(texture, format, mips);
    } catch (error) {
      if (texture) resources.textures.destroy(texture);
      throw error;
    } finally {
      bitmap.close();
    }
    this.uploads++;
    return { id, view: texture.createView() };
  }
}

/** Sampler with anisotropic filtering when the glTF sampler uses full trilinear filtering. */
export function withAnisotropy(desc: GPUSamplerDescriptor, maxAnisotropy = 8): GPUSamplerDescriptor {
  const trilinear = desc.magFilter === 'linear' && desc.minFilter === 'linear' && desc.mipmapFilter === 'linear';
  return trilinear ? { ...desc, maxAnisotropy } : desc;
}
