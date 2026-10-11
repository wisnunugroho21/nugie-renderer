import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isKTX2, parseKTX2, readKTX2Level, vkFormatInfo } from '../src/assets/codecs/Ktx2';
import { BasisFormat, BasisTranscoder } from '../src/assets/codecs/BasisTranscoder';
import { chooseBasisTarget, createKTX2Texture } from '../src/assets/codecs/Ktx2Texture';
import { blockFormat, blockLevelBytes } from '../src/assets/codecs/BlockFormats';
import { estimateTextureBytes } from '../src/gpu/TextureManager';
import { TextureLoader } from '../src/assets/TextureLoader';
import type { GPUContext } from '../src/gpu/GPUContext';
import { loadGLTF } from '../src/assets/gltf/GLTFLoader';
import { GLBBuilder, addTriangle } from './helpers/glbBuilder';
import { useVendoredDecoders } from './helpers/codecFixtures';
import { writeKTX2 } from './helpers/ktx2Writer';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
beforeAll(() => useVendoredDecoders());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** The pattern scripts/make-codec-fixtures.mjs encodes. */
function pattern(w: number, h: number): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    data[o] = Math.round(255 * x / (w - 1)); data[o + 1] = Math.round(255 * y / (h - 1));
    data[o + 2] = ((x >> 3) + (y >> 3)) & 1 ? 220 : 40; data[o + 3] = 255 - Math.round(127 * x / (w - 1));
  }
  return data;
}

/** A GPU context that records what would be created and written. */
function fakeGPU(features: string[]) {
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 });
  const writes: { level: number; bytes: number; bytesPerRow: number; rows: number; size: number[] }[] = [];
  const created: GPUTextureDescriptor[] = [];
  const texture = { createView: () => ({}) };
  const gpu = {
    device: { features: new Set(features) },
    queue: {
      writeTexture: vi.fn((dest: { mipLevel: number }, data: Uint8Array, layout: { bytesPerRow: number; rowsPerImage: number }, size: number[]) => {
        writes.push({ level: dest.mipLevel, bytes: data.byteLength, bytesPerRow: layout.bytesPerRow, rows: layout.rowsPerImage, size });
      }),
      copyExternalImageToTexture: vi.fn(),
    },
    resources: { textures: { create: vi.fn((d: GPUTextureDescriptor) => { created.push(d); return texture; }), destroy: vi.fn() } },
  };
  return { gpu: gpu as unknown as GPUContext, raw: gpu, writes, created };
}

describe('KTX2 container', () => {
  it('recognises the identifier and reads the header of a Basis file', () => {
    const bytes = fixture('pattern-uastc.ktx2');
    expect(isKTX2(bytes)).toBe(true);
    expect(isKTX2(new Uint8Array(32))).toBe(false);
    const f = parseKTX2(bytes);
    expect([f.width, f.height, f.levelCount, f.vkFormat]).toEqual([64, 32, 7, 0]);
    expect(f.isBasis).toBe(true);
    expect(f.srgbTransfer).toBe(true);
    expect(f.faceCount).toBe(1);
  });
  it('rejects truncated and foreign files', () => {
    const bytes = fixture('pattern-etc1s.ktx2');
    expect(() => parseKTX2(new Uint8Array(100))).toThrow(/identifier/);
    expect(() => parseKTX2(bytes.subarray(0, 60))).toThrow(/truncated/);
    expect(() => parseKTX2(bytes.subarray(0, bytes.length - 40))).toThrow(/truncated/);
  });
  it('maps Vulkan formats to WebGPU formats, with an sRGB variant where one exists', () => {
    expect(vkFormatInfo(37)).toMatchObject({ linear: 'rgba8unorm', srgb: 'rgba8unorm-srgb' });
    expect(vkFormatInfo(145)).toMatchObject({ linear: 'bc7-rgba-unorm', srgb: 'bc7-rgba-unorm-srgb' });
    expect(vkFormatInfo(157)).toMatchObject({ linear: 'astc-4x4-unorm', srgb: 'astc-4x4-unorm-srgb' });
    expect(vkFormatInfo(184)).toMatchObject({ linear: 'astc-12x12-unorm-srgb'.replace('-srgb', '') });
    expect(vkFormatInfo(141)).toEqual({ linear: 'bc5-rg-unorm' });
    expect(vkFormatInfo(1)).toBeUndefined();
  });
  it('undoes zlib supercompression per level', async () => {
    const level = new Uint8Array(64).map((_, i) => (i * 7) & 255);
    const f = parseKTX2(writeKTX2({ vkFormat: 37, width: 4, height: 4, levels: [{ data: level }], zlib: true }));
    expect(Array.from(await readKTX2Level(f, 0))).toEqual(Array.from(level));
  });
});

describe('Basis Universal transcoding (real wasm transcoder)', () => {
  /** Transcode level 0 to RGBA8 and return the mean absolute error against the source pattern, per channel. */
  async function error(name: string): Promise<number[]> {
    const image = (await BasisTranscoder.load()).open(fixture(name));
    try {
      expect(image.info).toMatchObject({ width: 64, height: 32, levels: 7, hasAlpha: true });
      const rgba = image.transcode(0, BasisFormat.RGBA32), ref = pattern(64, 32);
      expect(rgba.byteLength).toBe(64 * 32 * 4);
      const sums = [0, 0, 0, 0];
      for (let i = 0; i < rgba.length; i++) sums[i & 3] += Math.abs(rgba[i] - ref[i]);
      return sums.map((s) => s / (64 * 32));
    } finally { image.close(); }
  }
  it('UASTC reproduces the source closely', async () => {
    expect((await error('pattern-uastc.ktx2')).every((e) => e < 6)).toBe(true);
  });
  it('ETC1S is lossier but still recognisable', async () => {
    expect((await error('pattern-etc1s.ktx2')).every((e) => e < 30)).toBe(true);
  });
  it('transcodes to block formats with the expected sizes', async () => {
    const image = (await BasisTranscoder.load()).open(fixture('pattern-uastc.ktx2'));
    try {
      expect(image.transcode(0, BasisFormat.ASTC_4x4).byteLength).toBe(16 * 8 * 16);
      expect(image.transcode(0, BasisFormat.BC7).byteLength).toBe(16 * 8 * 16);
      expect(image.transcode(0, BasisFormat.ETC2).byteLength).toBe(16 * 8 * 16);
      expect(image.transcode(0, BasisFormat.BC1).byteLength).toBe(16 * 8 * 8);
      expect(image.levelSize(2)).toEqual({ width: 16, height: 8 });
    } finally { image.close(); }
  });
  it('refuses data that is not a KTX2 file', async () => {
    const t = await BasisTranscoder.load();
    expect(() => t.open(new Uint8Array(200))).toThrow(/Invalid/);
  });
});

describe('transcode target selection', () => {
  const info = (encoding: 'uastc' | 'etc1s', hasAlpha: boolean, width = 64, height = 64) => ({ encoding, hasAlpha, width, height });
  const all = new Set(['texture-compression-astc', 'texture-compression-bc', 'texture-compression-etc2']);
  it('UASTC prefers ASTC, then BC7, then ETC2, then BC1 / BC3', () => {
    expect(chooseBasisTarget(info('uastc', true), true, all)).toEqual({ transcoder: BasisFormat.ASTC_4x4, format: 'astc-4x4-unorm-srgb' });
    expect(chooseBasisTarget(info('uastc', true), false, new Set(['texture-compression-bc', 'texture-compression-etc2']))).toEqual({ transcoder: BasisFormat.BC7, format: 'bc7-rgba-unorm' });
    expect(chooseBasisTarget(info('uastc', false), true, new Set(['texture-compression-etc2']))).toEqual({ transcoder: BasisFormat.ETC1, format: 'etc2-rgb8unorm-srgb' });
    expect(chooseBasisTarget(info('uastc', true), true, new Set(['texture-compression-etc2']))).toEqual({ transcoder: BasisFormat.ETC2, format: 'etc2-rgba8unorm-srgb' });
  });
  it('ETC1S prefers ETC2 and never becomes ASTC', () => {
    expect(chooseBasisTarget(info('etc1s', false), true, all)).toEqual({ transcoder: BasisFormat.ETC1, format: 'etc2-rgb8unorm-srgb' });
    expect(chooseBasisTarget(info('etc1s', true), true, new Set(['texture-compression-astc']))).toEqual({ transcoder: BasisFormat.RGBA32, format: 'rgba8unorm-srgb' });
    expect(chooseBasisTarget(info('etc1s', true), false, new Set(['texture-compression-bc']))).toEqual({ transcoder: BasisFormat.BC7, format: 'bc7-rgba-unorm' });
  });
  it('falls back to RGBA8 without a compression feature or for sizes that are not a multiple of 4', () => {
    expect(chooseBasisTarget(info('uastc', true), true, new Set())).toEqual({ transcoder: BasisFormat.RGBA32, format: 'rgba8unorm-srgb' });
    expect(chooseBasisTarget(info('uastc', true, 62, 64), false, all)).toEqual({ transcoder: BasisFormat.RGBA32, format: 'rgba8unorm' });
  });
});

describe('uploading KTX2 textures', () => {
  it('uploads a UASTC file as ASTC, one write per stored mip level', async () => {
    const s = fakeGPU(['texture-compression-astc', 'texture-compression-bc']);
    const made = await createKTX2Texture(s.gpu, 'uastc', fixture('pattern-uastc.ktx2'), true);
    expect(made).toMatchObject({ format: 'astc-4x4-unorm-srgb', width: 64, height: 32, levels: 7, source: 'basis' });
    expect(s.created[0]).toMatchObject({ format: 'astc-4x4-unorm-srgb', mipLevelCount: 7, size: [64, 32] });
    expect(s.created[0].usage & 16).toBe(0);   // compressed formats cannot be render targets
    expect(s.writes.map((w) => w.level)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(s.writes[0]).toMatchObject({ bytes: 16 * 8 * 16, bytesPerRow: 16 * 16, rows: 8, size: [64, 32] });
    // 1x1 and 2x2 levels are copied at the padded 4x4 block size
    expect(s.writes[6]).toMatchObject({ bytes: 16, bytesPerRow: 16, rows: 1, size: [4, 4] });
  });

  it('uses linear formats for data textures and BC7 where ASTC is missing', async () => {
    const s = fakeGPU(['texture-compression-bc']);
    const made = await createKTX2Texture(s.gpu, 'uastc', fixture('pattern-uastc.ktx2'), false);
    expect(made.format).toBe('bc7-rgba-unorm');
  });

  it('transcodes to RGBA8 on a device without compression and can generate the missing mips', async () => {
    const s = fakeGPU([]);
    const generateMips = vi.fn();
    const made = await createKTX2Texture(s.gpu, 'etc1s', fixture('pattern-etc1s.ktx2'), true, { generateMips });
    expect(made.format).toBe('rgba8unorm-srgb');
    expect(made.levels).toBe(7);                   // the file stores a full chain: used as is
    expect(s.writes[0]).toMatchObject({ bytes: 64 * 32 * 4, bytesPerRow: 64 * 4, size: [64, 32] });
    expect(generateMips).not.toHaveBeenCalled();
  });

  it('uploads raw KTX2 data (zlib supercompressed RGBA8 with mips) without the transcoder', async () => {
    const s = fakeGPU([]);
    const levels = [{ data: new Uint8Array(4 * 4 * 4).fill(10) }, { data: new Uint8Array(2 * 2 * 4).fill(20) }, { data: new Uint8Array(4).fill(30) }];
    const made = await createKTX2Texture(s.gpu, 'raw', writeKTX2({ vkFormat: 43, width: 4, height: 4, levels, zlib: true, srgb: true }), true);
    expect(made).toMatchObject({ format: 'rgba8unorm-srgb', levels: 3, source: 'direct' });
    expect(s.writes.map((w) => [w.level, w.bytes, w.bytesPerRow, w.size.join('x')])).toEqual([[0, 64, 16, '4x4'], [1, 16, 8, '2x2'], [2, 4, 4, '1x1']]);
  });

  it('uploads BC7 data directly and insists on the device feature and block-aligned sizes', async () => {
    const blocks = (w: number, h: number) => ({ data: new Uint8Array(Math.ceil(w / 4) * Math.ceil(h / 4) * 16) });
    const file = writeKTX2({ vkFormat: 145, width: 8, height: 8, levels: [blocks(8, 8), blocks(4, 4), blocks(2, 2), blocks(1, 1)], srgb: false });
    const ok = fakeGPU(['texture-compression-bc']);
    expect(await createKTX2Texture(ok.gpu, 'bc7', file, false)).toMatchObject({ format: 'bc7-rgba-unorm', levels: 4 });
    expect(ok.writes[2]).toMatchObject({ bytes: 16, bytesPerRow: 16, size: [4, 4] });
    await expect(createKTX2Texture(fakeGPU([]).gpu, 'bc7', file, false)).rejects.toThrow(/texture-compression-bc/);
    const odd = writeKTX2({ vkFormat: 145, width: 6, height: 8, levels: [blocks(6, 8)] });
    await expect(createKTX2Texture(ok.gpu, 'odd', odd, false)).rejects.toThrow(/multiple of 4x4/);
  });

  it('destroys the texture when a level is truncated and rejects unsupported layouts', async () => {
    const s = fakeGPU([]);
    const short = writeKTX2({ vkFormat: 37, width: 4, height: 4, levels: [{ data: new Uint8Array(10) }] });
    await expect(createKTX2Texture(s.gpu, 'short', short, false)).rejects.toThrow(/expected 64/);
    expect((s.raw.resources.textures.destroy as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    await expect(createKTX2Texture(s.gpu, 'fmt', writeKTX2({ vkFormat: 1, width: 4, height: 4, levels: [{ data: new Uint8Array(16) }] }), false)).rejects.toThrow(/not supported/);
  });
});

describe('TextureLoader with KTX2 images', () => {
  it('routes KTX2 data to the transcoder, by MIME type or by magic bytes, and shares one upload', async () => {
    const s = fakeGPU(['texture-compression-astc']);
    const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
    const loader = new TextureLoader(s.gpu);
    const image = { name: 'ktx', mimeType: 'image/ktx2', data: fixture('pattern-uastc.ktx2') };
    const a = loader.load('k', image, true);
    expect(loader.load('k', image, true)).toBe(a);
    await expect(a).resolves.toHaveProperty('view');
    await loader.load('sniffed', { name: 'x', mimeType: 'image/png', data: fixture('pattern-etc1s.ktx2') }, false);
    expect(loader.uploads).toBe(2);
    expect(decode).not.toHaveBeenCalled();         // createImageBitmap is only for PNG / JPEG / WebP
  });
});

describe('compressed texture memory estimates', () => {
  it('counts whole blocks per level', () => {
    expect(blockFormat('astc-4x4-unorm')).toMatchObject({ bytes: 16, width: 4 });
    expect(blockLevelBytes(blockFormat('bc1-rgba-unorm')!, 5, 5)).toBe(4 * 8);
    // 64 x 32 BC7: 1024 + 256 + 64 + 16 + 16 + 16 + 16 (levels below 4x4 still occupy one block)
    expect(estimateTextureBytes(64, 32, 1, 'bc7-rgba-unorm', 7)).toBe(2048 + 512 + 128 + 32 + 16 + 16 + 16);
    expect(estimateTextureBytes(64, 64, 1, 'rgba8unorm', 1)).toBe(64 * 64 * 4);
  });
});

describe('KHR_texture_basisu in glTF', () => {
  /** A triangle whose base colour texture has a PNG fallback source and a KTX2 image under KHR_texture_basisu (or only the KTX2 image). */
  function model(withFallback: boolean) {
    const b = new GLBBuilder();
    const png = b.view(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), ktx = b.view(fixture('pattern-uastc.ktx2'));
    b.json.images = [{ bufferView: png, mimeType: 'image/png' }, { bufferView: ktx, mimeType: 'image/ktx2' }];
    b.json.textures = [{ ...(withFallback ? { source: 0 } : {}), extensions: { KHR_texture_basisu: { source: 1 } } }];
    b.json.extensionsUsed = ['KHR_texture_basisu']; b.json.extensionsRequired = withFallback ? [] : ['KHR_texture_basisu'];
    const material = b.material({ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } });
    b.addToScene(b.node({ mesh: b.mesh({ primitives: [{ ...addTriangle(b), material }] }) }));
    return b.glb();
  }
  it('uses the KTX2 image instead of the fallback source', async () => {
    const asset = await loadGLTF(model(true));
    expect(asset.textures).toHaveLength(1);
    expect(asset.textures[0]).toMatchObject({ image: 1, srgb: true });
    expect(asset.images[1].mimeType).toBe('image/ktx2');
    expect(asset.images[1].data).toEqual(fixture('pattern-uastc.ktx2'));
    expect(asset.warnings).toEqual([]);
  });
  it('accepts a document whose only image is KTX2 and lists the extension as required', async () => {
    const asset = await loadGLTF(model(false));
    expect(asset.textures[0].image).toBe(1);
  });
});
