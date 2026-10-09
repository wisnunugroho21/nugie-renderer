import type { GPUContext } from '../../gpu/GPUContext';
import { MipmapGenerator } from '../../gpu/MipmapGenerator';
import type { SceneResources } from '../lighting/SceneResources';
import { HDR_FORMAT } from './PostProcessor';

/**
 * The opaque-scene copy that transmissive materials refract: an HDR texture the size of the scene target with a full mip chain
 * (rougher refraction samples blurrier mips), bound into the scene bind group. Created on demand and resized with the canvas.
 */
export class TransmissionCopy {
  private texture: GPUTexture | null = null;
  private mips: MipmapGenerator;

  constructor(private gpu: GPUContext, private scene: SceneResources) {
    this.mips = new MipmapGenerator(gpu.device, gpu.resources);
  }

  /** Index of the last mip level (the value the shaders get as "mip count"), or 0 while no texture exists. */
  get maxMip(): number { return this.texture ? this.texture.mipLevelCount - 1 : 0; }

  /** (Re)create the texture at `width` x `height` and hand it to the scene bind group. A no-op when it already has that size. */
  ensure(width: number, height: number): void {
    if (this.texture && this.texture.width === width && this.texture.height === height) return;
    const { textures } = this.gpu.resources;
    if (this.texture) textures.destroy(this.texture);
    this.texture = textures.create({
      label: 'transmission-copy', size: [width, height], format: HDR_FORMAT, mipLevelCount: Math.floor(Math.log2(Math.max(width, height))) + 1,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.scene.setTransmission(this.texture.createView());
  }

  /** Copy the finished opaque scene `source` into the texture and build its mip chain. `ensure` must have run. */
  copyFrom(enc: GPUCommandEncoder, source: GPUTexture): void {
    const t = this.texture!;
    enc.copyTextureToTexture({ texture: source }, { texture: t }, [t.width, t.height]);
    this.mips.generateInto(enc, t, HDR_FORMAT, t.mipLevelCount);
  }
}
