import type { GPUContext } from '../../gpu/GPUContext';
import { HDR_FORMAT } from './PostProcessor';

export interface FullscreenEffectOptions {
  label: string;
  /**
   * WGSL that defines `fn effect(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32>`: the new scene colour (linear HDR, before tone mapping) for the
   * pixel at `uv` (0..1, y down) whose current colour is `color`. Available to it:
   *   `params`            array<vec4<f32>, 4>  - the effect's uniforms (`FullscreenEffect.params`, 16 floats)
   *   `sceneAt(uv)`       vec4<f32>            - the scene colour anywhere, e.g. for blurs and edge detection
   *   `texelSize()`       vec2<f32>            - the size of one pixel in uv units
   */
  wgsl: string;
}

const PRELUDE = /* wgsl */ `
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var sceneSampler: sampler;
@group(0) @binding(2) var<uniform> params: array<vec4<f32>, 4>;

struct VOut { @builtin(position) clip: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VOut {
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VOut;
  o.clip = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2<f32>(p.x, 1.0 - p.y);
  return o;
}

fn sceneAt(uv: vec2<f32>) -> vec4<f32> { return textureSampleLevel(scene, sceneSampler, uv, 0.0); }
fn texelSize() -> vec2<f32> { return 1.0 / vec2<f32>(textureDimensions(scene)); }

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  return effect(in.uv, sceneAt(in.uv));
}
`;

/**
 * A full-screen effect applied to the HDR scene colour in place - the easy way to add a post-processing step from a
 * {@link RenderFeature}. It renders the scene texture through your `effect` function into a scratch texture and copies the result
 * back, so the effect can sample neighbouring pixels. Call `run` from a pass declared in `addPostPasses`:
 *
 *   addPostPasses(g, f) { g.addPass({ name: 'grade', reads: ['sceneColor'], writes: ['sceneColor'], execute: (e) => fx.run(e, f.sceneTexture) }); }
 */
export class FullscreenEffect {
  /** The effect's uniforms (16 floats = 4 vec4), uploaded on every `run`. */
  readonly params = new Float32Array(16);
  private uniform: GPUBuffer;
  private layout: GPUBindGroupLayout;
  private pipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private scratch: GPUTexture | null = null;
  private scratchView: GPUTextureView | null = null;
  private groups = new WeakMap<GPUTexture, GPUBindGroup>();

  constructor(private gpu: GPUContext, o: FullscreenEffectOptions) {
    const { device, resources } = gpu;
    this.uniform = resources.buffers.create(`${o.label}:params`, 64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.sampler = resources.samplers.get({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ] });
    const module = resources.shaders.get(`fx:${o.label}`, PRELUDE + o.wgsl);
    this.pipeline = device.createRenderPipeline({
      label: o.label, layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  /** Apply the effect to `sceneTexture` (the HDR scene colour, `PostFeatureFrame.sceneTexture`). Records two commands into `enc`. */
  run(enc: GPUCommandEncoder, sceneTexture: GPUTexture): void {
    const { device, resources } = this.gpu;
    const { width, height } = sceneTexture;
    if (!this.scratch || this.scratch.width !== width || this.scratch.height !== height) {
      if (this.scratch) resources.textures.destroy(this.scratch);
      this.scratch = resources.textures.create({ label: 'fx-scratch', size: [width, height], format: HDR_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      this.scratchView = this.scratch.createView();
    }
    let group = this.groups.get(sceneTexture);
    if (!group) {
      group = device.createBindGroup({ layout: this.layout, entries: [
        { binding: 0, resource: sceneTexture.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: this.uniform } }] });
      this.groups.set(sceneTexture, group);
    }
    this.gpu.queue.writeBuffer(this.uniform, 0, this.params);
    const pass = enc.beginRenderPass({ label: 'fx', colorAttachments: [{ view: this.scratchView!, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end();
    enc.copyTextureToTexture({ texture: this.scratch }, { texture: sceneTexture }, [width, height]);
  }
}
