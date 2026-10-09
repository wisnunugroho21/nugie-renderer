import type { GPUContext } from '../../gpu/GPUContext';
import type { RenderGraph } from '../RenderGraph';
import { POST_SOURCE, registerEngineShaderChunks } from '../../shaders';

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

export interface PostSettings {
  /** Samples per pixel of the scene target: 1 (off) or 4 (MSAA). Works with or without the post chain. Ignored (1) while `gpuCulling` is 'hiz' / 'hiz2', which sample the single-sample depth buffer. */
  msaa: 1 | 4;
  /** FXAA on the final image (needs the post chain). */
  fxaa: boolean;
  /** Linear multiplier applied before tone mapping. */
  exposure: number;
  toneMapper: ToneMapper;
  bloom: BloomSettings;
  /** 0 = none, 1 = strong darkening towards the corners. */
  vignette: number;
  /** 1 = unchanged, 0 = greyscale. */
  saturation: number;
  /** 1 = unchanged; applied around mid grey in display space. */
  contrast: number;
}

/** Input for {@link PostProcessor.configure}: any subset; `bloom` is merged field by field. */
export type PostSettingsInput = Partial<Omit<PostSettings, 'bloom'>> & { bloom?: Partial<BloomSettings> | boolean };

export const DEFAULT_POST_SETTINGS: Readonly<PostSettings> = {
  msaa: 1, fxaa: false, exposure: 1, toneMapper: 'aces',
  bloom: { enabled: false, threshold: 1, knee: 0.5, intensity: 0.2, radius: 1, levels: 6 },
  vignette: 0, saturation: 1, contrast: 1,
};

/** Format of the scene target while the post chain is on (linear HDR). */
export const HDR_FORMAT: GPUTextureFormat = 'rgba16float';

const PARAM_STRIDE = 256;        // minUniformBufferOffsetAlignment
const MAX_BLOOM = 8;
const MAX_SLOTS = 2 * MAX_BLOOM + 3;

/** A texture plus its default view and size. */
interface Target { tex: GPUTexture; view: GPUTextureView; w: number; h: number; }

/**
 * Post-processing and anti-aliasing. Owns the offscreen scene target (optionally multisampled), the bloom chain and the full-screen
 * passes, and declares them in the render graph.
 *
 * Two independent switches:
 *  - `enabled`: render the scene as linear HDR (rgba16float) and run bloom -> composite (exposure, tone mapping, grading, sRGB) -> FXAA;
 *  - `settings.msaa = 4`: multisampled scene target, resolved automatically (also works with `enabled = false`).
 *
 * Use `renderer.post.configure({...})`. Changing `enabled` / `msaa` re-creates pipelines on the next frame (set them before
 * `renderer.warmup()` to avoid that hitch).
 */
export class PostProcessor {
  readonly settings: PostSettings = { ...DEFAULT_POST_SETTINGS, bloom: { ...DEFAULT_POST_SETTINGS.bloom } };
  /** Run the HDR post chain. */
  enabled = false;
  /** Bumped by every `configure` / `disable` that changes `enabled` or `msaa` (the renderer rebuilds its targets when it differs). */
  structureVersion = 0;

  private scene: Target | null = null;
  private msaaTarget: Target | null = null;
  private targetKey = '';
  private ldr: Target | null = null;
  private bloomLevels: Target[] = [];
  private dummy: Target;
  private sampler: GPUSampler;
  private layout: GPUBindGroupLayout;
  private pipeLayout: GPUPipelineLayout;
  private params: GPUBuffer;
  private paramData = new Float32Array(MAX_SLOTS * PARAM_STRIDE / 4);
  private groups = new Map<string, GPUBindGroup>();
  private usedSlots = 0;

  constructor(private gpu: GPUContext) {
    const { device, resources: r } = gpu;
    registerEngineShaderChunks(r.shaders);
    this.layout = device.createBindGroupLayout({
      label: 'post-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.pipeLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.params = r.buffers.create('PostParams', MAX_SLOTS * PARAM_STRIDE, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const t = device.createTexture({ label: 'post-dummy', size: [1, 1], format: HDR_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING });
    this.dummy = { tex: t, view: t.createView(), w: 1, h: 1 };
  }

  /** Apply settings. Turns the post chain on (`enabled = true`) unless `settings.enabled === false` is passed explicitly. */
  configure(input: PostSettingsInput & { enabled?: boolean } = {}): this {
    const prevMsaa = this.settings.msaa, prevEnabled = this.enabled;
    const { bloom, enabled, ...rest } = input;
    if (rest.msaa !== undefined && rest.msaa !== 1 && rest.msaa !== 4) throw new Error(`post: msaa must be 1 or 4, got ${rest.msaa}`);
    Object.assign(this.settings, rest);
    if (bloom !== undefined) {
      if (typeof bloom === 'boolean') this.settings.bloom.enabled = bloom;
      else Object.assign(this.settings.bloom, bloom.enabled === undefined ? { enabled: true } : {}, bloom);
    }
    const s = this.settings;
    s.bloom.levels = Math.max(1, Math.min(MAX_BLOOM, Math.round(s.bloom.levels)));
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
    Object.assign(this.settings, DEFAULT_POST_SETTINGS, { bloom: { ...DEFAULT_POST_SETTINGS.bloom } });
    this.enabled = false;
    if (had) this.structureVersion++;
    return this;
  }

  /** Scene colour view the main pass draws into (resolve target when multisampled). Valid after {@link ensureTargets}. */
  get sceneView(): GPUTextureView { return this.scene!.view; }
  /** Multisampled colour view the main pass draws into when `samples > 1`. */
  get msaaView(): GPUTextureView { return this.msaaTarget!.view; }

  /**
   * (Re)create the offscreen targets for a `width` x `height` frame. `samples` > 1 allocates the multisampled colour buffer
   * (format: HDR when the chain is on, else the swap chain format).
   */
  ensureTargets(width: number, height: number, samples: number): void {
    const { resources: r } = this.gpu;
    const w = Math.max(1, width), h = Math.max(1, height);
    const levels = this.enabled && this.settings.bloom.enabled ? this.bloomLevelCount(w, h) : 0;
    const fxaa = this.enabled && this.settings.fxaa;
    const key = [w, h, this.enabled, fxaa, levels, samples].join('|');
    if (key === this.targetKey) return;
    this.targetKey = key;

    const make = (label: string, tw: number, th: number, format: GPUTextureFormat, usage: number, sampleCount = 1): Target => {
      const tex = r.textures.create({ label, size: [tw, th], format, usage, sampleCount });
      return { tex, view: tex.createView(), w: tw, h: th };
    };
    for (const t of [this.scene, this.ldr, this.msaaTarget, ...this.bloomLevels]) if (t) r.textures.destroy(t.tex);
    this.scene = this.ldr = this.msaaTarget = null; this.bloomLevels = [];
    this.groups.clear();

    const RT = GPUTextureUsage.RENDER_ATTACHMENT, TB = GPUTextureUsage.TEXTURE_BINDING;
    if (this.enabled) {
      this.scene = make('post-scene', w, h, HDR_FORMAT, RT | TB);
      if (fxaa) this.ldr = make('post-ldr', w, h, this.gpu.format, RT | TB);
      for (let i = 0, lw = w, lh = h; i < levels; i++) {
        lw = Math.max(1, (lw + 1) >> 1); lh = Math.max(1, (lh + 1) >> 1);
        this.bloomLevels.push(make('post-bloom-' + i, lw, lh, HDR_FORMAT, RT | TB));
      }
    }
    if (samples > 1) this.msaaTarget = make('post-msaa', w, h, this.enabled ? HDR_FORMAT : this.gpu.format, RT, samples);
  }

  private bloomLevelCount(w: number, h: number): number {
    const fit = Math.max(1, Math.floor(Math.log2(Math.min(w, h))) - 3);   // keep the smallest level at least ~8 px
    return Math.min(this.settings.bloom.levels, fit);
  }

  private pipeline(entry: string, format: GPUTextureFormat, additive = false): GPURenderPipeline {
    const { device, resources: r } = this.gpu;
    const blend: GPUBlendState | undefined = additive
      ? { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } }
      : undefined;
    return r.pipelines.getRender({
      shader: 'post', vertexEntry: 'vs_full', fragmentEntry: entry, vertexLayout: [], topology: 'triangle-list', cullMode: 'none',
      depth: null, targets: [{ format, blend: blend ?? null }], sampleCount: 1, layout: 'post',
    }, () => {
      const module = r.shaders.get('post', POST_SOURCE);
      return device.createRenderPipeline({
        label: `post:${entry}${additive ? ':add' : ''}`, layout: this.pipeLayout,
        vertex: { module, entryPoint: 'vs_full' }, fragment: { module, entryPoint: entry, targets: [{ format, blend }] },
        primitive: { topology: 'triangle-list' },
      });
    });
  }

  private bindGroup(key: string, a: GPUTextureView, b: GPUTextureView, slot: number): GPUBindGroup {
    let g = this.groups.get(key);
    if (!g) {
      g = this.gpu.device.createBindGroup({
        label: `post:${key}`, layout: this.layout,
        entries: [
          { binding: 0, resource: this.sampler }, { binding: 1, resource: a }, { binding: 2, resource: b },
          { binding: 3, resource: { buffer: this.params, offset: slot * PARAM_STRIDE, size: 64 } },
        ],
      });
      this.groups.set(key, g);
    }
    return g;
  }

  /** Reserve the next parameter slot and fill it. */
  private slot(a: number[], b: number[] = [0, 0, 0, 0], c: number[] = [0, 0, 0, 0], d: number[] = [0, 0, 0, 0]): number {
    const i = this.usedSlots++;
    this.paramData.set([...a, ...b, ...c, ...d], i * (PARAM_STRIDE / 4));
    return i;
  }

  private fullscreen(enc: GPUCommandEncoder, label: string, view: GPUTextureView, pipe: GPURenderPipeline, group: GPUBindGroup, load: boolean): void {
    const pass = enc.beginRenderPass({
      label, colorAttachments: [{ view, loadOp: load ? 'load' : 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(pipe); pass.setBindGroup(0, group); pass.draw(3); pass.end();
  }

  /**
   * Declare the post passes in `g`. Call after the main pass(es), which must write the resource `'sceneColor'`. The final pass
   * writes the swap chain (`'backbuffer'`).
   */
  addPasses(g: RenderGraph): void {
    if (!this.enabled || !this.scene) return;
    const s = this.settings, scene = this.scene;
    const bloomOn = s.bloom.enabled && this.bloomLevels.length > 0;
    const fxaa = s.fxaa && this.ldr !== null;
    this.usedSlots = 0;
    const gpu = this.gpu;
    const levels = this.bloomLevels;
    const reads = ['sceneColor'];

    // Parameter slots are assigned in declaration order so the bind groups (keyed by slot) stay valid across frames.
    type Step = (enc: GPUCommandEncoder) => void;
    const bloomSteps: Step[] = [];
    if (bloomOn) {
      const n = levels.length;
      const pre = this.slot([1 / scene.w, 1 / scene.h, s.bloom.threshold, Math.max(s.bloom.knee, 1e-4)]);
      const gPre = this.bindGroup(`pre:${pre}`, scene.view, this.dummy.view, pre);
      bloomSteps.push((e) => this.fullscreen(e, 'bloom-prefilter', levels[0].view, this.pipeline('fs_prefilter', HDR_FORMAT), gPre, false));
      for (let i = 1; i < n; i++) {
        const sl = this.slot([1 / levels[i - 1].w, 1 / levels[i - 1].h, 0, 0]);
        const grp = this.bindGroup(`down${i}:${sl}`, levels[i - 1].view, this.dummy.view, sl);
        bloomSteps.push((e) => this.fullscreen(e, `bloom-down-${i}`, levels[i].view, this.pipeline('fs_down', HDR_FORMAT), grp, false));
      }
      for (let i = n - 1; i >= 1; i--) {
        const sl = this.slot([s.bloom.radius / levels[i].w, s.bloom.radius / levels[i].h, 0, 0]);
        const grp = this.bindGroup(`up${i}:${sl}`, levels[i].view, this.dummy.view, sl);
        bloomSteps.push((e) => this.fullscreen(e, `bloom-up-${i}`, levels[i - 1].view, this.pipeline('fs_up', HDR_FORMAT, true), grp, true));
      }
      g.addPass({ name: 'post-bloom', reads: ['sceneColor'], writes: ['bloomTex'], execute: (e) => { for (const st of bloomSteps) st(e); } });
      reads.push('bloomTex');
    }

    const comp = this.slot(
      [0, 0, 0, 0],
      [s.exposure, s.bloom.intensity, s.vignette, s.saturation],
      [s.contrast, TONE_MAPPER_ID[s.toneMapper], bloomOn ? 1 : 0, 1 / 255],
      [scene.w / scene.h, 0, 0, 0],
    );
    const gComp = this.bindGroup(`comp:${comp}:${bloomOn}`, scene.view, bloomOn ? levels[0].view : this.dummy.view, comp);
    const compTarget = fxaa ? this.ldr!.view : null;
    g.addPass({
      name: 'post-composite', reads, writes: [fxaa ? 'ldr' : 'backbuffer'], sideEffect: !fxaa,
      execute: (e) => {
        this.fullscreen(e, 'post-composite', compTarget ?? gpu.context.getCurrentTexture().createView(), this.pipeline('fs_composite', gpu.format), gComp, false);
      },
    });

    let fx = -1;
    if (fxaa) {
      fx = this.slot([1 / scene.w, 1 / scene.h, 0, 0]);
      const gFx = this.bindGroup(`fxaa:${fx}`, this.ldr!.view, this.dummy.view, fx);
      g.addPass({
        name: 'post-fxaa', reads: ['ldr'], writes: ['backbuffer'], sideEffect: true,
        execute: (e) => {
          this.fullscreen(e, 'post-fxaa', gpu.context.getCurrentTexture().createView(), this.pipeline('fs_fxaa', gpu.format), gFx, false);
        },
      });
    }
    gpu.queue.writeBuffer(this.params, 0, this.paramData, 0, this.usedSlots * (PARAM_STRIDE / 4));
  }
}
