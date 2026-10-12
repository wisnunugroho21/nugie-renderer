/** Block-compressed WebGPU texture formats: block size in texels, bytes per block and the device feature that enables them. */
export interface BlockFormat { width: number; height: number; bytes: number; feature: GPUFeatureName; }

const BC: GPUFeatureName = 'texture-compression-bc';
const ETC2: GPUFeatureName = 'texture-compression-etc2';
const ASTC: GPUFeatureName = 'texture-compression-astc';

export const BLOCK_FORMATS: Readonly<Record<string, BlockFormat>> = (() => {
  const t: Record<string, BlockFormat> = {};
  /** Register `name` and, when `srgb`, its `-srgb` twin. */
  const add = (name: string, width: number, height: number, bytes: number, feature: GPUFeatureName, srgb = false) => {
    t[name] = { width, height, bytes, feature };
    if (srgb) t[`${name}-srgb`] = { width, height, bytes, feature };
  };
  add('bc1-rgba-unorm', 4, 4, 8, BC, true); add('bc2-rgba-unorm', 4, 4, 16, BC, true); add('bc3-rgba-unorm', 4, 4, 16, BC, true);
  add('bc4-r-unorm', 4, 4, 8, BC); add('bc4-r-snorm', 4, 4, 8, BC); add('bc5-rg-unorm', 4, 4, 16, BC); add('bc5-rg-snorm', 4, 4, 16, BC);
  add('bc6h-rgb-ufloat', 4, 4, 16, BC); add('bc6h-rgb-float', 4, 4, 16, BC); add('bc7-rgba-unorm', 4, 4, 16, BC, true);
  add('etc2-rgb8unorm', 4, 4, 8, ETC2, true); add('etc2-rgb8a1unorm', 4, 4, 8, ETC2, true); add('etc2-rgba8unorm', 4, 4, 16, ETC2, true);
  add('eac-r11unorm', 4, 4, 8, ETC2); add('eac-r11snorm', 4, 4, 8, ETC2); add('eac-rg11unorm', 4, 4, 16, ETC2); add('eac-rg11snorm', 4, 4, 16, ETC2);
  for (const [w, h] of [[4, 4], [5, 4], [5, 5], [6, 5], [6, 6], [8, 5], [8, 6], [8, 8], [10, 5], [10, 6], [10, 8], [10, 10], [12, 10], [12, 12]]) {
    add(`astc-${w}x${h}-unorm`, w, h, 16, ASTC, true);
  }
  return t;
})();

/** Block layout of a compressed format, or undefined for an ordinary (per-texel) format. */
export function blockFormat(format: GPUTextureFormat): BlockFormat | undefined { return BLOCK_FORMATS[format]; }

/** Bytes of one mip level of a block-compressed texture (partial edge blocks count as whole blocks). */
export function blockLevelBytes(format: BlockFormat, width: number, height: number): number {
  return Math.ceil(width / format.width) * Math.ceil(height / format.height) * format.bytes;
}
