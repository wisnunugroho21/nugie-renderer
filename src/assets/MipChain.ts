/** One level of a tightly packed RGBA8 image. */
export interface MipImage { width: number; height: number; data: Uint8Array; }

const linear = (byte: number): number => {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const srgbByte = (value: number): number => Math.round(255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055));
const LINEAR_LUT = Float32Array.from({ length: 256 }, (_, i) => linear(i));

/** Full RGBA8 mip chain with a 2x2 box filter. sRGB colour is averaged in linear light;
 * alpha and data are averaged directly. The base level references the input bytes.
 */
export function buildMipChain(rgba: Uint8Array, width: number, height: number, srgb: boolean): MipImage[] {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new RangeError('Mip dimensions must be positive integers');
  }
  if (rgba.byteLength !== width * height * 4) throw new RangeError('Mip data must contain width * height * 4 bytes');
  const chain: MipImage[] = [{ width, height, data: rgba }];
  let current = chain[0];
  while (current.width > 1 || current.height > 1) {
    const w = Math.max(1, current.width >> 1), h = Math.max(1, current.height >> 1);
    const out = new Uint8Array(w * h * 4), data = current.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const x0 = x * 2, x1 = Math.min(x0 + 1, current.width - 1);
      const y0 = y * 2, y1 = Math.min(y0 + 1, current.height - 1);
      const a = (y0 * current.width + x0) * 4, b = (y0 * current.width + x1) * 4;
      const c = (y1 * current.width + x0) * 4, d = (y1 * current.width + x1) * 4;
      const offset = (y * w + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const v0 = data[a + channel], v1 = data[b + channel], v2 = data[c + channel], v3 = data[d + channel];
        out[offset + channel] = srgb && channel < 3
          ? srgbByte((LINEAR_LUT[v0] + LINEAR_LUT[v1] + LINEAR_LUT[v2] + LINEAR_LUT[v3]) / 4)
          : Math.round((v0 + v1 + v2 + v3) / 4);
      }
    }
    current = { width: w, height: h, data: out };
    chain.push(current);
  }
  return chain;
}
