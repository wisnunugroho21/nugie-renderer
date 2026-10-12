import type { GPUContext } from '../../gpu/GPUContext';
import mipmapShader from '../../shaders/mipmap.wgsl?raw';
import type { SceneResources } from '../lighting/SceneResources';
import { technique } from '../graph/TechniqueBuilder';
import type { TechniqueInstance } from '../graph/TechniqueInstance';
import { HDR_FORMAT } from './PostChain';

/** The box-filter blit of `mipmap.wgsl` without its bindings: the technique generates `src` (one mip level) and `src_sampler`. */
const MIP_BLIT = mipmapShader.replace(/^@group\(0\) @binding\(\d\)[^\n]*\n/gm, '').replace(/\bsamp\b/g, 'src_sampler');

/**
 * The opaque-scene copy that transmissive materials refract: an HDR texture the size of the scene target with a full mip chain
 * (rougher refraction samples blurrier mips), bound into the scene bind group. Created on demand and resized with the canvas.
 *
 * The copy and the mip chain are a technique (see TECHNIQUES.md): a copy node, then one draw node per mip that samples level i-1
 * of the exported texture into level i.
 */
export class TransmissionCopy {
  private texture: GPUTexture | null = null;
  private fx: TechniqueInstance | null = null;

  constructor(private gpu: GPUContext, private scene: SceneResources) {}

  /** Index of the last mip level (the value the shaders get as "mip count"), or 0 while no texture exists. */
  get maxMip(): number { return this.texture ? this.texture.mipLevelCount - 1 : 0; }

  /** (Re)create the texture at `width` x `height` and hand it to the scene bind group. A no-op when it already has that size. */
  ensure(width: number, height: number): void {
    if (this.texture && this.texture.width === width && this.texture.height === height) return;
    this.fx?.dispose();
    const g = technique('transmission');
    const scene = g.texture('scene', { format: HDR_FORMAT, size: [width, height], visibility: 'imported' });
    const copy = g.texture('transmission', { format: HDR_FORMAT, size: [width, height], mips: 'full', visibility: 'exported' });
    g.copy('copy-scene', scene, copy);
    const mips = Math.floor(Math.log2(Math.max(width, height))) + 1;
    for (let m = 1; m < mips; m++) {
      g.draw(`mip-${m}`, {
        shader: MIP_BLIT, vertexEntry: 'vs_main', fragmentEntry: 'fs_main', vertices: 3,
        reads: [{ resource: copy, name: 'src', sampler: 'linear', mip: m - 1, mipCount: 1 }], colorTargets: [{ resource: copy, mip: m }],
      });
    }
    this.fx = g.instantiate(this.gpu, { label: 'transmission' });
    this.texture = this.fx.resource('transmission') as GPUTexture;
    this.scene.setTransmission(this.texture.createView());
  }

  /** Copy the finished opaque scene `source` into the texture and build its mip chain. `ensure` must have run. */
  copyFrom(enc: GPUCommandEncoder, source: GPUTexture): void {
    this.fx!.setImport('scene', source);
    this.fx!.execute(enc);
  }
}
