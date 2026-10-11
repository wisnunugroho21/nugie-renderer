/** Minimal KTX 2.0 writer for tests: one 2D image, raw (non-Basis) data, optional zlib supercompression. */
import { deflateSync } from 'node:zlib';

export interface RawLevel { data: Uint8Array; }

const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/** Serialize `levels` (largest first) as a KTX2 file with Vulkan format `vkFormat`. */
export function writeKTX2(opts: { vkFormat: number; width: number; height: number; levels: RawLevel[]; zlib?: boolean; srgb?: boolean; typeSize?: number }): Uint8Array {
  const count = opts.levels.length;
  const stored = opts.levels.map((l) => (opts.zlib ? new Uint8Array(deflateSync(l.data)) : l.data));
  const dfdOffset = 80 + count * 24, dfdLength = 44;
  const dataStart = dfdOffset + dfdLength;
  // level data is stored smallest first, each 8-byte aligned; the index lists largest first
  const offsets = new Array<number>(count);
  let cursor = (dataStart + 7) & ~7;
  for (let i = count - 1; i >= 0; i--) { offsets[i] = cursor; cursor = (cursor + stored[i].byteLength + 7) & ~7; }
  const out = new Uint8Array(cursor), dv = new DataView(out.buffer);
  out.set(IDENTIFIER, 0);
  const header = [opts.vkFormat, opts.typeSize ?? 1, opts.width, opts.height, 0, 0, 1, count, opts.zlib ? 3 : 0, dfdOffset, dfdLength, 0, 0];
  header.forEach((v, i) => dv.setUint32(12 + i * 4, v, true));
  dv.setBigUint64(64, 0n, true); dv.setBigUint64(72, 0n, true);
  stored.forEach((bytes, i) => {
    const o = 80 + i * 24;
    dv.setBigUint64(o, BigInt(offsets[i]), true); dv.setBigUint64(o + 8, BigInt(bytes.byteLength), true); dv.setBigUint64(o + 16, BigInt(opts.levels[i].data.byteLength), true);
    out.set(bytes, offsets[i]);
  });
  dv.setUint32(dfdOffset, dfdLength, true);
  out[dfdOffset + 12] = 1;                       // colour model: RGBSDA
  out[dfdOffset + 14] = opts.srgb ? 2 : 1;       // transfer function: sRGB / linear
  return out;
}
