/** KTX 2.0 container parsing (https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html): header, level index, data format descriptor, supercompression. */

const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];   // «KTX 20»\r\n\x1A\n
const HEADER_BYTES = 80;
const LEVEL_INDEX_ENTRY_BYTES = 24;

/** `supercompressionScheme` values. */
export const Supercompression = { None: 0, BasisLZ: 1, Zstd: 2, Zlib: 3 } as const;
/** Data format descriptor colour models of the two Basis Universal formats. */
const COLOR_MODEL_ETC1S = 163, COLOR_MODEL_UASTC = 166;
const TRANSFER_SRGB = 2;

export interface Ktx2Level { byteOffset: number; byteLength: number; uncompressedByteLength: number; }

export interface Ktx2File {
  /** Vulkan format code; 0 for Basis Universal payloads. */
  vkFormat: number;
  width: number;
  height: number;
  /** 0 for 2D textures. */
  depth: number;
  /** 0 when the texture is not an array. */
  layerCount: number;
  /** 6 for cube maps, 1 otherwise. */
  faceCount: number;
  levelCount: number;
  supercompression: number;
  levels: Ktx2Level[];
  /** Data format descriptor colour model (0 when absent) and whether its transfer function is sRGB. */
  colorModel: number;
  srgbTransfer: boolean;
  /** True for Basis Universal payloads (ETC1S or UASTC), which need the transcoder rather than a direct upload. */
  isBasis: boolean;
  data: Uint8Array;
}

/** True when `bytes` starts with the KTX 2.0 file identifier. */
export function isKTX2(bytes: Uint8Array): boolean {
  if (bytes.byteLength < IDENTIFIER.length) return false;
  for (let i = 0; i < IDENTIFIER.length; i++) if (bytes[i] !== IDENTIFIER[i]) return false;
  return true;
}

/** Parse the KTX2 header, level index and data format descriptor (no pixel data is touched). Throws on malformed input. */
export function parseKTX2(bytes: Uint8Array): Ktx2File {
  if (!isKTX2(bytes)) throw new Error('Not a KTX2 file (bad identifier)');
  if (bytes.byteLength < HEADER_BYTES) throw new Error('KTX2 file is truncated (header)');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (o: number) => dv.getUint32(o, true);
  const u64 = (o: number) => { const v = dv.getBigUint64(o, true); if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('KTX2 offset exceeds 2^53'); return Number(v); };

  const vkFormat = u32(12), width = u32(20), height = u32(24), depth = u32(28), layerCount = u32(32), faceCount = u32(36);
  const levelCountField = u32(40), supercompression = u32(44);
  const dfdOffset = u32(48), dfdLength = u32(52);
  if (width < 1) throw new Error('KTX2: pixelWidth must be at least 1');
  const levelCount = Math.max(1, levelCountField);
  const indexEnd = HEADER_BYTES + levelCount * LEVEL_INDEX_ENTRY_BYTES;
  if (bytes.byteLength < indexEnd) throw new Error('KTX2 file is truncated (level index)');

  const levels: Ktx2Level[] = [];
  for (let i = 0; i < levelCount; i++) {
    const o = HEADER_BYTES + i * LEVEL_INDEX_ENTRY_BYTES;
    const level = { byteOffset: u64(o), byteLength: u64(o + 8), uncompressedByteLength: u64(o + 16) };
    if (level.byteOffset + level.byteLength > bytes.byteLength) throw new Error(`KTX2 file is truncated (level ${i})`);
    levels.push(level);
  }

  let colorModel = 0, srgbTransfer = false;
  if (dfdLength >= 28 && dfdOffset + dfdLength <= bytes.byteLength) {
    // dfdTotalSize (4 bytes), then the basic descriptor block: 2 header words, then colourModel / colorPrimaries / transferFunction / flags
    colorModel = bytes[dfdOffset + 12]; srgbTransfer = bytes[dfdOffset + 14] === TRANSFER_SRGB;
  }
  const isBasis = vkFormat === 0 && (supercompression === Supercompression.BasisLZ || colorModel === COLOR_MODEL_ETC1S || colorModel === COLOR_MODEL_UASTC);
  return { vkFormat, width, height: Math.max(1, height), depth, layerCount, faceCount, levelCount, supercompression, levels, colorModel, srgbTransfer, isBasis, data: bytes };
}

/** The bytes of mip level `index` (0 = largest), with Zstd / Zlib supercompression undone. */
export async function readKTX2Level(file: Ktx2File, index: number): Promise<Uint8Array> {
  const level = file.levels[index];
  const raw = file.data.subarray(level.byteOffset, level.byteOffset + level.byteLength);
  switch (file.supercompression) {
    case Supercompression.None: return raw;
    case Supercompression.Zlib: return inflate(raw, level.uncompressedByteLength);
    case Supercompression.Zstd: {
      const { ZSTDDecoder } = await import('../vendor/zstddec.js');
      const decoder = new ZSTDDecoder();
      await decoder.init();
      return decoder.decode(raw, level.uncompressedByteLength);
    }
    default: throw new Error(`KTX2 supercompression scheme ${file.supercompression} is not supported for this format`);
  }
}

/** Inflate a zlib stream (RFC 1950). */
async function inflate(data: Uint8Array, expectedBytes: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  if (out.byteLength !== expectedBytes) throw new Error(`KTX2 Zlib level has ${out.byteLength} bytes, expected ${expectedBytes}`);
  return out;
}

/** What a Vulkan format maps to: the WebGPU format(s), bytes per texel for per-texel formats. */
export interface VkFormatInfo { linear: GPUTextureFormat; srgb?: GPUTextureFormat; texelBytes?: number; }

const VK: Record<number, VkFormatInfo> = {
  9: { linear: 'r8unorm', texelBytes: 1 }, 16: { linear: 'rg8unorm', texelBytes: 2 },
  37: { linear: 'rgba8unorm', srgb: 'rgba8unorm-srgb', texelBytes: 4 }, 43: { linear: 'rgba8unorm', srgb: 'rgba8unorm-srgb', texelBytes: 4 },
  44: { linear: 'bgra8unorm', srgb: 'bgra8unorm-srgb', texelBytes: 4 }, 50: { linear: 'bgra8unorm', srgb: 'bgra8unorm-srgb', texelBytes: 4 },
  76: { linear: 'r16float', texelBytes: 2 }, 83: { linear: 'rg16float', texelBytes: 4 }, 97: { linear: 'rgba16float', texelBytes: 8 },
  100: { linear: 'r32float', texelBytes: 4 }, 103: { linear: 'rg32float', texelBytes: 8 }, 109: { linear: 'rgba32float', texelBytes: 16 },
  131: { linear: 'bc1-rgba-unorm', srgb: 'bc1-rgba-unorm-srgb' }, 132: { linear: 'bc1-rgba-unorm', srgb: 'bc1-rgba-unorm-srgb' },
  133: { linear: 'bc1-rgba-unorm', srgb: 'bc1-rgba-unorm-srgb' }, 134: { linear: 'bc1-rgba-unorm', srgb: 'bc1-rgba-unorm-srgb' },
  135: { linear: 'bc2-rgba-unorm', srgb: 'bc2-rgba-unorm-srgb' }, 136: { linear: 'bc2-rgba-unorm', srgb: 'bc2-rgba-unorm-srgb' },
  137: { linear: 'bc3-rgba-unorm', srgb: 'bc3-rgba-unorm-srgb' }, 138: { linear: 'bc3-rgba-unorm', srgb: 'bc3-rgba-unorm-srgb' },
  139: { linear: 'bc4-r-unorm' }, 140: { linear: 'bc4-r-snorm' }, 141: { linear: 'bc5-rg-unorm' }, 142: { linear: 'bc5-rg-snorm' },
  143: { linear: 'bc6h-rgb-ufloat' }, 144: { linear: 'bc6h-rgb-float' },
  145: { linear: 'bc7-rgba-unorm', srgb: 'bc7-rgba-unorm-srgb' }, 146: { linear: 'bc7-rgba-unorm', srgb: 'bc7-rgba-unorm-srgb' },
  147: { linear: 'etc2-rgb8unorm', srgb: 'etc2-rgb8unorm-srgb' }, 148: { linear: 'etc2-rgb8unorm', srgb: 'etc2-rgb8unorm-srgb' },
  149: { linear: 'etc2-rgb8a1unorm', srgb: 'etc2-rgb8a1unorm-srgb' }, 150: { linear: 'etc2-rgb8a1unorm', srgb: 'etc2-rgb8a1unorm-srgb' },
  151: { linear: 'etc2-rgba8unorm', srgb: 'etc2-rgba8unorm-srgb' }, 152: { linear: 'etc2-rgba8unorm', srgb: 'etc2-rgba8unorm-srgb' },
  153: { linear: 'eac-r11unorm' }, 154: { linear: 'eac-r11snorm' }, 155: { linear: 'eac-rg11unorm' }, 156: { linear: 'eac-rg11snorm' },
};
// ASTC: VK_FORMAT_ASTC_<w>x<h>_{UNORM,SRGB}_BLOCK = 157 + 2 * index (+ 1 for sRGB), in this order
['4x4', '5x4', '5x5', '6x5', '6x6', '8x5', '8x6', '8x8', '10x5', '10x6', '10x8', '10x10', '12x10', '12x12'].forEach((size, i) => {
  const info: VkFormatInfo = { linear: `astc-${size}-unorm` as GPUTextureFormat, srgb: `astc-${size}-unorm-srgb` as GPUTextureFormat };
  VK[157 + 2 * i] = info; VK[158 + 2 * i] = info;
});

/** The WebGPU format of a Vulkan format code (colour data uses the sRGB variant when `srgb` is set and one exists), or undefined if unsupported. */
export function vkFormatInfo(vkFormat: number): VkFormatInfo | undefined { return VK[vkFormat]; }
