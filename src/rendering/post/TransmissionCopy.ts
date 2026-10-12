import type { GPUContext } from '../../gpu/GPUContext';
import mipmapShader from '../../shaders/mipmap.wgsl?raw';
import type { SceneResources } from '../lighting/SceneResources';
import { technique } from '../graph/TechniqueBuilder';
import { TechniqueInstance } from '../graph/TechniqueInstance';
import type { FrameBuilder } from '../graph/FrameGraph';
import type { Technique } from '../graph/TechniqueTypes';
import { HDR_FORMAT } from './PostChain';

/** The box-filter blit of `mipmap.wgsl` without its bindings: the technique generates `src` (one mip level) and `src_sampler`. */
const MIP_BLIT = mipmapShader.replace(/^@group\(0\) @binding\(\d\)[^\n]*\n/gm, '').replace(/\bsamp\b/g, 'src_sampler');

/**
 * The opaque-scene copy that transmissive materials refract: an HDR texture the size of the scene target with a full mip chain
 * (rougher refraction samples blurrier mips), bound into the scene bind group. Created on demand and resized with the canvas.
 *
 * The copy and the mip chain are a technique (see TECHNIQUES.md): a copy node, then one draw node per mip that samples level i-1
 * of the texture into level i. The texture is created here and imported by the technique; in a frame the nodes are part of the frame's graph (`addToFrame`),
 * `copyFrom` runs the same technique on its own.
 */
export class TransmissionCopy {
  private texture: GPUTexture | null = null;
  private fx: TechniqueInstance | null = null;
  private tech: Technique | null = null;

  constructor(private gpu: GPUContext, private scene: SceneResources) {}

  /** Free the texture and its passes. */
  dispose(): void {
    this.fx?.dispose(); this.fx = null; this.tech = null;
    if (this.texture) this.gpu.resources.textures.destroy(this.texture);
    this.texture = null; this.scene.setTransmission(null);
  }

  /** Index of the last mip level (the value the shaders get as "mip count"), or 0 while no texture exists. */
  get maxMip(): number { return this.texture ? this.texture.mipLevelCount - 1 : 0; }

  /** (Re)create the texture at `width` x `height` and hand it to the scene bind group. A no-op when it already has that size. */
  ensure(width: number, height: number): void {
    if (this.texture && this.texture.width === width && this.texture.height === height) return;
    this.fx?.dispose();
    if (this.texture) this.gpu.resources.textures.destroy(this.texture);
    const g = technique('transmission');
    const scene = g.texture('scene', { format: HDR_FORMAT, size: [width, height], visibility: 'imported' });
    const copy = g.texture('transmission', { format: HDR_FORMAT, size: [width, height], mips: 'full', visibility: 'imported' });
    g.copy('copy-scene', scene, copy);
    const mips = Math.floor(Math.log2(Math.max(width, height))) + 1;
    for (let m = 1; m < mips; m++) {
      g.draw(`mip-${m}`, {
        shader: MIP_BLIT, vertexEntry: 'vs_main', fragmentEntry: 'fs_main', vertices: 3,
        reads: [{ resource: copy, name: 'src', sampler: 'linear', mip: m - 1, mipCount: 1 }], colorTargets: [{ resource: copy, mip: m }],
      });
    }
    this.tech = g.build();
    this.texture = this.gpu.resources.textures.create({
      label: 'transmission', size: [width, height], format: HDR_FORMAT, mipLevelCount: mips,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    this.fx = TechniqueInstance.create(this.gpu, this.tech, { label: 'transmission', imports: { transmission: this.texture } });
    this.scene.setTransmission(this.texture.createView());
  }

  /** Add the copy of the finished opaque scene `source` and the mip chain to the frame (the frame's `transmissionTex`). `ensure` must have run. */
  addToFrame(g: FrameBuilder, source: GPUTexture): void {
    g.include('transmission', this.tech!, { imports: { scene: { as: 'sceneColor', resource: source }, transmission: { as: 'transmissionTex', resource: this.texture! } } });
  }

  /** Copy the finished opaque scene `source` into the texture and build its mip chain. `ensure` must have run. */
  copyFrom(enc: GPUCommandEncoder, source: GPUTexture): void {
    this.fx!.setImport('scene', source);
    this.fx!.execute(enc);
  }
}
