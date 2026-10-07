/** Read `size` bytes of a GPU buffer back to the CPU (test/debug only - never in the frame loop). */
export async function readBuffer(device: GPUDevice, src: GPUBuffer, size: number, offset = 0): Promise<ArrayBuffer> {
  const rb = device.createBuffer({ size: Math.ceil(size / 4) * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(src, offset, rb, 0, rb.size);
  device.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const copy = rb.getMappedRange().slice(0);
  rb.unmap(); rb.destroy();
  return copy;
}

/** Read one mip level of a 2D RGBA8 texture as tightly packed bytes. */
export async function readTextureRGBA8(device: GPUDevice, tex: GPUTexture, mip: number, w: number, h: number): Promise<Uint8Array> {
  const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
  const rb = device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex, mipLevel: mip }, { buffer: rb, bytesPerRow }, [w, h]);
  device.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(rb.getMappedRange());
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(src.subarray(y * bytesPerRow, y * bytesPerRow + w * 4), y * w * 4);
  rb.unmap(); rb.destroy();
  return out;
}

export interface SelfTest { name: string; run: () => Promise<string | void>; }

export class Rng {
  constructor(private s = 1) {}
  next(): number { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s / 4294967296; }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  unit3(): number[] {
    for (;;) {
      const v = [this.range(-1, 1), this.range(-1, 1), this.range(-1, 1)];
      const l = Math.hypot(v[0], v[1], v[2]);
      if (l > 0.1 && l <= 1) return [v[0] / l, v[1] / l, v[2] / l];
    }
  }
}
