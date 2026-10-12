import { readTexture } from '../rendering/graph/Readback';

export { readBuffer } from '../rendering/graph/Readback';

/** Read one mip level of a 2D RGBA8 texture as tightly packed bytes (a copy node of a one-shot technique does the copy). */
export function readTextureRGBA8(device: GPUDevice, tex: GPUTexture, mip: number, w: number, h: number): Promise<Uint8Array> {
  return readTexture(device, tex, mip, w, h);
}

export interface SelfTest { name: string; run: () => Promise<string | void>; }

export class Rng {
  /** Seed the generator (a fixed seed makes tests reproducible). */
  constructor(private s = 1) {}
  /** Next pseudo-random number in [0, 1) (linear congruential generator). */
  next(): number { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s / 4294967296; }
  /** Random number in [a, b). */
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  /** Random unit vector (rejection sampling inside the unit ball). */
  unit3(): number[] {
    for (;;) {
      const v = [this.range(-1, 1), this.range(-1, 1), this.range(-1, 1)];
      const l = Math.hypot(v[0], v[1], v[2]);
      if (l > 0.1 && l <= 1) return [v[0] / l, v[1] / l, v[2] / l];
    }
  }
}
