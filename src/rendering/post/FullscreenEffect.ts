import type { GPUContext } from '../../gpu/GPUContext';
import { technique } from '../graph/TechniqueBuilder';
import { TechniqueInstance } from '../graph/TechniqueInstance';
import type { FrameBuilder } from '../graph/FrameGraph';
import type { Technique } from '../graph/TechniqueTypes';
import { HDR_FORMAT } from './PostChain';

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
struct VOut { @builtin(position) clip: vec4<f32>, @location(0) uv: vec2<f32> };

var<private> params: array<vec4<f32>, 4>;

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VOut {
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VOut;
  o.clip = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2<f32>(p.x, 1.0 - p.y);
  return o;
}

fn sceneAt(uv: vec2<f32>) -> vec4<f32> { return textureSampleLevel(scene, scene_sampler, uv, 0.0); }
fn texelSize() -> vec2<f32> { return 1.0 / vec2<f32>(textureDimensions(scene)); }

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  params = array<vec4<f32>, 4>(/*$(Variable:p0)*/, /*$(Variable:p1)*/, /*$(Variable:p2)*/, /*$(Variable:p3)*/);
  return effect(in.uv, sceneAt(in.uv));
}
`;

/**
 * A full-screen effect applied to the HDR scene colour in place - the easy way to add a post-processing step from a
 * {@link RenderFeature}. It renders the scene texture through your `effect` function into a scratch texture and copies the result
 * back, so the effect can sample neighbouring pixels. Add it to the frame from `addPostPasses`; its draw and copy become nodes of the frame's graph, after the scene and before
 * the built-in post chain:
 *
 *   addPostPasses(g, f) { fx.addToFrame(g, f.sceneTexture); }
 *
 * (`run` records the same two commands into an encoder on its own.)
 */
export class FullscreenEffect {
  /** The effect's uniforms (16 floats = 4 vec4), uploaded on every `run`. */
  readonly params = new Float32Array(16);
  private tech: Technique;
  private instance: TechniqueInstance;
  private size = '1x1';

  /** Builds the effect at a placeholder size so a bad shader fails here, not in the middle of a frame; `run` rebuilds it for the real scene size. */
  constructor(private gpu: GPUContext, private o: FullscreenEffectOptions) {
    this.tech = this.build(1, 1);
    this.instance = TechniqueInstance.create(this.gpu, this.tech, { label: `fx:${this.o.label}` });
  }

  /** Free the effect's scratch texture and pipeline. */
  dispose(): void { this.instance.dispose(); }

  /** The effect as a technique for a scene texture of this size: draw the effect into a scratch texture, then copy it back over the scene. */
  private build(width: number, height: number): Technique {
    const g = technique(this.o.label);
    for (let i = 0; i < 4; i++) g.float4(`p${i}`);
    const scene = g.texture('scene', { format: HDR_FORMAT, size: [width, height], visibility: 'imported' });
    const scratch = g.texture('scratch', { like: scene });
    g.draw('effect', {
      shader: PRELUDE + this.o.wgsl, vertexEntry: 'vs_main', fragmentEntry: 'fs_main', vertices: 3,
      reads: [{ resource: scene, sampler: 'linear' }], colorTargets: [{ resource: scratch, clearValue: [0, 0, 0, 1] }],
    });
    g.copy('write-back', scratch, scene);
    return g.build();
  }

  /** Rebuild the technique when the scene texture has another size. */
  private fit(sceneTexture: GPUTexture): void {
    const size = `${sceneTexture.width}x${sceneTexture.height}`;
    if (this.size === size) return;
    this.instance.dispose();
    this.tech = this.build(sceneTexture.width, sceneTexture.height);
    this.instance = TechniqueInstance.create(this.gpu, this.tech, { label: `fx:${this.o.label}` });
    this.size = size;
  }

  private values(): Record<string, number[]> {
    return Object.fromEntries([0, 1, 2, 3].map((i) => [`p${i}`, Array.from(this.params.subarray(i * 4, i * 4 + 4))]));
  }

  /** Add the effect to the frame: it draws the scene (the frame's `sceneColor`) through `effect` into a scratch texture and copies the result back. `sceneTexture` is `PostFeatureFrame.sceneTexture`. */
  addToFrame(g: FrameBuilder, sceneTexture: GPUTexture): void {
    this.fit(sceneTexture);
    g.include(`fx:${this.o.label}`, this.tech, { imports: { scene: { as: 'sceneColor', resource: sceneTexture } }, variables: this.values() });
  }

  /** Apply the effect to `sceneTexture` (the HDR scene colour, `PostFeatureFrame.sceneTexture`) on its own. Records two commands into `enc`. */
  run(enc: GPUCommandEncoder, sceneTexture: GPUTexture): void {
    this.fit(sceneTexture);
    const fx = this.instance;
    fx.setImport('scene', sceneTexture);
    for (const [name, value] of Object.entries(this.values())) fx.setVariable(name, value);
    fx.execute(enc);
  }
}
