import type { GPUContext } from '../../gpu/GPUContext';
import { blockFormat, blockLevelBytes } from './BlockFormats';
import { BasisFormat, BasisTranscoder, type BasisImageInfo } from './BasisTranscoder';
import { parseKTX2, readKTX2Level, vkFormatInfo, type Ktx2File } from './Ktx2';

/** Where a Basis Universal image is transcoded to: the Basis target format and the GPU texture format that holds it. */
export interface BasisTarget { transcoder: number; format: GPUTextureFormat; }

/**
 * Pick the best GPU format a Basis Universal image can be transcoded to on a device with `features`.
 * UASTC prefers ASTC, then BC7, ETC2, BC3 / BC1; ETC1S prefers ETC2, then BC7, BC3 / BC1 (it cannot become ASTC). Images whose size is not a
 * multiple of the 4x4 block (WebGPU requires that of compressed textures) and devices without any compression feature get plain RGBA8.
 */
export function chooseBasisTarget(info: Pick<BasisImageInfo, 'encoding' | 'hasAlpha' | 'width' | 'height'>, srgb: boolean, features: { has(name: string): boolean }): BasisTarget {
  const suffix = srgb ? '-srgb' : '';
  const rgba8: BasisTarget = { transcoder: BasisFormat.RGBA32, format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm' };
  if (info.width % 4 !== 0 || info.height % 4 !== 0) return rgba8;
  const astc = features.has('texture-compression-astc'), bc = features.has('texture-compression-bc'), etc2 = features.has('texture-compression-etc2');
  const candidates: (BasisTarget | false)[] = [];
  const asAstc: BasisTarget | false = astc && { transcoder: BasisFormat.ASTC_4x4, format: `astc-4x4-unorm${suffix}` as GPUTextureFormat };
  const asEtc2: BasisTarget | false = etc2 && (info.hasAlpha
    ? { transcoder: BasisFormat.ETC2, format: `etc2-rgba8unorm${suffix}` as GPUTextureFormat }
    : { transcoder: BasisFormat.ETC1, format: `etc2-rgb8unorm${suffix}` as GPUTextureFormat });
  const asBc7: BasisTarget | false = bc && { transcoder: BasisFormat.BC7, format: `bc7-rgba-unorm${suffix}` as GPUTextureFormat };
  const asBc: BasisTarget | false = bc && (info.hasAlpha
    ? { transcoder: BasisFormat.BC3, format: `bc3-rgba-unorm${suffix}` as GPUTextureFormat }
    : { transcoder: BasisFormat.BC1, format: `bc1-rgba-unorm${suffix}` as GPUTextureFormat });
  if (info.encoding === 'uastc') candidates.push(asAstc, asBc7, asEtc2, asBc);
  else candidates.push(asEtc2, asBc7, asBc);
  return candidates.find((c): c is BasisTarget => !!c) ?? rgba8;
}

/** What {@link createKTX2Texture} made. */
export interface KTX2Texture {
  texture: GPUTexture;
  format: GPUTextureFormat;
  width: number;
  height: number;
  levels: number;
  /** `basis` payloads are transcoded, `direct` files are uploaded as stored. */
  source: 'basis' | 'direct';
}

export interface KTX2UploadOptions {
  /** Device features to base the format choice on (default: the device's own). Tests use it to exercise each format path on one GPU. */
  features?: { has(name: string): boolean };
  /** Called for textures stored without mip levels in a renderable format (RGBA8 fallback) so a chain can be generated. */
  generateMips?: (texture: GPUTexture, format: GPUTextureFormat, levels: number) => void;
}

/** Usage of a sampled texture filled by `queue.writeTexture` (read lazily: `GPUTextureUsage` does not exist outside a WebGPU browser). */
const sampledCopy = () => GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;

/**
 * Decode a KTX2 file into a GPU texture. Basis Universal payloads (UASTC / ETC1S) are transcoded to the best compressed format the
 * device supports; files that already store a GPU format (BC, ETC2, ASTC, uncompressed) are uploaded as they are. `srgb` selects the sRGB
 * variant of formats that have one (colour data) and the linear one otherwise (normals, masks).
 */
export async function createKTX2Texture(gpu: GPUContext, label: string, bytes: Uint8Array, srgb: boolean, options: KTX2UploadOptions = {}): Promise<KTX2Texture> {
  const file = parseKTX2(bytes);
  if (file.depth > 1 || file.layerCount > 1 || file.faceCount > 1) throw new Error('KTX2: only plain 2D textures are supported (no arrays, cube maps or 3D)');
  return file.isBasis ? uploadBasis(gpu, label, bytes, srgb, options) : uploadDirect(gpu, label, file, srgb);
}

/** Transcode a Basis Universal KTX2 file level by level into a new texture. */
async function uploadBasis(gpu: GPUContext, label: string, bytes: Uint8Array, srgb: boolean, options: KTX2UploadOptions): Promise<KTX2Texture> {
  const transcoder = await BasisTranscoder.load();
  const image = transcoder.open(bytes);
  try {
    const { info } = image;
    const target = chooseBasisTarget(info, srgb, options.features ?? gpu.device.features);
    const block = blockFormat(target.format);
    const levels = info.levels;
    const generate = !block && levels === 1 && !!options.generateMips;
    const mipCount = generate ? Math.floor(Math.log2(Math.max(info.width, info.height))) + 1 : levels;
    const texture = gpu.resources.textures.create({
      label, size: [info.width, info.height], format: target.format, mipLevelCount: mipCount,
      usage: sampledCopy() | (generate ? GPUTextureUsage.RENDER_ATTACHMENT : 0),
    });
    try {
      for (let level = 0; level < levels; level++) {
        const data = image.transcode(level, target.transcoder);
        const { width, height } = image.levelSize(level);
        writeLevel(gpu, texture, level, data, width, height, block);
        // yield between levels so a large texture does not monopolise the main thread
        if (level + 1 < levels) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (generate) options.generateMips!(texture, target.format, mipCount);
    } catch (error) { gpu.resources.textures.destroy(texture); throw error; }
    return { texture, format: target.format, width: info.width, height: info.height, levels: mipCount, source: 'basis' };
  } finally { image.close(); }
}

/** Upload a KTX2 file whose pixel data is already in a GPU format. */
async function uploadDirect(gpu: GPUContext, label: string, file: Ktx2File, srgb: boolean): Promise<KTX2Texture> {
  const info = vkFormatInfo(file.vkFormat);
  if (!info) throw new Error(`KTX2: Vulkan format ${file.vkFormat} is not supported`);
  const format = srgb && info.srgb ? info.srgb : info.linear;
  const block = blockFormat(format);
  if (block && !gpu.device.features.has(block.feature)) throw new Error(`KTX2: ${format} needs the '${block.feature}' device feature, which this device does not have`);
  if (block && (file.width % block.width !== 0 || file.height % block.height !== 0)) {
    throw new Error(`KTX2: ${format} textures must have a size that is a multiple of ${block.width}x${block.height} (got ${file.width}x${file.height})`);
  }
  const texture = gpu.resources.textures.create({ label, size: [file.width, file.height], format, mipLevelCount: file.levelCount, usage: sampledCopy() });
  try {
    for (let level = 0; level < file.levelCount; level++) {
      const data = await readKTX2Level(file, level);
      const width = Math.max(1, file.width >> level), height = Math.max(1, file.height >> level);
      const expected = block ? blockLevelBytes(block, width, height) : width * height * info.texelBytes!;
      if (data.byteLength < expected) throw new Error(`KTX2 level ${level} has ${data.byteLength} bytes, expected ${expected}`);
      writeLevel(gpu, texture, level, data, width, height, block);
    }
  } catch (error) { gpu.resources.textures.destroy(texture); throw error; }
  return { texture, format, width: file.width, height: file.height, levels: file.levelCount, source: 'direct' };
}

/** Write one mip level (tightly packed rows of blocks or texels) with `queue.writeTexture`. */
function writeLevel(gpu: GPUContext, texture: GPUTexture, level: number, data: Uint8Array, width: number, height: number, block: ReturnType<typeof blockFormat>): void {
  const blocksX = block ? Math.ceil(width / block.width) : width;
  const blocksY = block ? Math.ceil(height / block.height) : height;
  const bytesPerPixelOrBlock = block ? block.bytes : data.byteLength / (width * height);
  // compressed copies cover whole blocks, so a level smaller than a block is copied at the padded (physical) size
  const copyWidth = block ? blocksX * block.width : width, copyHeight = block ? blocksY * block.height : height;
  gpu.queue.writeTexture({ texture, mipLevel: level }, data as BufferSource, { bytesPerRow: blocksX * bytesPerPixelOrBlock, rowsPerImage: blocksY }, [copyWidth, copyHeight]);
}
