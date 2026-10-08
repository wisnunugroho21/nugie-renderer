/** Radiance .hdr (RGBE) decoding / encoding, plus float32 -> float16 packing for GPU upload. */

export interface HDRImage { width: number; height: number; /** RGB float32, top row first. */ data: Float32Array; }

/** Decode a Radiance .hdr file (RGBE, flat or new-style RLE) into float RGB pixels; throws on a malformed header, truncated data or an unsupported orientation. */
export function parseRGBE(buffer: ArrayBuffer): HDRImage {
  const b = new Uint8Array(buffer);
  let p = 0;
  /** Read bytes up to the next newline as a string (used for the header lines). */
  const readLine = (): string => {
    let s = '';
    while (p < b.length && b[p] !== 10) s += String.fromCharCode(b[p++]);
    p++;
    return s;
  };
  const magic = readLine();
  if (!magic.startsWith('#?')) throw new Error('RGBE: missing #? header');
  for (;;) {
    if (p >= b.length) throw new Error('RGBE: truncated header');
    if (readLine().trim() === '') break;
  }
  const res = /^([-+])Y\s+(\d+)\s+([-+])X\s+(\d+)$/.exec(readLine().trim());
  if (!res) throw new Error('RGBE: unsupported resolution line');
  const height = Number(res[2]), width = Number(res[4]), flipY = res[1] === '+', flipX = res[3] === '-';
  const rgbe = new Uint8Array(width * height * 4);
  const scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (p + 4 > b.length) throw new Error('RGBE: truncated data');
    const rle = width >= 8 && width < 32768 && b[p] === 2 && b[p + 1] === 2 && (b[p + 2] & 0x80) === 0;
    if (rle) {
      if (((b[p + 2] << 8) | b[p + 3]) !== width) throw new Error('RGBE: scanline width mismatch');
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          if (p >= b.length) throw new Error('RGBE: truncated scanline');
          let n = b[p++];
          if (n > 128) { n -= 128; const v = b[p++]; if (x + n > width) throw new Error('RGBE: bad run'); while (n-- > 0) scan[(x++) * 4 + c] = v; }
          else { if (n === 0 || x + n > width) throw new Error('RGBE: bad run'); while (n-- > 0) scan[(x++) * 4 + c] = b[p++]; }
        }
      }
    } else {
      if (p + width * 4 > b.length) throw new Error('RGBE: truncated flat scanline');
      scan.set(b.subarray(p, p + width * 4)); p += width * 4;
    }
    rgbe.set(scan, (flipY ? height - 1 - y : y) * width * 4);
  }
  const data = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + (flipX ? width - 1 - x : x)) * 4, o = (y * width + x) * 3, e = rgbe[s + 3];
      if (e === 0) continue;
      const f = Math.pow(2, e - 136);
      data[o] = rgbe[s] * f; data[o + 1] = rgbe[s + 1] * f; data[o + 2] = rgbe[s + 2] * f;
    }
  }
  return { width, height, data };
}

/** Encode to RGBE (flat scanlines, or new-style RLE when `rle`). Used by tests and tools. */
export function encodeRGBE(img: HDRImage, rle = false): ArrayBuffer {
  const head = new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${img.height} +X ${img.width}\n`);
  /** Encode pixel `i` as shared-exponent RGBE bytes. */
  const px = (i: number): [number, number, number, number] => {
    const r = img.data[i * 3], g = img.data[i * 3 + 1], bl = img.data[i * 3 + 2], m = Math.max(r, g, bl);
    if (m < 1e-32) return [0, 0, 0, 0];
    const e = Math.ceil(Math.log2(m + m * 1e-9) + 1e-9), f = 256 / Math.pow(2, e);
    return [Math.min(255, Math.floor(r * f)), Math.min(255, Math.floor(g * f)), Math.min(255, Math.floor(bl * f)), e + 128];
  };
  const out: number[] = Array.from(head);
  for (let y = 0; y < img.height; y++) {
    const row = Array.from({ length: img.width }, (_, x) => px(y * img.width + x));
    if (!rle) { for (const q of row) out.push(...q); continue; }
    out.push(2, 2, img.width >> 8, img.width & 255);
    for (let c = 0; c < 4; c++) {
      let x = 0;
      while (x < img.width) {
        let run = 1;
        while (x + run < img.width && run < 127 && row[x + run][c] === row[x][c]) run++;
        if (run >= 3) { out.push(128 + run, row[x][c]); x += run; }
        else { const n = Math.min(img.width - x, 4); out.push(n); for (let k = 0; k < n; k++) out.push(row[x + k][c]); x += n; }
      }
    }
  }
  return new Uint8Array(out).buffer;
}

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
/** float32 -> IEEE half bits (round to nearest, saturating to the largest finite half). */
export function floatToHalf(v: number): number {
  f32[0] = v;
  const x = u32[0], sign = (x >>> 16) & 0x8000, e = (x >>> 23) & 0xff, m = x & 0x7fffff;
  if (e === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0);
  let he = e - 127 + 15;
  if (he >= 31) return sign | 0x7bff;
  if (he <= 0) {
    if (he < -10) return sign;
    const mm = (m | 0x800000) >> (1 - he), r = mm + 0x1000;
    return sign | (r >> 13);
  }
  const r = (he << 10 | m >> 13) + ((m & 0x1000) ? 1 : 0);
  return sign | Math.min(r, 0x7bff);
}

/** Expand RGB float32 into RGBA float16 bits (alpha = 1) ready for an rgba16float texture. */
export function rgbToRGBA16F(rgb: Float32Array): Uint16Array {
  const n = rgb.length / 3, out = new Uint16Array(n * 4), one = floatToHalf(1);
  for (let i = 0; i < n; i++) { out[i * 4] = floatToHalf(rgb[i * 3]); out[i * 4 + 1] = floatToHalf(rgb[i * 3 + 1]); out[i * 4 + 2] = floatToHalf(rgb[i * 3 + 2]); out[i * 4 + 3] = one; }
  return out;
}

/** Convert an IEEE 754 half-precision bit pattern (as stored in rgba16float textures) to a JS number. */
export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  if (e === 0) return s * m * Math.pow(2, -24);
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * Math.pow(2, e - 15);
}
