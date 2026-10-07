import type { GPUResources } from './GPUResources';
import mipmapShader from '../shaders/mipmap.wgsl?raw';

/**
 * Generates mip chains on the GPU with a box filter (bilinear downsample).
 * sRGB formats are filtered in LINEAR space: sampling decodes sRGB, the render target re-encodes.
 */
export class MipmapGenerator {
  constructor(private device: GPUDevice, private res: GPUResources) {}

  /** Texture needs TEXTURE_BINDING | RENDER_ATTACHMENT usage and `mipLevelCount` levels. */
  generate(texture: GPUTexture, format: GPUTextureFormat, mipLevelCount: number, layers = 1): void {
    if (mipLevelCount <= 1) return;
    const { device, res } = this;
    const pipeline = res.pipelines.getRender({
      shader: 'mipmap', vertexLayout: [], topology: 'triangle-list', cullMode: 'none', depth: null,
      targets: [{ format }], sampleCount: 1, layout: 'auto',
    }, () => {
      const module = res.shaders.get('mipmap', mipmapShader);
      return device.createRenderPipeline({
        label: `mipmap:${format}`, layout: 'auto',
        vertex: { module, entryPoint: 'vs_main' },
        fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
    });
    const sampler = res.samplers.get({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const enc = device.createCommandEncoder({ label: 'mipmap-gen' });
    for (let layer = 0; layer < layers; layer++) {
      for (let level = 1; level < mipLevelCount; level++) {
        const src = texture.createView({ dimension: '2d', baseMipLevel: level - 1, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
        const dst = texture.createView({ dimension: '2d', baseMipLevel: level, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
        const bg = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: src }, { binding: 1, resource: sampler }] });
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: dst, loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bg);
        pass.draw(3);
        pass.end();
      }
    }
    device.queue.submit([enc.finish()]);
  }
}
