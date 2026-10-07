import { describe, it, expect } from 'vitest';
import { parseRGBE, encodeRGBE, floatToHalf, halfToFloat, rgbToRGBA16F } from '../src/assets/RGBE';

function image(w: number, h: number) {
  const data = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { data[i * 3] = (i % w) / w * 40; data[i * 3 + 1] = 0.5 + (i % 7); data[i * 3 + 2] = i < w ? 0 : 0.01; }
  return { width: w, height: h, data };
}

describe('RGBE', () => {
  for (const rle of [false, true]) {
    it(`round-trips (${rle ? 'RLE' : 'flat'} scanlines) within RGBE precision`, () => {
      const img = image(64, 9);
      const back = parseRGBE(encodeRGBE(img, rle));
      expect([back.width, back.height]).toEqual([64, 9]);
      for (let i = 0; i < img.data.length; i += 3) {
        const m = Math.max(img.data[i], img.data[i + 1], img.data[i + 2]);
        for (let c = 0; c < 3; c++) expect(Math.abs(back.data[i + c] - img.data[i + c])).toBeLessThanOrEqual(m / 128 + 1e-6);
      }
    });
  }
  it('handles narrow images (always flat) and rejects junk', () => {
    const img = image(4, 3);
    expect(parseRGBE(encodeRGBE(img, true)).width).toBe(4);
    expect(() => parseRGBE(new TextEncoder().encode('P6\n1 1\n255\n').buffer)).toThrow();
  });
  it('rejects truncated data', () => {
    const buf = encodeRGBE(image(16, 4), true);
    expect(() => parseRGBE(buf.slice(0, buf.byteLength - 20))).toThrow();
  });
});

describe('half float packing', () => {
  it('round-trips representative values', () => {
    for (const v of [0, 1, -1, 0.5, 3.14159, 1000, 65504, 6.1e-5, 0.0001, -250.25]) {
      const r = halfToFloat(floatToHalf(v));
      expect(Math.abs(r - v)).toBeLessThanOrEqual(Math.abs(v) * 1e-3 + 1e-7);
    }
  });
  it('saturates huge values to the max finite half and expands RGB to RGBA', () => {
    expect(halfToFloat(floatToHalf(1e9))).toBe(65504);
    const out = rgbToRGBA16F(new Float32Array([1, 2, 3]));
    expect(Array.from(out).map(halfToFloat)).toEqual([1, 2, 3, 1]);
  });
});
