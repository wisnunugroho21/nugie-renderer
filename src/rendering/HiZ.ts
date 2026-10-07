import type { GPUContext } from '../gpu/GPUContext';
import { mipLevelCount } from '../gpu/TextureManager';
import initSrc from '../shaders/hiz_init.wgsl?raw';
import downSrc from '../shaders/hiz_down.wgsl?raw';

/** Hierarchical depth pyramid (r32float, max reduction => conservative for standard-Z occlusion tests). */
export class HiZ {
  texture: GPUTexture | null = null;
  fullView: GPUTextureView | null = null;
  width = 0;
  height = 0;
  mips = 0;
  private initPipe: GPUComputePipeline;
  private downPipe: GPUComputePipeline;
  private mipViews: GPUTextureView[] = [];

  constructor(private gpu: GPUContext) {
    const { device, resources: r } = gpu;
    this.initPipe = device.createComputePipeline({ label: 'hiz-init', layout: 'auto', compute: { module: r.shaders.get('hiz-init', initSrc), entryPoint: 'main' } });
    this.downPipe = device.createComputePipeline({ label: 'hiz-down', layout: 'auto', compute: { module: r.shaders.get('hiz-down', downSrc), entryPoint: 'main' } });
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height && this.texture) return;
    if (this.texture) this.gpu.resources.textures.destroy(this.texture);
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    this.mips = mipLevelCount(this.width, this.height);
    this.texture = this.gpu.resources.textures.create({
      label: 'hiz', size: [this.width, this.height], format: 'r32float', mipLevelCount: this.mips,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this.fullView = this.texture.createView();
    this.mipViews = Array.from({ length: this.mips }, (_, m) => this.texture!.createView({ baseMipLevel: m, mipLevelCount: 1 }));
  }

  /** Append the pyramid build for `depth` (a depth texture view with TEXTURE_BINDING usage, sized like the pyramid). */
  encode(enc: GPUCommandEncoder, depth: GPUTextureView, timestampWrites?: GPUComputePassTimestampWrites): void {
    const { device } = this.gpu;
    const pass = enc.beginComputePass({ label: 'hiz', timestampWrites });
    pass.setPipeline(this.initPipe);
    pass.setBindGroup(0, device.createBindGroup({ layout: this.initPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: depth }, { binding: 1, resource: this.mipViews[0] }] }));
    pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
    pass.setPipeline(this.downPipe);
    for (let m = 1; m < this.mips; m++) {
      const w = Math.max(1, this.width >> m), h = Math.max(1, this.height >> m);
      pass.setBindGroup(0, device.createBindGroup({ layout: this.downPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.mipViews[m - 1] }, { binding: 1, resource: this.mipViews[m] }] }));
      pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    }
    pass.end();
  }
}
