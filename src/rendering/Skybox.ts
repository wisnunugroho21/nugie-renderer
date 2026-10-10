import type { GPUContext } from '../gpu/GPUContext';
import type { BindLayouts } from '../gpu/BindLayouts';
import type { PassTarget } from './materials/MaterialManager';
import type { SceneResources } from './lighting/SceneResources';
import type { FeatureFrame, RenderFeature } from './RenderFeature';
import skyboxSource from '../shaders/skybox.wgsl?raw';

/**
 * Draws the bound environment cube map as a full-screen background behind the geometry (one triangle, depth-tested, no depth writes).
 * As a feature it paints in the `drawBackdrop` slot: after the opaque geometry, before blended surfaces (which write no depth and would
 * otherwise be painted over).
 */
export class Skybox implements RenderFeature {
  readonly name = 'skybox';
  /** Draw the background when an environment is bound. */
  visible = true;
  /** One pipeline per (colour format, sample count) of the target it draws into. */
  private pipelines = new Map<string, GPURenderPipeline>();

  constructor(private gpu: GPUContext, private layouts: BindLayouts, private defaultDepthFormat: GPUTextureFormat, private scene: SceneResources) {}

  drawBackdrop(pass: GPURenderPassEncoder, f: FeatureFrame): void {
    if (this.visible && this.scene.env.enabled) this.draw(pass, f.target, f.frameBindGroup, f.sceneBindGroup);
  }

  /** Forget the cached pipelines (the framebuffer configuration changed). */
  retarget(): void { this.pipelines.clear(); }

  /** Record the sky draw into `pass`, which renders into `target`. */
  draw(pass: GPURenderPassEncoder, target: PassTarget, frame: GPUBindGroup, scene: GPUBindGroup): void {
    pass.setPipeline(this.pipelineFor(target));
    pass.setBindGroup(0, frame); pass.setBindGroup(1, scene);
    pass.draw(3);
  }

  /** The (lazily created) pipeline for `target`. */
  private pipelineFor(target: PassTarget): GPURenderPipeline {
    const key = `${target.colorFormat}|${target.sampleCount}`;
    let pipe = this.pipelines.get(key);
    if (pipe) return pipe;
    const { device } = this.gpu;
    const module = this.gpu.resources.shaders.get('skybox', skyboxSource, { HAS_SKINNING: false, HAS_MORPH_TARGETS: false });
    pipe = device.createRenderPipeline({
      label: 'skybox', layout: device.createPipelineLayout({ bindGroupLayouts: [this.layouts.frame, this.layouts.scene] }),
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format: target.colorFormat ?? this.gpu.format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: target.depthFormat ?? this.defaultDepthFormat, depthWriteEnabled: false, depthCompare: 'less-equal' },
      multisample: { count: target.sampleCount },
    });
    this.pipelines.set(key, pipe);
    return pipe;
  }
}
