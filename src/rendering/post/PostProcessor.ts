import type { GPUContext } from '../../gpu/GPUContext';
import type { RenderGraph } from '../RenderGraph';
import { POST_SOURCE, POST_DEPTH_SOURCE, SSAO_SOURCE, SSR_SOURCE, registerEngineShaderChunks } from '../../shaders';

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

/** Format of the scene target while the post chain is on (linear HDR). */
export const HDR_FORMAT: GPUTextureFormat = 'rgba16float';
/** Format of the aux target (view-space normal, roughness, metallic) used by SSAO / SSR. */
export const AUX_FORMAT: GPUTextureFormat = 'rgba16float';
const DEPTH_LINEAR_FORMAT: GPUTextureFormat = 'r32float';
const AO_FORMAT: GPUTextureFormat = 'r8unorm';

const PARAM_STRIDE = 256;        // minUniformBufferOffsetAlignment
const PARAM_BYTES = 96;          // six vec4 (see Params in post_common.wgsl)
const MAX_BLOOM = 8;
const MAX_SLOTS = 2 * MAX_BLOOM + 12;

/** A texture plus its default view and size. */
interface Target { tex: GPUTexture; view: GPUTextureView; w: number; h: number; }

/** What the post passes need to know about the frame's camera and depth buffer. */
export interface PostFrameInfo {
  /** Camera projection matrix (column-major). */
  projection: ArrayLike<number>;
  /** Depth-only view of the main depth buffer (multisampled when `depthSamples` > 1). */
  depthView: GPUTextureView;
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
export class PostProcessor {
  readonly settings: PostSettings = cloneDefaults();
  /** Run the HDR post chain. */
  enabled = false;
  /** Bumped by every `configure` / `disable` that changes `enabled` or `msaa` (the renderer rebuilds its targets when it differs). */
  structureVersion = 0;

  private scene: Target | null = null;
  private msaaTarget: Target | null = null;
  private targetKey = '';
  private ldr: Target | null = null;
  private bloomLevels: Target[] = [];
  private aux: Target | null = null;
  private auxMsaa: Target | null = null;
  private viewDepth: Target | null = null;
  private ao: [Target, Target] | null = null;
  private ssrTarget: Target | null = null;
  private dummyHdr: Target;
  private dummyDepth: Target;
  private sampler: GPUSampler;
  private layout: GPUBindGroupLayout;
  private pipeLayout: GPUPipelineLayout;
  private depthLayouts: [GPUBindGroupLayout, GPUBindGroupLayout];
  private params: GPUBuffer;
  private paramData = new Float32Array(MAX_SLOTS * PARAM_STRIDE / 4);
  private groups = new Map<string, GPUBindGroup>();
  private usedSlots = 0;

  constructor(private gpu: GPUContext) {
    const { device, resources: r } = gpu;
    registerEngineShaderChunks(r.shaders);
    const F = GPUShaderStage.FRAGMENT;
    this.layout = device.createBindGroupLayout({
      label: 'post-layout',
      entries: [
        { binding: 0, visibility: F, sampler: { type: 'filtering' } },
        { binding: 1, visibility: F, texture: { sampleType: 'float' } },
        { binding: 2, visibility: F, texture: { sampleType: 'float' } },
        { binding: 3, visibility: F, buffer: { type: 'uniform' } },
        { binding: 4, visibility: F, texture: { sampleType: 'float' } },
        { binding: 5, visibility: F, texture: { sampleType: 'unfilterable-float' } },
      ],
    });
    this.pipeLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    const depthLayout = (ms: boolean) => device.createBindGroupLayout({
      label: ms ? 'post-depth-ms-layout' : 'post-depth-layout',
      entries: [
        { binding: ms ? 1 : 0, visibility: F, texture: { sampleType: 'depth', multisampled: ms } },
        { binding: 2, visibility: F, buffer: { type: 'uniform' } },
      ],
    });
    this.depthLayouts = [depthLayout(false), depthLayout(true)];
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.params = r.buffers.create('PostParams', MAX_SLOTS * PARAM_STRIDE, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const dummy = (label: string, format: GPUTextureFormat): Target => {
      const t = device.createTexture({ label, size: [1, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING });
      return { tex: t, view: t.createView(), w: 1, h: 1 };
    };
    this.dummyHdr = dummy('post-dummy', HDR_FORMAT);
    this.dummyDepth = dummy('post-dummy-depth', DEPTH_LINEAR_FORMAT);
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
  /** Multisampled colour view the main pass draws into when `samples > 1`. */
  get msaaView(): GPUTextureView { return this.msaaTarget!.view; }

  /** Colour attachment of the aux pass (cleared to "nothing written"; multisampled + resolved when MSAA is on). Valid when {@link needsAux}. */
  auxColorAttachment(): GPURenderPassColorAttachment {
    const clearValue = { r: 0, g: 0, b: 1, a: 0 };
    if (this.auxMsaa) return { view: this.auxMsaa.view, resolveTarget: this.aux!.view, clearValue, loadOp: 'clear', storeOp: 'discard' };
    return { view: this.aux!.view, clearValue, loadOp: 'clear', storeOp: 'store' };
  }

  /**
   * (Re)create the offscreen targets for a `width` x `height` frame. `samples` > 1 allocates the multisampled colour buffer
   * (format: HDR when the chain is on, else the swap chain format).
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
    const old = [this.scene, this.ldr, this.msaaTarget, this.aux, this.auxMsaa, this.viewDepth, this.ssrTarget, ...(this.ao ?? []), ...this.bloomLevels];
    for (const t of old) if (t) r.textures.destroy(t.tex);
    this.scene = this.ldr = this.msaaTarget = this.aux = this.auxMsaa = this.viewDepth = this.ssrTarget = null;
    this.ao = null; this.bloomLevels = [];
    this.groups.clear();

    const RT = GPUTextureUsage.RENDER_ATTACHMENT, TB = GPUTextureUsage.TEXTURE_BINDING;
    if (this.enabled) {
      this.scene = make('post-scene', w, h, HDR_FORMAT, RT | TB | GPUTextureUsage.COPY_SRC);
      if (fxaa) this.ldr = make('post-ldr', w, h, this.gpu.format, RT | TB);
      for (let i = 0, lw = w, lh = h; i < levels; i++) {
        lw = Math.max(1, (lw + 1) >> 1); lh = Math.max(1, (lh + 1) >> 1);
        this.bloomLevels.push(make('post-bloom-' + i, lw, lh, HDR_FORMAT, RT | TB));
      }
      if (aux) {
        this.aux = make('post-aux', w, h, AUX_FORMAT, RT | TB);
        if (samples > 1) this.auxMsaa = make('post-aux-msaa', w, h, AUX_FORMAT, RT, samples);
        this.viewDepth = make('post-view-depth', w, h, DEPTH_LINEAR_FORMAT, RT | TB);
      }
      if (ssao) this.ao = [make('post-ao-0', w, h, AO_FORMAT, RT | TB), make('post-ao-1', w, h, AO_FORMAT, RT | TB)];
      if (ssr) this.ssrTarget = make('post-ssr', w, h, HDR_FORMAT, RT | TB);
    }
    if (samples > 1) this.msaaTarget = make('post-msaa', w, h, this.enabled ? HDR_FORMAT : this.gpu.format, RT, samples);
  }

  private bloomLevelCount(w: number, h: number): number {
    const fit = Math.max(1, Math.floor(Math.log2(Math.min(w, h))) - 3);   // keep the smallest level at least ~8 px
    return Math.min(this.settings.bloom.levels, fit);
  }

  private pipeline(shader: 'post' | 'ssao' | 'ssr', source: string, entry: string, format: GPUTextureFormat, additive = false): GPURenderPipeline {
    const { device, resources: r } = this.gpu;
    const blend: GPUBlendState | undefined = additive
      ? { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } }
      : undefined;
    return r.pipelines.getRender({
      shader, vertexEntry: 'vs_full', fragmentEntry: entry, vertexLayout: [], topology: 'triangle-list', cullMode: 'none',
      depth: null, targets: [{ format, blend: blend ?? null }], sampleCount: 1, layout: 'post',
    }, () => {
      const module = r.shaders.get(shader, source);
      return device.createRenderPipeline({
        label: `${shader}:${entry}${additive ? ':add' : ''}`, layout: this.pipeLayout,
        vertex: { module, entryPoint: 'vs_full' }, fragment: { module, entryPoint: entry, targets: [{ format, blend }] },
        primitive: { topology: 'triangle-list' },
      });
    });
  }

  private postPipe(entry: string, format: GPUTextureFormat, additive = false): GPURenderPipeline { return this.pipeline('post', POST_SOURCE, entry, format, additive); }

  private depthPipeline(ms: boolean): GPURenderPipeline {
    const { device, resources: r } = this.gpu;
    const entry = ms ? 'fs_depth_ms' : 'fs_depth';
    return r.pipelines.getRender({
      shader: 'post-depth', vertexEntry: 'vs_full', fragmentEntry: entry, vertexLayout: [], topology: 'triangle-list', cullMode: 'none',
      depth: null, targets: [{ format: DEPTH_LINEAR_FORMAT }], sampleCount: 1, layout: ms ? 'post-depth-ms' : 'post-depth',
    }, () => {
      const module = r.shaders.get('post-depth', POST_DEPTH_SOURCE);
      return device.createRenderPipeline({
        label: `post-depth:${entry}`, layout: device.createPipelineLayout({ bindGroupLayouts: [this.depthLayouts[ms ? 1 : 0]] }),
        vertex: { module, entryPoint: 'vs_full' }, fragment: { module, entryPoint: entry, targets: [{ format: DEPTH_LINEAR_FORMAT }] },
        primitive: { topology: 'triangle-list' },
      });
    });
  }

  /** Bind group of the depth-linearisation pass, valid for one depth view / sample count / parameter slot. */
  private depthGroup: { view: GPUTextureView; ms: boolean; slot: number; bg: GPUBindGroup } | null = null;

  private bindGroup(key: string, slot: number, a: GPUTextureView, b?: GPUTextureView, c?: GPUTextureView, d?: GPUTextureView): GPUBindGroup {
    let g = this.groups.get(key);
    if (!g) {
      g = this.gpu.device.createBindGroup({
        label: `post:${key}`, layout: this.layout,
        entries: [
          { binding: 0, resource: this.sampler }, { binding: 1, resource: a }, { binding: 2, resource: b ?? this.dummyHdr.view },
          { binding: 3, resource: { buffer: this.params, offset: slot * PARAM_STRIDE, size: PARAM_BYTES } },
          { binding: 4, resource: c ?? this.dummyHdr.view }, { binding: 5, resource: d ?? this.dummyDepth.view },
        ],
      });
      this.groups.set(key, g);
    }
    return g;
  }

  /** Reserve the next parameter slot and fill it (six vec4: a..f). */
  private slot(...v: number[][]): number {
    const i = this.usedSlots++;
    const flat: number[] = [];
    for (let k = 0; k < 6; k++) { const q = v[k] ?? []; for (let j = 0; j < 4; j++) flat.push(q[j] ?? 0); }
    this.paramData.set(flat, i * (PARAM_STRIDE / 4));
    return i;
  }

  private fullscreen(enc: GPUCommandEncoder, label: string, view: GPUTextureView, pipe: GPURenderPipeline, group: GPUBindGroup, load = false): void {
    const pass = enc.beginRenderPass({
      label, colorAttachments: [{ view, loadOp: load ? 'load' : 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(pipe); pass.setBindGroup(0, group); pass.draw(3); pass.end();
  }

  /**
   * Declare the post passes in `g`. Call after the main pass(es) (which write `'sceneColor'`) and the aux pass (`'auxTex'`).
   * The final pass writes the swap chain (`'backbuffer'`).
   */
  addPasses(g: RenderGraph, frame: PostFrameInfo): void {
    if (!this.enabled || !this.scene) return;
    const s = this.settings, scene = this.scene, gpu = this.gpu;
    const levels = this.bloomLevels;
    const bloomOn = s.bloom.enabled && levels.length > 0;
    const fxaa = s.fxaa && this.ldr !== null;
    const vd = this.viewDepth, aux = this.aux;
    const ssaoOn = s.ssao.enabled && this.ao !== null && vd !== null && aux !== null;
    const ssrOn = s.ssr.enabled && this.ssrTarget !== null && vd !== null && aux !== null;
    this.usedSlots = 0;
    const reads = ['sceneColor'];

    // Camera constants shared by the depth-based passes.
    const proj = frame.projection;
    const near = proj[14] / proj[10], far = proj[14] / (1 + proj[10]);
    const camE = [proj[0], proj[5], proj[10], proj[14]];
    const camF = [1 / scene.w, 1 / scene.h, scene.w, scene.h];

    if (vd && aux) {
      const ms = frame.depthSamples > 1;
      const sl = this.slot([proj[10], proj[14], 0, 0]);
      // the same (depth view, sample count, parameter slot) comes back every frame: keep the bind group instead of rebuilding it
      let cached = this.depthGroup;
      if (!cached || cached.view !== frame.depthView || cached.ms !== ms || cached.slot !== sl) {
        cached = this.depthGroup = {
          view: frame.depthView, ms, slot: sl,
          bg: gpu.device.createBindGroup({
            label: 'post:depth', layout: this.depthLayouts[ms ? 1 : 0],
            entries: [
              { binding: ms ? 1 : 0, resource: frame.depthView },
              { binding: 2, resource: { buffer: this.params, offset: sl * PARAM_STRIDE, size: 16 } },
            ],
          }),
        };
      }
      const bg = cached.bg;
      g.addPass({ name: 'post-depth', reads: ['sceneColor'], writes: ['viewDepth'], execute: (e) => this.fullscreen(e, 'post-depth', vd.view, this.depthPipeline(ms), bg) });
    }

    if (ssaoOn) {
      const [ao0, ao1] = this.ao!;
      const a = s.ssao;
      const sl = this.slot([a.radius, a.bias, a.intensity, a.power], [a.samples, 0, far, 0], [], [], camE, camF);
      const grp = this.bindGroup(`ssao:${sl}`, sl, aux!.view, undefined, undefined, vd!.view);
      g.addPass({ name: 'post-ssao', reads: ['viewDepth', 'auxTex'], writes: ['aoRaw'], execute: (e) => this.fullscreen(e, 'post-ssao', ao0.view, this.pipeline('ssao', SSAO_SOURCE, 'fs_ssao', AO_FORMAT), grp) });
      const slH = this.slot([1, 0, 20, 0], [], [], [], camE, camF);
      const gH = this.bindGroup(`blurh:${slH}`, slH, ao0.view, undefined, undefined, vd!.view);
      g.addPass({ name: 'post-ssao-blur-h', reads: ['aoRaw', 'viewDepth'], writes: ['aoTmp'], execute: (e) => this.fullscreen(e, 'ssao-blur-h', ao1.view, this.pipeline('ssao', SSAO_SOURCE, 'fs_blur', AO_FORMAT), gH) });
      const slV = this.slot([0, 1, 20, 0], [], [], [], camE, camF);
      const gV = this.bindGroup(`blurv:${slV}`, slV, ao1.view, undefined, undefined, vd!.view);
      g.addPass({ name: 'post-ssao-blur-v', reads: ['aoTmp', 'viewDepth'], writes: ['ao'], execute: (e) => this.fullscreen(e, 'ssao-blur-v', ao0.view, this.pipeline('ssao', SSAO_SOURCE, 'fs_blur', AO_FORMAT), gV) });
      reads.push('ao');
    }

    if (ssrOn) {
      const r = s.ssr;
      const sl = this.slot([r.maxDistance, r.thickness, r.stride, r.steps], [r.intensity, r.maxRoughness, 0, far], [near, 0, 0, 0], [], camE, camF);
      const grp = this.bindGroup(`ssr:${sl}`, sl, scene.view, aux!.view, undefined, vd!.view);
      const target = this.ssrTarget!;
      g.addPass({ name: 'post-ssr', reads: ['sceneColor', 'viewDepth', 'auxTex'], writes: ['ssrTex'], execute: (e) => this.fullscreen(e, 'post-ssr', target.view, this.pipeline('ssr', SSR_SOURCE, 'fs_ssr', HDR_FORMAT), grp) });
      reads.push('ssrTex');
    }

    // Parameter slots are assigned in declaration order so the bind groups (keyed by slot) stay valid across frames.
    if (bloomOn) {
      const n = levels.length;
      const steps: ((enc: GPUCommandEncoder) => void)[] = [];
      const pre = this.slot([1 / scene.w, 1 / scene.h, s.bloom.threshold, Math.max(s.bloom.knee, 1e-4)]);
      const gPre = this.bindGroup(`pre:${pre}`, pre, scene.view);
      steps.push((e) => this.fullscreen(e, 'bloom-prefilter', levels[0].view, this.postPipe('fs_prefilter', HDR_FORMAT), gPre));
      for (let i = 1; i < n; i++) {
        const sl = this.slot([1 / levels[i - 1].w, 1 / levels[i - 1].h, 0, 0]);
        const grp = this.bindGroup(`down${i}:${sl}`, sl, levels[i - 1].view);
        steps.push((e) => this.fullscreen(e, `bloom-down-${i}`, levels[i].view, this.postPipe('fs_down', HDR_FORMAT), grp));
      }
      for (let i = n - 1; i >= 1; i--) {
        const sl = this.slot([s.bloom.radius / levels[i].w, s.bloom.radius / levels[i].h, 0, 0]);
        const grp = this.bindGroup(`up${i}:${sl}`, sl, levels[i].view);
        steps.push((e) => this.fullscreen(e, `bloom-up-${i}`, levels[i - 1].view, this.postPipe('fs_up', HDR_FORMAT, true), grp, true));
      }
      g.addPass({ name: 'post-bloom', reads: ['sceneColor'], writes: ['bloomTex'], execute: (e) => { for (const st of steps) st(e); } });
      reads.push('bloomTex');
    }

    const comp = this.slot(
      [0, 0, 0, 0],
      [s.exposure, s.bloom.intensity, s.vignette, s.saturation],
      [s.contrast, TONE_MAPPER_ID[s.toneMapper], bloomOn ? 1 : 0, 1 / 255],
      [scene.w / scene.h, ssaoOn ? 1 : 0, ssrOn ? 1 : 0, 0],
    );
    const gComp = this.bindGroup(`comp:${comp}:${bloomOn}:${ssaoOn}:${ssrOn}`, comp, scene.view,
      bloomOn ? levels[0].view : undefined, ssrOn ? this.ssrTarget!.view : undefined, ssaoOn ? this.ao![0].view : undefined);
    const compTarget = fxaa ? this.ldr!.view : null;
    g.addPass({
      name: 'post-composite', reads, writes: [fxaa ? 'ldr' : 'backbuffer'], sideEffect: !fxaa,
      execute: (e) => this.fullscreen(e, 'post-composite', compTarget ?? gpu.context.getCurrentTexture().createView(), this.postPipe('fs_composite', gpu.format), gComp),
    });

    if (fxaa) {
      const fx = this.slot([1 / scene.w, 1 / scene.h, 0, 0]);
      const gFx = this.bindGroup(`fxaa:${fx}`, fx, this.ldr!.view);
      g.addPass({
        name: 'post-fxaa', reads: ['ldr'], writes: ['backbuffer'], sideEffect: true,
        execute: (e) => this.fullscreen(e, 'post-fxaa', gpu.context.getCurrentTexture().createView(), this.postPipe('fs_fxaa', gpu.format), gFx),
      });
    }
    gpu.queue.writeBuffer(this.params, 0, this.paramData, 0, this.usedSlots * (PARAM_STRIDE / 4));
  }
}
