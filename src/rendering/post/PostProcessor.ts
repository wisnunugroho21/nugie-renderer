import type { GPUContext } from '../../gpu/GPUContext';
import type { RenderGraph } from '../RenderGraph';
import { FeatureOrder, type PostFeatureFrame, type RenderFeature } from '../RenderFeature';
import { POST_SOURCE, POST_DEPTH_SOURCE, SSAO_SOURCE, SSR_SOURCE, registerEngineShaderChunks } from '../../shaders';
import { TechniqueInstance } from '../graph/TechniqueInstance';
import type { Technique } from '../graph/TechniqueTypes';
import { AUX_FORMAT, HDR_FORMAT, buildPostChain, postChainValues, type PostChainPlan, type PostChainShape } from './PostChain';

export { AUX_FORMAT, HDR_FORMAT };

/** Tone mapping operator applied by the composite pass. */
export type ToneMapper = 'none' | 'reinhard' | 'aces' | 'neutral';
const TONE_MAPPER_ID: Record<ToneMapper, number> = { none: 0, reinhard: 1, aces: 2, neutral: 3 };

export interface BloomSettings {
  enabled: boolean;
  /** Scene luminance (linear, after exposure is NOT applied) above which pixels start to glow. 1 = "brighter than white". */
  threshold: number;
  /** Width of the soft transition below the threshold (0 = hard cut). */
  knee: number;
  /** How much of the blurred glow is added to the image. */
  intensity: number;
  /** Blur spread: scales the upsample filter (1 = default). */
  radius: number;
  /** Number of downsample levels (more = wider glow, 1..8; limited by the screen size). */
  levels: number;
}

/** Screen-space ambient occlusion (multiplies the lit image; needs the post chain). */
export interface SSAOSettings {
  enabled: boolean;
  /** World-space radius of the sampling hemisphere (scene units). */
  radius: number;
  /** Depth tolerance that avoids self-occlusion on flat surfaces (scene units). */
  bias: number;
  /** 0 = no effect, 1 = full strength. */
  intensity: number;
  /** Contrast curve applied to the occlusion (>1 darkens the crevices more). */
  power: number;
  /** Samples per pixel (4..32). */
  samples: number;
}

/** Screen-space reflections of the visible scene on glossy opaque PBR surfaces (needs the post chain). */
export interface SSRSettings {
  enabled: boolean;
  /** Overall strength of the reflections (they also scale with Fresnel and smoothness). */
  intensity: number;
  /** Longest reflected ray (scene units). */
  maxDistance: number;
  /** Depth tolerance of a hit (scene units, grows a little with distance). */
  thickness: number;
  /** Surfaces rougher than this get no reflection; fades out smoothly below it. */
  maxRoughness: number;
  /** Maximum ray-march steps (8..256). */
  steps: number;
  /** Screen-space distance per step (pixels). */
  stride: number;
}

export interface PostSettings {
  /** Samples per pixel of the scene target: 1 (off) or 4 (MSAA). Works with or without the post chain. Ignored (1) while `gpuCulling` is 'hiz2', which samples the single-sample depth buffer. */
  msaa: 1 | 4;
  /** FXAA on the final image (needs the post chain). */
  fxaa: boolean;
  /** Linear multiplier applied before tone mapping. */
  exposure: number;
  toneMapper: ToneMapper;
  bloom: BloomSettings;
  ssao: SSAOSettings;
  ssr: SSRSettings;
  /** 0 = none, 1 = strong darkening towards the corners. */
  vignette: number;
  /** 1 = unchanged, 0 = greyscale. */
  saturation: number;
  /** 1 = unchanged; applied around mid grey in display space. */
  contrast: number;
}

/** Input for {@link PostProcessor.configure}: any subset; `bloom`, `ssao` and `ssr` are merged field by field (`true` / `false` toggle them). */
export type PostSettingsInput = Partial<Omit<PostSettings, 'bloom' | 'ssao' | 'ssr'>> & {
  bloom?: Partial<BloomSettings> | boolean;
  ssao?: Partial<SSAOSettings> | boolean;
  ssr?: Partial<SSRSettings> | boolean;
};

export const DEFAULT_POST_SETTINGS: Readonly<PostSettings> = {
  msaa: 1, fxaa: false, exposure: 1, toneMapper: 'aces',
  bloom: { enabled: false, threshold: 1, knee: 0.5, intensity: 0.2, radius: 1, levels: 6 },
  ssao: { enabled: false, radius: 0.6, bias: 0.03, intensity: 1, power: 1.5, samples: 16 },
  ssr: { enabled: false, intensity: 1, maxDistance: 25, thickness: 0.6, maxRoughness: 0.5, steps: 64, stride: 2 },
  vignette: 0, saturation: 1, contrast: 1,
};

function cloneDefaults(): PostSettings {
  const d = DEFAULT_POST_SETTINGS;
  return { ...d, bloom: { ...d.bloom }, ssao: { ...d.ssao }, ssr: { ...d.ssr } };
}

const MAX_BLOOM = 8;

/** A texture plus its default view and size. */
interface Target { tex: GPUTexture; view: GPUTextureView; w: number; h: number; }

/** What the post passes need to know about the frame's camera and depth buffer. */
export interface PostFrameInfo {
  /** Camera projection matrix (column-major). */
  projection: ArrayLike<number>;
  /** Depth-only view of the main depth buffer (multisampled when `depthSamples` > 1). */
  depthView: GPUTextureView;
  /** The texture behind `depthView`. */
  depthTexture: GPUTexture;
  depthSamples: number;
}

/**
 * Post-processing and anti-aliasing. Owns the offscreen scene target (optionally multisampled), the bloom chain, the screen-space
 * AO / reflection targets and the full-screen passes, and declares them in the render graph.
 *
 * Two independent switches:
 *  - `enabled`: render the scene as linear HDR (rgba16float) and run SSAO / SSR -> bloom -> composite (exposure, tone mapping, grading, sRGB) -> FXAA;
 *  - `settings.msaa = 4`: multisampled scene target, resolved automatically (also works with `enabled = false`).
 *
 * Use `renderer.post.configure({...})`. Changing `enabled` / `msaa` re-creates pipelines on the next frame (set them before
 * `renderer.warmup()` to avoid that hitch).
 */
export class PostProcessor implements RenderFeature {
  readonly name = 'post-chain';
  /** After every other post feature: user effects work on the HDR colour before SSAO / SSR / bloom / tone mapping. */
  order = FeatureOrder.postChain;
  readonly settings: PostSettings = cloneDefaults();
  /** Run the HDR post chain. */
  enabled = false;
  /** Render the final image into this texture (format = the swap chain's) instead of the swap chain. For tests and off-screen use. */
  outputTexture: GPUTexture | null = null;
  /** Bumped by every `configure` / `disable` that changes `enabled` or `msaa` (the renderer rebuilds its targets when it differs). */
  structureVersion = 0;

  private scene: Target | null = null;
  private msaaTarget: Target | null = null;
  private targetKey = '';
  private aux: Target | null = null;
  private auxMsaa: Target | null = null;
  private bloomSizes: [number, number][] = [];
  private dummy: GPUTexture;
  /** The chain technique for the current targets, and the GPU instance made from it on first use. */
  private chain: { key: string; shape: PostChainShape; plan: PostChainPlan; instance: TechniqueInstance | null } | null = null;

  constructor(private gpu: GPUContext) {
    const { resources: r } = gpu;
    registerEngineShaderChunks(r.shaders);
    this.dummy = r.textures.create({ label: 'post-dummy', size: [1, 1], format: HDR_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING });
  }

  /** Apply settings. Turns the post chain on (`enabled = true`) unless `enabled: false` is passed explicitly. */
  configure(input: PostSettingsInput & { enabled?: boolean } = {}): this {
    const prevMsaa = this.settings.msaa, prevEnabled = this.enabled;
    const { bloom, ssao, ssr, enabled, ...rest } = input;
    if (rest.msaa !== undefined && rest.msaa !== 1 && rest.msaa !== 4) throw new Error(`post: msaa must be 1 or 4, got ${rest.msaa}`);
    Object.assign(this.settings, rest);
    const merge = <T extends { enabled: boolean }>(target: T, v: Partial<T> | boolean | undefined): void => {
      if (v === undefined) return;
      if (typeof v === 'boolean') target.enabled = v;
      else Object.assign(target, v.enabled === undefined ? { enabled: true } : {}, v);
    };
    merge(this.settings.bloom, bloom);
    merge(this.settings.ssao, ssao);
    merge(this.settings.ssr, ssr);
    const s = this.settings;
    s.bloom.levels = Math.max(1, Math.min(MAX_BLOOM, Math.round(s.bloom.levels)));
    s.ssao.samples = Math.max(4, Math.min(32, Math.round(s.ssao.samples)));
    s.ssr.steps = Math.max(8, Math.min(256, Math.round(s.ssr.steps)));
    this.enabled = enabled ?? true;
    if (this.enabled !== prevEnabled || s.msaa !== prevMsaa) this.structureVersion++;
    return this;
  }

  /** Back to direct rendering (the swap chain gets tone-mapped sRGB straight from the main pass); MSAA is left as set. */
  disable(): this {
    if (this.enabled) { this.enabled = false; this.structureVersion++; }
    return this;
  }

  /** Restore every setting to its default and switch the chain off. */
  reset(): this {
    const had = this.enabled || this.settings.msaa !== 1;
    Object.assign(this.settings, cloneDefaults());
    this.enabled = false;
    if (had) this.structureVersion++;
    return this;
  }

  /** The main pass must be followed by the aux pass (view-space normal / roughness / metallic) for SSAO or SSR. */
  get needsAux(): boolean { return this.enabled && (this.settings.ssao.enabled || this.settings.ssr.enabled); }

  /** The HDR scene colour texture (resolved when multisampled): copied for screen-space transmission. */
  get sceneTexture(): GPUTexture { return this.scene!.tex; }
  /** Scene colour view the main pass draws into (resolve target when multisampled). Valid after {@link ensureTargets}. */
  get sceneView(): GPUTextureView { return this.scene!.view; }
  /** The multisampled colour texture the main pass draws into when `samples > 1` (null otherwise). */
  get msaaTexture(): GPUTexture | null { return this.msaaTarget?.tex ?? null; }
  /** Multisampled colour view the main pass draws into when `samples > 1`. */
  get msaaView(): GPUTextureView { return this.msaaTarget!.view; }

  /** The aux target (view-space normal, roughness, metallic) and its multisampled twin; valid when {@link needsAux}. */
  get auxTexture(): GPUTexture { return this.aux!.tex; }
  get auxMsaaTexture(): GPUTexture | null { return this.auxMsaa?.tex ?? null; }

  /** Colour attachment of the aux pass (cleared to "nothing written"; multisampled + resolved when MSAA is on). Valid when {@link needsAux}. */
  auxColorAttachment(): GPURenderPassColorAttachment {
    const clearValue = { r: 0, g: 0, b: 1, a: 0 };
    if (this.auxMsaa) return { view: this.auxMsaa.view, resolveTarget: this.aux!.view, clearValue, loadOp: 'clear', storeOp: 'discard' };
    return { view: this.aux!.view, clearValue, loadOp: 'clear', storeOp: 'store' };
  }

  /**
   * (Re)create the offscreen targets for a `width` x `height` frame. `samples` > 1 allocates the multisampled colour buffer
   * (format: HDR when the chain is on, else the swap chain format). The chain's own targets (view depth, AO, SSR, bloom levels, the
   * pre-FXAA image) belong to the chain technique and are created with it.
   */
  ensureTargets(width: number, height: number, samples: number): void {
    const { resources: r } = this.gpu;
    const w = Math.max(1, width), h = Math.max(1, height);
    const levels = this.enabled && this.settings.bloom.enabled ? this.bloomLevelCount(w, h) : 0;
    const fxaa = this.enabled && this.settings.fxaa;
    const aux = this.needsAux, ssao = this.enabled && this.settings.ssao.enabled, ssr = this.enabled && this.settings.ssr.enabled;
    const key = [w, h, this.enabled, fxaa, levels, samples, aux, ssao, ssr].join('|');
    if (key === this.targetKey) return;
    this.targetKey = key;

    const make = (label: string, tw: number, th: number, format: GPUTextureFormat, usage: number, sampleCount = 1): Target => {
      const tex = r.textures.create({ label, size: [tw, th], format, usage, sampleCount });
      return { tex, view: tex.createView(), w: tw, h: th };
    };
    for (const t of [this.scene, this.msaaTarget, this.aux, this.auxMsaa]) if (t) r.textures.destroy(t.tex);
    this.scene = this.msaaTarget = this.aux = this.auxMsaa = null;
    this.disposeChain();
    this.bloomSizes = [];

    const RT = GPUTextureUsage.RENDER_ATTACHMENT, TB = GPUTextureUsage.TEXTURE_BINDING;
    if (this.enabled) {
      this.scene = make('post-scene', w, h, HDR_FORMAT, RT | TB | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST);   // COPY_DST: features may write the scene colour back (FullscreenEffect)
      for (let i = 0, lw = w, lh = h; i < levels; i++) {
        lw = Math.max(1, (lw + 1) >> 1); lh = Math.max(1, (lh + 1) >> 1);
        this.bloomSizes.push([lw, lh]);
      }
      if (aux) {
        this.aux = make('post-aux', w, h, AUX_FORMAT, RT | TB);
        if (samples > 1) this.auxMsaa = make('post-aux-msaa', w, h, AUX_FORMAT, RT, samples);
      }
    }
    if (samples > 1) this.msaaTarget = make('post-msaa', w, h, this.enabled ? HDR_FORMAT : this.gpu.format, RT, samples);
  }

  private bloomLevelCount(w: number, h: number): number {
    const fit = Math.max(1, Math.floor(Math.log2(Math.min(w, h))) - 3);   // keep the smallest level at least ~8 px
    return Math.min(this.settings.bloom.levels, fit);
  }

  private disposeChain(): void {
    this.chain?.instance?.dispose();
    this.chain = null;
  }

  /** The chain technique for the current targets and depth buffer (rebuilt only when the size or the set of enabled effects changes). Valid while the chain is on. */
  chainPlan(depthSamples: number): { technique: Technique; shape: PostChainShape } {
    const scene = this.scene!, s = this.settings, aux = this.aux !== null;
    const shape: PostChainShape = {
      width: scene.w, height: scene.h, swapFormat: this.gpu.format, depthSamples, aux,
      ssao: s.ssao.enabled && aux, ssr: s.ssr.enabled && aux, fxaa: s.fxaa, bloom: s.bloom.enabled ? this.bloomSizes : [],
    };
    const key = JSON.stringify(shape);
    if (this.chain?.key !== key) {
      this.disposeChain();
      const shaders = this.gpu.resources.shaders;
      const plan = buildPostChain(shape, { assemble: (src) => shaders.assemble(src, {}), post: POST_SOURCE, depth: POST_DEPTH_SOURCE, ssao: SSAO_SOURCE, ssr: SSR_SOURCE });
      this.chain = { key, shape, plan, instance: null };
    }
    return { technique: this.chain!.plan.technique, shape };
  }

  /** The post chain as a feature: runs after any user post feature (see `order`). */
  addPostPasses(g: RenderGraph, f: PostFeatureFrame): void {
    this.addChainPasses(g, { projection: f.projection, depthView: f.depthView, depthTexture: f.depthTexture, depthSamples: f.depthSamples });
  }

  /**
   * Declare the post chain in `g` as one pass. Call after the main pass(es) (which write `'sceneColor'`) and the aux pass (`'auxTex'`).
   * The pass writes the swap chain (`'backbuffer'`); inside it the chain's nodes run in the order the technique compiler derived.
   */
  addChainPasses(g: RenderGraph, frame: PostFrameInfo): void {
    if (!this.enabled || !this.scene) return;
    this.chainPlan(frame.depthSamples);
    g.addPass({
      name: 'post-chain', reads: this.needsAux ? ['sceneColor', 'auxTex'] : ['sceneColor'], writes: ['backbuffer'], sideEffect: true,
      execute: (enc) => this.runChain(enc, frame),
    });
  }

  private runChain(enc: GPUCommandEncoder, frame: PostFrameInfo): void {
    const chain = this.chain!;
    chain.instance ??= TechniqueInstance.create(this.gpu, chain.plan.technique, {
      label: 'post', imports: { scene: this.scene!.tex, dummy: this.dummy, ...(this.aux ? { aux: this.aux.tex, depth: frame.depthTexture } : {}) },
    });
    const fx = chain.instance;
    fx.setImport('scene', this.scene!.tex);
    if (this.aux) { fx.setImport('aux', this.aux.tex); fx.setImport('depth', frame.depthTexture); }
    fx.setImport('backbuffer', this.outputTexture ?? this.gpu.context.getCurrentTexture());
    const values = postChainValues(chain.shape, this.settings, { projection: frame.projection, toneMapperId: TONE_MAPPER_ID[this.settings.toneMapper] });
    for (const [name, value] of Object.entries(values)) if (chain.plan.variables.has(name)) fx.setVariable(name, value);
    fx.execute(enc);
  }
}
