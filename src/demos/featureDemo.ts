import type { Demo } from './Demo';
import type { GPUContext } from '../gpu/GPUContext';
import type { BindLayouts } from '../gpu/BindLayouts';
import type { RenderFeature, FeatureFrame, PostFeatureFrame } from '../rendering/RenderFeature';
import type { RenderGraph } from '../rendering/RenderGraph';
import { FullscreenEffect } from '../rendering/post/FullscreenEffect';
import { entityIndex } from '../ecs/Entity';
import { createPlane, createUVSphere } from '../rendering/primitives';
import { RenderFlags } from '../ecs/components/MeshRendererStore';
import { LightType } from '../ecs/components/LightStore';

/** Animated gradient behind everything: one fullscreen triangle at the far plane. `outputColor` handles HDR / sRGB output like the engine's own shaders. */
const BACKDROP_WGSL = /* wgsl */ `
//#include common_types
//#include common_bind_frame
//#include common_output

@group(1) @binding(0) var<uniform> params: vec4<f32>;   // x = time

struct VOut { @builtin(position) clip: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VOut {
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VOut;
  o.clip = vec4<f32>(p * 2.0 - 1.0, 1.0, 1.0);          // z = 1: the far plane, so only pixels no geometry covered are touched
  o.uv = vec2<f32>(p.x, 1.0 - p.y);
  return o;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let wave = 0.5 + 0.5 * sin(params.x * 0.6 + in.uv.x * 4.0);
  let c = mix(vec3<f32>(0.03, 0.05, 0.12), vec3<f32>(0.40, 0.12, 0.30), in.uv.y * wave);
  return vec4<f32>(outputColor(c), 1.0);
}
`;

/**
 * A complete, minimal {@link RenderFeature} - the template for new rendering features. It needs no change to the renderer:
 *   prepare   uploads this frame's uniform,
 *   drawMain  records the draw into the main pass (after the scene geometry),
 *   retarget  drops the pipeline when the main pass's format / sample count changes (HDR, MSAA).
 * Compute work would go in `addPasses` (declare what the pass reads / writes; list resources the main pass must wait for in `produces`).
 */
class GradientBackdrop implements RenderFeature {
  readonly name = 'gradient-backdrop';
  order = 50;                                       // before particles (100), ribbons (200) and overlays (300)
  private params: GPUBuffer;
  private group: GPUBindGroup;
  private layout: GPUBindGroupLayout;
  private pipeline: GPURenderPipeline | null = null;

  constructor(private gpu: GPUContext, private layouts: BindLayouts) {
    const { device, resources } = gpu;
    this.params = resources.buffers.create('backdrop-params', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    this.group = device.createBindGroup({ layout: this.layout, entries: [{ binding: 0, resource: { buffer: this.params } }] });
  }

  prepare(frame: FeatureFrame): void {
    this.gpu.queue.writeBuffer(this.params, 0, new Float32Array([frame.time, 0, 0, 0]));
  }

  drawMain(pass: GPURenderPassEncoder, frame: FeatureFrame): void {
    this.pipeline ??= this.createPipeline(frame);
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frame.frameBindGroup);
    pass.setBindGroup(1, this.group);
    pass.draw(3);
  }

  retarget(): void { this.pipeline = null; }

  /** Build the pipeline for the main pass's current colour / depth format and sample count. */
  private createPipeline(frame: FeatureFrame): GPURenderPipeline {
    const { device, resources } = this.gpu, t = frame.target;
    const module = resources.shaders.get('backdrop', BACKDROP_WGSL);
    return device.createRenderPipeline({
      label: 'backdrop', layout: device.createPipelineLayout({ bindGroupLayouts: [this.layouts.frame, this.layout] }),
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format: t.colorFormat ?? this.gpu.format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: t.depthFormat, depthWriteEnabled: false, depthCompare: 'less-equal' },
      multisample: { count: t.sampleCount },
    });
  }
}

/**
 * A post-processing {@link RenderFeature}: a warm tint and a vignette on the linear HDR scene colour, before tone mapping. The whole effect is one WGSL
 * function; {@link FullscreenEffect} supplies the pipeline, the scratch texture and the copy back. Needs the HDR chain: `renderer.post.configure({})`.
 */
class WarmVignette implements RenderFeature {
  readonly name = 'warm-vignette';
  private fx: FullscreenEffect;

  constructor(gpu: GPUContext) {
    this.fx = new FullscreenEffect(gpu, { label: 'warm-vignette', wgsl: /* wgsl */ `
      fn effect(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
        let vignette = 1.0 - smoothstep(0.35, 0.9, distance(uv, vec2<f32>(0.5))) * params[0].x;
        let tint = mix(vec3<f32>(1.0), vec3<f32>(1.15, 1.0, 0.8), params[0].y);
        return vec4<f32>(color.rgb * tint * vignette, color.a);
      }` });
    this.fx.params.set([0.8, 0.6]);                   // vignette strength, tint amount
  }

  addPostPasses(g: RenderGraph, frame: PostFeatureFrame): void {
    g.addPass({ name: 'warm-vignette', reads: ['sceneColor'], writes: ['sceneColor'], execute: (enc) => this.fx.run(enc, frame.sceneTexture) });
  }
}

/** `?scene=feature`: a few spheres in front of a backdrop drawn by a custom {@link RenderFeature} (see `GradientBackdrop`), plus a post effect (`WarmVignette`). */
export const featureDemo: Demo = (ctx) => {
  const { world, renderer } = ctx;
  renderer.addFeature(new GradientBackdrop(ctx.gpu, renderer.layouts));
  renderer.addFeature(new WarmVignette(ctx.gpu));
  renderer.post.configure({});                       // the HDR chain: required by post-processing features

  const sphere = renderer.meshes.create('sphere', createUVSphere(48, 24));
  const plane = renderer.meshes.create('plane', createPlane());
  const ground = renderer.materials.createPBR({ name: 'ground', baseColor: [0.25, 0.26, 0.3, 1], roughness: 0.9, metallic: 0 });
  const g = entityIndex(world.create());
  world.transforms.add(g, 0, -0.5, 0); world.transforms.setScale(g, 6, 1, 6);
  world.meshRenderers.add(g, plane, ground, RenderFlags.Static | RenderFlags.ReceiveShadow);
  world.bounds.add(g, -0.5, 0, -0.5, 0.5, 0, 0.5);
  for (let i = 0; i < 3; i++) {
    const e = entityIndex(world.create());
    world.transforms.add(e, (i - 1) * 1.8, 0.2, 0);
    world.meshRenderers.add(e, sphere, renderer.materials.createPBR({ baseColor: [0.9, 0.5 + 0.2 * i, 0.3, 1], roughness: 0.15 + 0.3 * i, metallic: i === 0 ? 1 : 0 }), RenderFlags.CastShadow | RenderFlags.ReceiveShadow);
    world.bounds.add(e, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5);
  }
  const sun = entityIndex(world.create());
  world.transforms.add(sun); world.transforms.setRotation(sun, -0.5, 0.3, 0.1, 0.8);
  world.lights.add(sun, LightType.Directional, 1, 0.95, 0.9, 3);
  world.lights.castShadow[sun] = 1;
  ctx.orbit.distance = 9; ctx.orbit.pitch = 0.25; ctx.orbit.target[1] = 0.3;
};
