import { bytesPerTexel } from '../../gpu/TextureManager';
import { deviceHost, runOnce } from './OneShot';

/**
 * Read GPU data back to the CPU (tests, debugging and tools; it waits for the GPU, so never in the frame loop). The copy into the mappable staging buffer is a copy node of a
 * one-shot technique.
 */

/** Read `size` bytes of `source` starting at byte `offset` (the source needs COPY_SRC usage). */
export async function readBuffer(device: GPUDevice, source: GPUBuffer, size: number, offset = 0): Promise<ArrayBuffer> {
  const bytes = Math.max(4, Math.ceil(size / 4) * 4);
  const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  runOnce(deviceHost(device), 'readback-buffer', (g) => {
    g.copy('copy', g.importedBuffer('source', 'u32'), g.importedBuffer('staging', 'u32'), { from: { offset }, size: [bytes] });
  }, { source, staging });
  await staging.mapAsync(GPUMapMode.READ);
  const copy = staging.getMappedRange().slice(0);
  staging.unmap(); staging.destroy();
  return copy;
}

/** Read one mip level of a 2D texture of a known-size colour format (`width` x `height` texels of that mip, array layer `layer`) as tightly packed rows. */
export async function readTexture(device: GPUDevice, texture: GPUTexture, mip: number, width: number, height: number, layer = 0): Promise<Uint8Array> {
  const texel = bytesPerTexel(texture.format);
  if (texel === undefined) throw new Error(`readTexture: the texel size of ${texture.format} is not known`);
  const bytesPerRow = Math.ceil((width * texel) / 256) * 256;
  const staging = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  runOnce(deviceHost(device), 'readback-texture', (g) => {
    const source = g.texture('source', {
      format: texture.format, size: [texture.width, texture.height, texture.depthOrArrayLayers], mips: texture.mipLevelCount,
      ...(texture.depthOrArrayLayers > 1 ? { dimension: texture.dimension === '3d' ? '3d' as const : '2d-array' as const } : {}), visibility: 'imported',
    });
    g.copy('copy', source, g.importedBuffer('staging', 'u32'), { from: { mip, origin: [0, 0, layer] }, to: { bytesPerRow }, size: [width, height, 1] });
  }, { source: texture, staging });
  await staging.mapAsync(GPUMapMode.READ);
  const rows = new Uint8Array(staging.getMappedRange());
  const out = new Uint8Array(width * height * texel);
  for (let y = 0; y < height; y++) out.set(rows.subarray(y * bytesPerRow, y * bytesPerRow + width * texel), y * width * texel);
  staging.unmap(); staging.destroy();
  return out;
}
