import type { GLTFDocument } from './GLTFParser';
import { decodeDataURI } from './GLTFParser';
import type { ImageAsset, TextureUse } from '../AssetTypes';

const FILTER_NEAREST = 9728, FILTER_LINEAR = 9729;
const NEAREST_MIPMAP_NEAREST = 9984, LINEAR_MIPMAP_NEAREST = 9985, NEAREST_MIPMAP_LINEAR = 9986, LINEAR_MIPMAP_LINEAR = 9987;
const WRAP_CLAMP = 33071, WRAP_MIRROR = 33648;

function wrap(w: number | undefined): GPUAddressMode {
  return w === WRAP_CLAMP ? 'clamp-to-edge' : w === WRAP_MIRROR ? 'mirror-repeat' : 'repeat';
}

/** Map a glTF sampler to a WebGPU sampler descriptor (mipmapFilter defaults to linear when unspecified). */
export function toSamplerDescriptor(s?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }): GPUSamplerDescriptor {
  const mag: GPUFilterMode = s?.magFilter === FILTER_NEAREST ? 'nearest' : 'linear';
  let min: GPUFilterMode = 'linear', mip: GPUMipmapFilterMode = 'linear';
  switch (s?.minFilter) {
    case FILTER_NEAREST: min = 'nearest'; mip = 'nearest'; break;
    case FILTER_LINEAR: min = 'linear'; mip = 'nearest'; break;
    case NEAREST_MIPMAP_NEAREST: min = 'nearest'; mip = 'nearest'; break;
    case LINEAR_MIPMAP_NEAREST: min = 'linear'; mip = 'nearest'; break;
    case NEAREST_MIPMAP_LINEAR: min = 'nearest'; mip = 'linear'; break;
    case LINEAR_MIPMAP_LINEAR: min = 'linear'; mip = 'linear'; break;
    default: break;
  }
  return { magFilter: mag, minFilter: min, mipmapFilter: mip, addressModeU: wrap(s?.wrapS), addressModeV: wrap(s?.wrapT) };
}

export function loadImages(doc: GLTFDocument): ImageAsset[] {
  return (doc.json.images ?? []).map((img, i) => {
    const name = img.name ?? `image${i}`;
    const mimeType = img.mimeType ?? guessMime(img.uri);
    if (img.bufferView !== undefined) {
      const view = doc.json.bufferViews![img.bufferView];
      const buf = doc.buffers[view.buffer];
      const start = view.byteOffset ?? 0;
      return { name, mimeType, data: buf.subarray(start, start + view.byteLength) };
    }
    if (img.uri?.startsWith('data:')) return { name, mimeType, data: decodeDataURI(img.uri) };
    return { name, mimeType, uri: img.uri };
  });
}

function guessMime(uri?: string): string {
  if (!uri) return 'image/png';
  if (/\.jpe?g($|\?)/i.test(uri)) return 'image/jpeg';
  if (/\.webp($|\?)/i.test(uri)) return 'image/webp';
  if (/\.ktx2($|\?)/i.test(uri)) return 'image/ktx2';
  return 'image/png';
}

/**
 * De-duplicating registry of texture uses. The same glTF texture can be needed as sRGB (base color)
 * and as linear data (e.g. packed), which are different GPU textures; they are keyed accordingly.
 */
export class TextureUseRegistry {
  readonly uses: TextureUse[] = [];
  private index = new Map<string, number>();

  constructor(private doc: GLTFDocument, private warn: (m: string) => void) {}

  resolve(textureIndex: number, srgb: boolean): number | undefined {
    const tex = this.doc.json.textures?.[textureIndex];
    if (!tex || tex.source === undefined) { this.warn(`texture ${textureIndex} has no image source`); return undefined; }
    const sampler = toSamplerDescriptor(tex.sampler !== undefined ? this.doc.json.samplers?.[tex.sampler] : undefined);
    const key = `${tex.source}|${srgb ? 1 : 0}|${JSON.stringify(sampler)}`;
    let id = this.index.get(key);
    if (id === undefined) { id = this.uses.length; this.uses.push({ image: tex.source, sampler, srgb }); this.index.set(key, id); }
    return id;
  }
}
