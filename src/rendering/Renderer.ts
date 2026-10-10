import type { GPUContext } from '../gpu/GPUContext';
import { DynamicBufferAllocator } from '../gpu/DynamicBufferAllocator';
import { createBindLayouts, type BindLayouts } from '../gpu/BindLayouts';
import { MeshManager } from './MeshManager';
import { MaterialManager } from './materials/MaterialManager';
import { countSwitches } from './RenderQueue';
import { ViewState } from './RenderDrawState';
import { OffscreenViews, type ViewJob } from './OffscreenViews';
import { DEPTH_FORMAT } from './formats';
import { INSTANCE_BYTES, INSTANCE_WORDS, buildBatches } from './BatchBuilder';
import { TransformBuffer } from './TransformBuffer';
import { JointMatrixBuffer } from './JointMatrixBuffer';
import { MorphWeightBuffer } from './MorphWeightBuffer';
import { ParticleSystem } from '../particles/ParticleSystem';
import { RibbonSystem, type RibbonSystemConfig } from '../particles/RibbonSystem';
import { LODLibrary, LODSystem } from '../visibility/LODSystem';
import { SceneResources } from './lighting/SceneResources';
import { IBLBaker, type Environment } from './lighting/IBL';
import type { TextureStreamer } from '../streaming/TextureStreamer';
import { StreamingDriver } from '../streaming/StreamingDriver';
import { VolumetricFog, type FogSettings } from './lighting/VolumetricFog';
import { GPUCuller } from './GPUCuller';
import { GPULodIndex } from './GPULodIndex';
import { HiZ } from './HiZ';
import { RenderGraph } from './RenderGraph';
import { GPUProfiler } from '../profiling/GPUProfiler';
import { ShadowSystem } from './shadows/ShadowSystem';
import { PostProcessor, HDR_FORMAT, AUX_FORMAT } from './post/PostProcessor';
import { MaterialFeature } from './materials/MaterialFlags';
import { ClusterGrid } from './lighting/ClusterGrid';
import type { LightData } from './lighting/LightData';
import { LegacySceneLights, DEFAULT_SCENE, type SceneSettings } from './lighting/LegacySceneLights';
import { FrameUniform } from './FrameUniform';
import { Skybox } from './Skybox';
import { TransmissionCopy } from './post/TransmissionCopy';
import { RendererStats } from '../profiling/RendererStats';
import type { RenderWorld } from './RenderWorld';
import { Camera } from './Camera';
import type { RenderTarget, RenderTargetDesc } from './RenderTarget';
import type { RenderView, RenderViewOptions } from './RenderView';
import type { Overlay } from './overlay/Overlay';
import { FeatureRegistry, type RenderFeature, type FeatureFrame, type PostFeatureFrame } from './RenderFeature';
import { LineSystem, type LineSystemOptions } from './overlay/LineSystem';
import { PointSystem, type PointSystemOptions } from './overlay/PointSystem';
import { SpriteSystem, type SpriteSystemOptions } from './overlay/SpriteSystem';
import type { VisibleSet } from '../visibility/VisibilitySystem';

/** Strategy used to turn the visible set into draw calls (benchmark A compares these). */
export type BatchingMode = 'unsorted' | 'sorted' | 'instanced';

export { DEFAULT_SCENE, type SceneSettings };

/**
 * The renderer: RenderWorld -> (visible set) -> render queues -> batches -> a pass graph (shadows, clusters, particles,
 * prepass, GPU culling, fog, main) -> one command buffer per frame.
 * Reads only the RenderWorld. All GPU resources come from the shared managers. Create GPU content through its public members
 * (`meshes`, `materials`, `setEnvironment`, `enableFog`, `enableParticles`, `createRibbonSystem` ...).
 */
export class Renderer {
  readonly stats = new RendererStats();
  readonly layouts: BindLayouts;
  readonly meshes: MeshManager;
  readonly materials: MaterialManager;
  /** Shared joint-matrix pool (written by SkeletonSystem, uploaded here). */
  readonly joints: JointMatrixBuffer;
  readonly morphWeights: MorphWeightBuffer;
  /** GPU particle system (created on demand by enableParticles()). */
  particles: ParticleSystem | null = null;
  /** GPU resources behind bind group 1 (lights, clusters, shadows, environment). */
  readonly sceneResources: SceneResources;
  /** LOD groups, and the CPU LOD selector (run after culling; see applyLOD). */
  readonly lodLibrary: LODLibrary;
  readonly lod: LODSystem;
  /** Ribbon / trail systems (one draw call each). */
  readonly ribbonSystems: RibbonSystem[] = [];
  batching: BatchingMode = 'instanced';
  clearColor = { r: 0.05, g: 0.06, b: 0.09, a: 1 };

  /** Post-processing and anti-aliasing (HDR scene target, bloom, tone mapping, FXAA, MSAA). Off by default: `renderer.post.configure({ ... })`. */
  readonly post: PostProcessor;
  /** Colour / depth target of the particle and ribbon pipelines; mutated in place when the framebuffer configuration changes. */
  private extrasTarget: { colorFormat: GPUTextureFormat; depthFormat: GPUTextureFormat; sampleCount: number };
  private fbKey = '';
  private msaaWarned = false;
  private depthTexture!: GPUTexture;
  private depthView!: GPUTextureView;
  /** Depth-only view of the depth buffer for sampling in post passes (SSAO / SSR). */
  private depthSampleView!: GPUTextureView;
  /** The main view: its target formats, draw state and prepass flag. Off-screen views have their own (see `OffscreenViews`). */
  private readonly mainView: ViewState;
  /** Per-view uniform + bind group 0 (camera, time, viewport, output flags). */
  private frameUniform: FrameUniform;
  private transformBuffer: TransformBuffer;
  private instanceAlloc: DynamicBufferAllocator;

  /** Sun + ambient lights built from `SceneSettings`, used when the scene defines no lights. */
  private legacyLights = new LegacySceneLights();

  /** Create every GPU-side manager for `gpu`: bind layouts, mesh / material managers, transform / joint / morph / instance buffers, scene resources, light clusters, shadows and the profiler. */
  constructor(private gpu: GPUContext) {
    const { device, resources: r } = gpu;
    this.layouts = createBindLayouts(device);
    this.meshes = new MeshManager(device, r.buffers);
    this.materials = new MaterialManager(device, r, this.layouts);
    this.lodLibrary = new LODLibrary(this.meshes);
    this.lod = new LODSystem(this.lodLibrary);
    this.mainView = new ViewState({ colorFormat: gpu.format, depthFormat: DEPTH_FORMAT, sampleCount: 1 }, { prepassTarget: true });
    this.extrasTarget = { colorFormat: gpu.format, depthFormat: DEPTH_FORMAT, sampleCount: 1 };
    this.post = new PostProcessor(gpu);

    this.frameUniform = new FrameUniform(gpu, this.layouts);
    this.sceneResources = new SceneResources(gpu, this.layouts);
    this.skybox = new Skybox(gpu, this.layouts, DEPTH_FORMAT, this.sceneResources);
    const self = this;
    this.offscreen = new OffscreenViews(gpu, this.materials, this.frameUniform, this.sceneResources, {
      renderJob: (job, view, objects, rw) => this.renderJob(job, view, objects, rw),
      get clearColor() { return self.clearColor; },
      get ibl() { return self.ibl; },
    });
    this.transmission = new TransmissionCopy(gpu, this.sceneResources);
    this.streaming = new StreamingDriver(this.materials);
    this.gpuLodIndex = new GPULodIndex(this.lodLibrary);

    this.transformBuffer = new TransformBuffer(device, r.buffers);
    this.joints = new JointMatrixBuffer(device, r.buffers);
    this.morphWeights = new MorphWeightBuffer(device, r.buffers);
    this.instanceAlloc = new DynamicBufferAllocator(device, r.buffers, {
      // 768 = lcm(48-byte instance record, 256-byte storage alignment): every allocation starts at an
      // exact multiple of the record size, so `firstInstance = byteOffset / INSTANCE_BYTES` is always integral.
      label: 'InstanceBuffer', usage: GPUBufferUsage.STORAGE, capacity: 768 * 400, frames: 3, alignment: 768,
    });
    this.sceneResources.setBrdfLut(this.ibl.brdfLut());
    this.clusters = new ClusterGrid(gpu, this.sceneResources);
    this.profiler = new GPUProfiler(gpu.device);
    this.shadows = new ShadowSystem(gpu, this.layouts, this.sceneResources, this.meshes, this.materials);
    this.resize(gpu.canvas.width, gpu.canvas.height);
    this.featureFrame = this.createFeatureFrame();
    // the built-in features run through the same hooks as yours (see FeatureOrder for who runs when)
    for (const f of [this.streaming, this.shadows, this.clusters, this.skybox, this.post]) this.features.add(f);
  }

  /** Clustered forward light assignment (used when ranged lights exist and `clusteredShading` is on). */
  readonly clusters: ClusterGrid;
  /** Shadow maps (cascaded directional + spot). Set `shadows.enabled = false` to skip. */
  readonly shadows: ShadowSystem;
  /** GPU pass timings (timestamp queries; no-op where unsupported). */
  readonly profiler: GPUProfiler;
  /** false = every fragment loops over every light (the naive baseline). */
  get clusteredShading(): boolean { return this.clusters.enabled; }
  set clusteredShading(v: boolean) { this.clusters.enabled = v; }
  /** Render opaque + alpha-masked depth first, then shade each pixel once (depth test 'equal'). */
  depthPrepass = false;
  /**
   * GPU-driven visibility for opaque / alpha-masked batches: 'frustum' = GPU frustum culling + compaction + indirect draws;
   * 'hiz2' additionally occlusion-culls with two phases (draw last frame's visible set, build a depth pyramid from it, test the rest).
   */
  gpuCulling: 'off' | 'frustum' | 'hiz2' = 'off';
  /** Optional texture streaming (mip residency follows on-screen coverage); see `setTextureStreamer`. */
  private streaming: StreamingDriver;
  /** The attached texture streamer, if any. */
  get textureStreamer(): TextureStreamer | null { return this.streaming.streamer; }
  /** Volumetric fog (null until `enableFog`). */
  fog: VolumetricFog | null = null;
  /** With GPU culling on: select LOD levels in the culling shader (batches of LOD-group meshes expand into one draw per level). */
  gpuLOD = false;
  private gpuLodIndex: GPULodIndex;
  private culler: GPUCuller | null = null;
  private hiz: HiZ | null = null;
  private sphereScratch = new Float32Array(4 * 1024);
  /** Per-frame pass graph (ordering + culling of the frame's passes). */
  readonly graph = new RenderGraph();
  private static nextId = 0;
  /** Unique id: bind-group cache keys must not collide between renderers sharing one GPU context. */
  private readonly id = Renderer.nextId++;
  private baker: IBLBaker | null = null;
  private skybox: Skybox;
  /** Off-screen views (mirrors, minimaps, security cameras ...), rendered before the main view every frame. Add with `addView`. */
  private readonly offscreen: OffscreenViews;
  get views(): RenderView[] { return this.offscreen.views; }
  /** Pluggable rendering features (particles, ribbons, overlays and anything added with `addFeature`). */
  private readonly features = new FeatureRegistry();
  /** Handed to the features' hooks; filled in at the start of every frame. */
  private featureFrame!: FeatureFrame;
  private lastTime = 0;
  /** Copy of the opaque scene (HDR, mip chain) that transmissive materials refract. */
  private transmission: TransmissionCopy;
  /** Screen-space transmission runs this frame (post chain on, a transmissive material visible). */
  private transmissionActive = false;
  /** Draw the bound environment as the background (when one is set). */
  get showSkybox(): boolean { return this.skybox.visible; }
  set showSkybox(v: boolean) { this.skybox.visible = v; }

  /** Turn on froxel volumetric fog (light shafts from shadow-mapped lights, height fog). */
  enableFog(settings?: Partial<FogSettings>): VolumetricFog {
    if (!this.fog) this.fog = this.addFeature(new VolumetricFog(this.gpu, this.layouts, this.sceneResources));
    if (settings) Object.assign(this.fog.settings, settings);
    this.fog.enabled = true;
    return this.fog;
  }

  /** Pre-build the main-pass pipelines of all PBR materials (async, no frame hitch). Call after creating materials. */
  warmup(deformMasks: number[] = [0, 1, 2, 3]): Promise<number> {
    this.syncFramebuffer();
    const { mainView } = this;
    return this.materials.warmup(mainView.prepassActive || this.depthPrepass ? mainView.targetPre : mainView.target, deformMasks);
  }

  /** Attach (or detach with null) a texture streamer; materials rebuild their bind groups whenever a streamed texture's resident mips change. */
  setTextureStreamer(s: TextureStreamer | null): void { this.streaming.attach(s); }

  /** Lazily created IBL baker (procedural sky / HDR / BRDF LUT generation). */
  get ibl(): IBLBaker { return (this.baker ??= new IBLBaker(this.gpu)); }

  /** Bind an environment for image-based lighting (null = back to the hemisphere ambient term). */
  setEnvironment(env: Environment | null, intensity = 1, rotation = 0): void {
    this.sceneResources.setEnvironment(env, env ? this.ibl.brdfLut() : undefined, intensity, rotation);
  }

  /** Apply LOD selection to a visible set (no-op when no LOD groups exist). Fills the LOD stats. */
  applyLOD(rw: RenderWorld, visible: VisibleSet | null): VisibleSet | null {
    if (this.lodLibrary.groups.length === 0 || (this.gpuLOD && this.gpuCulling !== 'off')) return visible;   // GPU LOD selects in the culling shader
    const cam = rw.camera;
    const input = visible ?? { slots: null, count: rw.count };
    const out = this.lod.select(rw, input, cam.fovY, cam.position);
    this.pendingLod = true;
    return out;
  }
  private pendingLod = false;

  // ---- lines, points, sprites, text ----------------------------------------------------------------------------------------------

  /** Thick anti-aliased lines + debug-draw helpers (boxes, spheres, axes, grids ...). One draw call per system. */
  createLineSystem(o?: LineSystemOptions): LineSystem {
    this.syncFramebuffer();
    const s = new LineSystem(this.gpu, this.layouts, this.extrasTarget, o);
    this.features.add(s);
    return s;
  }

  /** Screen-facing discs / squares (point clouds), sized in pixels or world units. One draw call per system. */
  createPointSystem(o?: PointSystemOptions): PointSystem {
    this.syncFramebuffer();
    const s = new PointSystem(this.gpu, this.layouts, this.extrasTarget, o);
    this.features.add(s);
    return s;
  }

  /** Textured sprites and text (see `createFont`). One system draws one texture in one draw call. */
  createSpriteSystem(o: SpriteSystemOptions): SpriteSystem {
    this.syncFramebuffer();
    const s = new SpriteSystem(this.gpu, this.layouts, this.extrasTarget, o);
    this.features.add(s);
    return s;
  }

  /** Stop drawing a line / point / sprite system. */
  removeOverlay(o: Overlay): void { this.features.remove(o); }

  // ---- features -----------------------------------------------------------------------------------------------------------------

  /**
   * Plug a {@link RenderFeature} into the frame: it can upload data, add compute / render passes to the graph, draw in the main pass and
   * react to HDR / MSAA changes, without any change to the renderer. Returns the feature.
   */
  addFeature<T extends RenderFeature>(feature: T): T {
    this.gpu.resources.pipelines.unfreeze();   // the feature may create pipelines on first use
    return this.features.add(feature);
  }

  /** Unregister a feature (its GPU resources stay with the feature: destroy them yourself). */
  removeFeature(feature: RenderFeature): boolean { return this.features.remove(feature); }

  /** The object handed to the features' hooks. Its fields are refreshed by `beginFeatureFrame` every frame. */
  private createFeatureFrame(): FeatureFrame {
    return {
      rw: undefined as unknown as RenderWorld, camera: new Camera(), hasCamera: false, time: 0, width: 0, height: 0,
      lights: this.legacyLights.get(DEFAULT_SCENE), visible: null, visibleCount: 0,
      frameBindGroup: this.frameUniform.bindGroup, sceneBindGroup: this.sceneResources.bindGroup, objectBindGroup: () => this.objectBindGroup(),
      target: this.mainView.target, profiler: this.profiler, instances: this.instanceAlloc,
    };
  }

  /** Point the feature frame at this frame's scene (called once the frame's light set is known). */
  private beginFeatureFrame(rw: RenderWorld, time: number, lights: LightData, visible: VisibleSet | null, visibleCount: number): void {
    const f = this.featureFrame;
    f.rw = rw; f.camera = rw.camera; f.hasCamera = rw.hasCamera; f.time = time;
    f.width = this.gpu.canvas.width; f.height = this.gpu.canvas.height;
    f.lights = lights; f.visible = visible; f.visibleCount = visibleCount;
    f.sceneBindGroup = this.sceneResources.bindGroup;
  }

  /** The feature frame plus the HDR scene colour and depth, for post-processing features and the built-in chain. */
  private postFeatureFrame(): PostFeatureFrame {
    const f = this.featureFrame;
    return { ...f, sceneTexture: this.post.sceneTexture, projection: f.camera.projection, depthView: this.depthSampleView, depthSamples: this.mainView.target.sampleCount };
  }

  // ---- render-to-texture: render targets, off-screen views, probe capture (see OffscreenViews) -------------------------------------

  /** Create an off-screen colour + depth buffer for a {@link RenderView} to draw into (see `RenderTarget.ref` for using it as a texture). */
  createRenderTarget(desc: RenderTargetDesc = {}): RenderTarget { return this.offscreen.createRenderTarget(desc); }

  /** Destroy a render target (and the views drawing into it). Remove the materials that sample it first. */
  destroyRenderTarget(t: RenderTarget): void { this.offscreen.destroyRenderTarget(t); }

  /**
   * Register an off-screen render of the scene from another camera. It runs every frame (or every `interval`th) before the main view,
   * in registration order, so a view can show the result of an earlier one.
   */
  addView(o: RenderViewOptions): RenderView { return this.offscreen.addView(o); }

  /** Stop rendering a view (its target stays alive). */
  removeView(v: RenderView): void { this.offscreen.removeView(v); }

  /**
   * Capture a reflection probe: render the scene from `position` into the six faces of a cube map and bake it into an
   * {@link Environment} (diffuse irradiance + prefiltered specular). Use it with `setEnvironment` (image-based lighting for the
   * whole scene). Call between frames with the current `rw`.
   */
  captureEnvironment(rw: RenderWorld, position: ArrayLike<number>, o: { size?: number; near?: number; far?: number; skybox?: boolean; exclude?: (entity: number) => boolean } = {}): Environment {
    return this.offscreen.captureEnvironment(rw, position, o);
  }

  /**
   * Draw `objects` once from `job.camera` into the job's colour / depth views, as a self-contained mini frame: own frame uniform, queues and
   * batches (appended to this frame's instance ring), one command buffer, one submit. Callers restore the main view's uniforms afterwards.
   * Shading is linear HDR (no tone mapping), lighting is the plain light loop (no clusters, no fog volume), shadows are the main view's.
   * Features do not run: no particles, ribbons, overlays or post-processing.
   */
  private renderJob(job: ViewJob, view: ViewState, objects: { slots: Uint32Array | null; count: number }, rw: RenderWorld): void {
    const { device, queue } = this.gpu;
    this.frameUniform.writeView(job.camera, this.lastTime, job.width, job.height, true);   // linear HDR output: the colour is used as a texture; no opaque copy, so views refract the environment
    this.sceneResources.writeViewUniform();
    view.draw.queueBuilder.build(rw, objects.slots, objects.count, this.materials.materials, this.meshes.records, job.camera, this.batching === 'unsorted' ? 'none' : 'sorted', view.draw.queues);
    this.buildBatches(view, rw, true);

    const enc = device.createCommandEncoder({ label: 'view' });
    const pass = enc.beginRenderPass({
      label: 'view',
      colorAttachments: [{ view: job.colorView, clearValue: Renderer.srgbToLinear(job.clearColor), loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: job.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
    });
    const total = view.draw.frame.total;
    if (total > 0) this.drawGeometry(pass, view, 'all', 0, 'early');
    if (job.skybox && this.skybox.visible && this.sceneResources.env.enabled) this.skybox.draw(pass, view.target, this.frameUniform.bindGroup, this.sceneResources.bindGroup);
    if (total > 0) this.drawGeometry(pass, view, 'all', 0, 'late');
    pass.end();
    queue.submit([enc.finish()]);
  }

  /** Create the GPU particle system bound to this renderer's frame layout / render target. */
  enableParticles(): ParticleSystem {
    this.syncFramebuffer();
    if (!this.particles) {
      this.particles = new ParticleSystem(this.gpu, this.layouts, this.meshes, this.extrasTarget);
      this.features.add(this.particles);
    }
    return this.particles;
  }

  /** Create a ribbon system (trails, beams/chains, flat streaks) bound to this renderer's frame layout / render target. */
  createRibbonSystem(config: RibbonSystemConfig): RibbonSystem {
    this.syncFramebuffer();
    const rs = new RibbonSystem(this.gpu, this.layouts, this.extrasTarget, config);
    this.features.add(rs);
    this.ribbonSystems.push(rs);
    return rs;
  }

  /**
   * Bring the main targets in line with `post`: HDR vs swap-chain colour format and the MSAA sample count (forced to 1 while
   * in-frame Hi-Z is on, which samples the depth buffer). When anything changed, cached pipelines are dropped and rebuilt on demand.
   */
  private syncFramebuffer(): void {
    const hiz = this.gpuCulling === 'hiz2';
    let samples: number = this.post.settings.msaa;
    if (hiz && samples > 1) {
      if (!this.msaaWarned) { this.msaaWarned = true; console.warn("MSAA is disabled while gpuCulling is 'hiz2' (the Hi-Z pyramid reads a single-sample depth buffer); use post.fxaa instead."); }
      samples = 1;
    }
    const colorFormat = this.post.enabled ? HDR_FORMAT : this.gpu.format;
    const key = colorFormat + '|' + samples;
    if (key === this.fbKey) return;
    const first = this.fbKey === '';
    this.fbKey = key;
    this.mainView.retarget(colorFormat, samples);
    this.extrasTarget.colorFormat = colorFormat; this.extrasTarget.sampleCount = samples;
    this.features.retarget();
    if (!first) {
      this.gpu.resources.pipelines.unfreeze();      // a deliberate configuration change is not a steady-state violation
      if (this.depthTexture) this.resize(this.gpu.canvas.width, this.gpu.canvas.height);
    }
  }

  /** Recreate the depth buffer for a `width` x `height` backbuffer (called by the app on canvas resize; `render` also self-corrects). */
  resize(width: number, height: number): void {
    const { resources: r } = this.gpu;
    if (this.depthTexture) r.textures.destroy(this.depthTexture);
    this.depthTexture = r.textures.create({
      label: 'depth', size: [Math.max(1, width), Math.max(1, height)], format: DEPTH_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, sampleCount: this.mainView.target.sampleCount,
    });
    this.depthView = this.depthTexture.createView();
    this.depthSampleView = this.depthTexture.createView({ aspect: 'depth-only' });
  }

  /** Pipeline for (material, mesh deform variant) in `view`; cached per pair to avoid rebuilding key strings per batch. */
  private pipelineFor(view: ViewState, materialId: number, deformMask: number): GPURenderPipeline {
    if (view.prepassActive) return this.materials.getPipeline(materialId, view.targetPre, deformMask);
    return view.draw.pipelines.get(this.materials, view.target, materialId, deformMask);
  }

  /** Bind group 3 (transforms, instance records, joints, morph data). `culled` selects the GPU-compacted instance buffer; cached by buffer generations so it is rebuilt only when a buffer is recreated. */
  private objectBindGroup(culled = false): GPUBindGroup {
    const { resources: r, device } = this.gpu;
    const m = this.meshes;
    const instBuf = culled ? this.culler!.instanceBuffer : this.instanceAlloc.buffer;
    const key = `object:r${this.id}:t${this.transformBuffer.generation}:${culled ? 'c' + this.culler!.instanceGeneration : 'i' + this.instanceAlloc.generation}:j${this.joints.generation}`
      + `:w${this.morphWeights.generation}:m${m.generation}`;
    return r.bindGroups.get(key, () => device.createBindGroup({
      label: key, layout: this.layouts.object,
      entries: [
        { binding: 0, resource: { buffer: this.transformBuffer.buffer } },
        { binding: 1, resource: { buffer: instBuf } },
        { binding: 2, resource: { buffer: this.joints.buffer } },
        { binding: 3, resource: { buffer: this.morphWeights.buffer } },
        { binding: 4, resource: { buffer: m.deform.buffer } },
      ],
    }));
  }

  /**
   * Render one frame from the RenderWorld. Phases: upload per-frame GPU data -> sort into queues -> build batches
   * (instance records) -> record the pass graph -> submit.
   * @param rw extracted render data (camera, objects, lights)
   * @param scene legacy sun/ambient, used only when `rw` contains no lights
   * @param time seconds, forwarded to shaders (`frame.cameraPosition.w`) and particle/shadow passes
   * @param visible CPU visibility result; `null` = draw every object
   */
  render(rw: RenderWorld, scene: SceneSettings = DEFAULT_SCENE, time = 0, visible: VisibleSet | null = null): void {
    const { device, queue } = this.gpu;
    const st = this.stats;
    this.syncFramebuffer();
    if (this.depthTexture.width !== this.gpu.canvas.width || this.depthTexture.height !== this.gpu.canvas.height || this.depthTexture.sampleCount !== this.mainView.target.sampleCount) this.resize(this.gpu.canvas.width, this.gpu.canvas.height);   // keep depth matched to the swapchain
    this.post.ensureTargets(this.gpu.canvas.width, this.gpu.canvas.height, this.mainView.target.sampleCount);
    st.reset();
    const t0 = performance.now();
    const vCount = visible ? visible.count : rw.count;
    st.renderables = rw.count;
    st.visible = vCount;
    st.frustumTested = visible?.tested ?? 0;
    st.frustumRejected = visible?.rejected ?? 0;
    st.cpu.culling = visible?.cullMs ?? 0;
    if (this.pendingLod) { st.lodCounts.set(this.lod.counts); st.lodCulled = this.lod.culled; this.pendingLod = false; }

    this.lastTime = time;
    this.uploadFrameData(rw, scene, time, visible, vCount);
    const t1 = performance.now();
    st.cpu.upload = t1 - t0;

    this.mainView.draw.queueBuilder.build(rw, visible ? visible.slots : null, vCount, this.materials.materials, this.meshes.records, rw.camera,
      this.batching === 'unsorted' ? 'none' : 'sorted', this.mainView.draw.queues);
    const t2 = performance.now();
    st.cpu.sorting = t2 - t1;

    this.buildBatches(this.mainView, rw);
    const t3 = performance.now();
    st.cpu.batching = t3 - t2;
    this.transmissionActive = this.post.enabled && this.mainView.draw.frame.transmissive && rw.hasCamera && !(this.mainView.draw.frame.gpuCull && this.gpuCulling === 'hiz2');
    if (this.transmissionActive) this.transmission.ensure(this.gpu.canvas.width, this.gpu.canvas.height);
    this.frameUniform.setTransmission(this.transmissionActive, this.transmission.maxMip);
    this.offscreen.renderDue(rw);

    const enc = device.createCommandEncoder();
    this.profiler.beginFrame();
    this.featureFrame.sceneBindGroup = this.sceneResources.bindGroup;   // may have been rebuilt while the frame was prepared
    this.features.prepare(this.featureFrame);
    this.recordPasses(enc, rw);
    this.profiler.resolve(enc);
    queue.submit([enc.finish()]);
    this.features.endFrame();
    const t4 = performance.now();
    st.cpu.encoding = t4 - t3;
    st.cpu.total = t4 - t0;
  }

  /**
   * Upload everything that changes per frame except instance records: frame uniform, lights/shadows/clusters/fog,
   * transforms (sparse), joint matrices, morph weights and dirty materials. Fills the related stats.
   */
  private uploadFrameData(rw: RenderWorld, scene: SceneSettings, time: number, visible: VisibleSet | null, vCount: number): void {
    const st = this.stats, cam = rw.camera;
    this.frameUniform.writeView(cam, time, this.gpu.canvas.width, this.gpu.canvas.height, this.post.enabled);   // the transmission flags are set once the batches are known (see render)
    // Lights come from the ECS (rw.lights). If the scene defines none, fall back to the legacy SceneSettings sun + ambient.
    let L = rw.lights;
    if (L.count === 0 && L.ambientSky[0] === 0 && L.ambientSky[1] === 0 && L.ambientSky[2] === 0) L = this.legacyLights.get(scene);
    this.beginFeatureFrame(rw, time, L, visible, vCount);
    this.features.beginFrame(this.featureFrame);   // shadow slots, cluster / fog grids, texture coverage: everything the scene uniform below carries
    this.sceneResources.syncLights(L);
    const useClusters = this.clusters.active;
    this.sceneResources.writeUniform({
      lightCount: L.count, globalCount: L.globalCount, clustered: useClusters, clusterDims: useClusters ? this.clusters.dims : undefined, clusterTileSize: this.clusters.config.tileSize,
      clusterNear: cam.near, clusterFar: cam.far, ambientSky: L.ambientSky, ambientGround: L.ambientGround,
      shadowEnabled: this.shadows.layers.length > 0, shadowCascades: this.shadows.cascadeCount, cascadeSplits: Array.from(this.shadows.splits),
      shadowPcfRadius: this.shadows.config.pcfRadius, shadowNormalBias: this.shadows.config.normalBias,
      shadowMapSize: this.shadows.config.mapSize, shadowDepthBias: this.shadows.config.depthBias,
    });
    st.lighting.lights = L.count; st.lighting.globalLights = L.globalCount; st.lighting.clustered = useClusters; st.lighting.clusters = useClusters ? this.clusters.clusterCount : 0;
    this.transformBuffer.sync(rw);
    this.joints.beginFrame();
    this.joints.flush();
    this.morphWeights.sync(rw);
    this.materials.flush();
    st.transformUploadBytes = this.transformBuffer.lastUploadBytes;
    st.transformUploadRanges = this.transformBuffer.lastUploadRanges;
    st.animation.jointUploadBytes = this.joints.uploadBytes;
    st.animation.morphUploadBytes = this.morphWeights.uploadBytes;
    st.animation.activeMorphStates = rw.morph.activeStates;
    st.animation.activeMorphTargets = rw.morph.activeTargets;
  }

  /**
   * Turn the sorted queues into batches (one per mesh+material run) and write their instance records straight into the
   * per-frame ring buffer; also prepares GPU culling and shadow caster data and counts state switches.
   * Results are stored in `view.draw.frame` for the draw / pass recording. `offscreen` views append to the current frame's instance region and
   * skip everything that belongs to the main view (GPU culling, shadow casters, stats).
   */
  private buildBatches(view: ViewState, rw: RenderWorld, offscreen = false): void {
    const st = this.stats;
    const draw = view.draw, lists = draw.queues.ordered;
    const total = lists[0].count + lists[1].count + lists[2].count;
    if (!offscreen) this.instanceAlloc.beginFrame();
    const byteOffset = this.instanceAlloc.allocate(Math.max(total, 1) * INSTANCE_BYTES);
    if (byteOffset % INSTANCE_BYTES !== 0) throw new Error('instance buffer offset is not record-aligned');
    const local = this.instanceAlloc.localOffset(byteOffset) / 4;
    const instData = this.instanceAlloc.uint32.subarray(local, local + total * INSTANCE_WORDS);
    const gpuCull = !offscreen && this.gpuCulling !== 'off' && rw.hasCamera && total > 0;
    if (gpuCull && this.sphereScratch.length < total * 4) this.sphereScratch = new Float32Array(Math.max(total * 4, this.sphereScratch.length * 2));
    buildBatches(lists, rw, this.meshes.records, instData, byteOffset / INSTANCE_BYTES, this.batching === 'instanced' ? 'instanced' : 'individual', draw.batches, gpuCull ? this.sphereScratch : undefined);
    // GPU culling covers the leading opaque / alpha-mask batches (queue id < 2); transparent batches stay on the CPU path.
    let nCullBatches = 0;
    if (gpuCull) while (nCullBatches < draw.batches.count && draw.batches.queue[nCullBatches] < 2) nCullBatches++;
    const total01 = lists[0].count + lists[1].count;
    if (gpuCull) {
      this.culler ??= new GPUCuller(this.gpu);
      this.culler.prepare(draw.batches, nCullBatches, total01, this.sphereScratch, byteOffset / INSTANCE_BYTES, this.meshes, this.gpuLOD ? (m) => this.gpuLodIndex.groupOf(m) : undefined);
    }
    if (!offscreen) this.features.buildInstances(this.featureFrame);   // shadow casters
    this.instanceAlloc.flush();
    if (!offscreen) st.bufferUploadBytes = this.instanceAlloc.bytesUploadedThisFrame + this.transformBuffer.lastUploadBytes;
    if (!offscreen && this.batching !== 'unsorted') {
      for (const l of lists) {
        const c = countSwitches(l, rw, this.materials.materials, this.meshes.records);
        st.pipelineSwitches += c.pipeline; st.materialSwitches += c.material; st.meshSwitches += c.mesh;
      }
    }
    const f = draw.frame;
    f.total = total; f.total01 = total01; f.byteOffset = byteOffset; f.instData = instData; f.gpuCull = gpuCull; f.nCullBatches = nCullBatches;
    this.markLateBatches(view);
  }

  /** Flag the batches drawn after the opaque geometry + sky (blended surfaces, transmissive materials) and note whether transmission is needed. */
  private markLateBatches(view: ViewState): void {
    const b = view.draw.batches, mats = this.materials.materials;
    if (b.late.length < b.count) b.late = new Uint8Array(Math.max(b.count, b.late.length * 2));
    let transmissive = false;
    for (let i = 0; i < b.count; i++) {
      const t = b.queue[i] < 2 && (mats[b.materialId[i]].features & MaterialFeature.Transmission) !== 0;
      b.late[i] = b.queue[i] === 2 || t ? 1 : 0;
      if (t) transmissive = true;
    }
    view.draw.frame.transmissive = transmissive;
  }

  /**
   * Declare this frame's passes in the render graph (shadows, clusters, particles, prepass, culling, fog, main pass(es)),
   * then compile and execute it into `enc`. The graph orders passes by their declared reads/writes and drops unused ones.
   */
  private recordPasses(enc: GPUCommandEncoder, rw: RenderWorld): void {
    const f = this.mainView.draw.frame;
    const g = this.graph;
    g.reset();
    this.features.addPasses(g, this.featureFrame);
    const twoPhase = f.gpuCull && this.gpuCulling === 'hiz2';
    // (two-phase culling builds its own depth in main-A and clears it, so a prepass would only switch the pipelines to depth 'equal' and break the image)
    const prepass = this.depthPrepass && !twoPhase && rw.hasCamera && f.total > 0;
    this.mainView.prepassActive = prepass;
    if (prepass) this.addDepthPrepass(g);
    if (f.gpuCull) this.addCullingPasses(g, rw, twoPhase);
    if (twoPhase) this.addTwoPhaseMainPasses(g, rw);
    else this.addMainPass(g, rw, prepass);
    if (this.post.needsAux) this.addAuxPass(g, rw);
    if (this.post.enabled) this.features.addPostPasses(g, this.postFeatureFrame());   // user effects first, then the built-in chain
    g.compile();
    g.execute(enc);
  }

  /**
   * After the main pass: redraw opaque + alpha-masked PBR batches into the aux target (view-space normal, roughness, metallic) against
   * the finished depth buffer. SSAO and SSR read it; pixels it does not cover (custom shaders, sky) fall back to depth-derived normals / no reflection.
   */
  private addAuxPass(g: RenderGraph, rw: RenderWorld): void {
    g.addPass({ name: 'aux', reads: ['sceneColor'], writes: ['auxTex'], execute: (enc) => {
      const ap = enc.beginRenderPass({
        label: 'aux', colorAttachments: [this.post.auxColorAttachment()],
        depthStencilAttachment: { view: this.depthView, depthReadOnly: true },
      });
      if (rw.hasCamera && this.mainView.draw.frame.total > 0) {
        ap.setBindGroup(0, this.frameUniform.bindGroup); ap.setBindGroup(1, this.sceneResources.bindGroup); ap.setBindGroup(3, this.objectBindGroup());
        ap.setVertexBuffer(0, this.meshes.vertexBuffer); ap.setIndexBuffer(this.meshes.indexBuffer, 'uint32');
        let pp: GPURenderPipeline | null = null, pm = -1;
        const b = this.mainView.draw.batches;
        for (let i = 0; i < b.count; i++) {
          if (b.queue[i] > 1) continue;   // blended surfaces have no depth to reflect from or occlude with
          const mesh = this.meshes.get(b.meshId[i]);
          const pipe = this.materials.getAuxPipeline(b.materialId[i], mesh.deformMask, this.mainView.target.depthFormat ?? DEPTH_FORMAT, this.mainView.target.sampleCount, AUX_FORMAT);
          if (!pipe) continue;
          if (pipe !== pp) { ap.setPipeline(pipe); pp = pipe; }
          if (b.materialId[i] !== pm) { ap.setBindGroup(2, this.materials.getBindGroup(b.materialId[i])); pm = b.materialId[i]; }
          ap.drawIndexed(mesh.indexCount, b.instanceCount[i], mesh.firstIndex, mesh.baseVertex, b.firstInstance[i]);
        }
      }
      ap.end();
    } });
  }

  /** Depth-only pass over opaque + alpha-masked batches (lets the main pass shade each pixel once, and feeds the in-frame Hi-Z). */
  private addDepthPrepass(g: RenderGraph): void {
    g.addPass({ name: 'depth-prepass', writes: ['depth'], execute: (enc) => {
      const dp = enc.beginRenderPass({
        label: 'depth-prepass', colorAttachments: [], timestampWrites: this.profiler.writes('prepass'),
        depthStencilAttachment: { view: this.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      dp.setBindGroup(0, this.frameUniform.bindGroup); dp.setBindGroup(1, this.sceneResources.bindGroup); dp.setBindGroup(3, this.objectBindGroup());
      dp.setVertexBuffer(0, this.meshes.vertexBuffer); dp.setIndexBuffer(this.meshes.indexBuffer, 'uint32');
      let pp: GPURenderPipeline | null = null, pm = -1;
      const b = this.mainView.draw.batches;
      for (let i = 0; i < b.count; i++) {
        if (b.queue[i] > 1) continue;   // transparent surfaces never write depth
        const mesh = this.meshes.get(b.meshId[i]);
        const pipe = this.materials.getPrepassPipeline(b.materialId[i], mesh.deformMask, this.mainView.target.depthFormat ?? DEPTH_FORMAT, this.mainView.target.sampleCount);
        if (pipe !== pp) { dp.setPipeline(pipe); pp = pipe; }
        if (b.materialId[i] !== pm) { dp.setBindGroup(2, this.materials.getBindGroup(b.materialId[i])); pm = b.materialId[i]; }
        dp.drawIndexed(mesh.indexCount, b.instanceCount[i], mesh.firstIndex, mesh.baseVertex, b.firstInstance[i]);
      }
      dp.end();
    } });
  }

  /** Arguments describing the Hi-Z pyramid for the culling shader. */
  private hizArg() { return { view: this.hiz!.fullView!, width: this.hiz!.width, height: this.hiz!.height, mips: this.hiz!.mips }; }

  /**
   * GPU visibility passes. `hiz2` (two-phase): cull-A against last frame's visibility (cull-B is added with the main passes).
   * `frustum`: frustum cull only.
   */
  private addCullingPasses(g: RenderGraph, rw: RenderWorld, twoPhase: boolean): void {
    const cam = rw.camera, f = this.mainView.draw.frame;
    const srcBase = f.byteOffset / INSTANCE_BYTES;
    if (twoPhase) {
      this.hiz ??= new HiZ(this.gpu);
      this.hiz.resize(this.gpu.canvas.width, this.gpu.canvas.height);
      let maxObj = 0;
      for (let i = 0; i < f.total01; i++) maxObj = Math.max(maxObj, f.instData[i * INSTANCE_WORDS + 6]);
      this.culler!.ensureVisibility(maxObj + 1);
      g.addPass({ name: 'cull-A', reads: [], writes: ['culledA'],
        execute: (e) => this.culler!.encode(e, this.instanceAlloc.buffer, srcBase, cam.frustum.planes, cam.viewProjection, null, this.profiler.writes('cullA'), 1, cam) });
    } else {
      g.addPass({
        name: 'gpu-cull', reads: [], writes: ['culled'],
        execute: (e) => this.culler!.encode(e, this.instanceAlloc.buffer, srcBase, cam.frustum.planes, cam.viewProjection, null, this.profiler.writes('cull'), 0, cam),
      });
    }
  }

  /**
   * Draw loop for opaque / alpha batches. With GPU culling, `'culled'` issues one indirect draw per (batch, LOD level) from the
   * compacted set (arguments start at `argBase`), `'rest'` draws the batches the GPU path does not cover, `'all'` does both.
   * Without GPU culling every batch is drawn directly.
   */
  private drawGeometry(pass: GPURenderPassEncoder, view: ViewState, which: 'all' | 'culled' | 'rest', argBase: number, part: 'all' | 'early' | 'late' = 'all'): void {
    const f = view.draw.frame, st = this.stats, gpuCull = f.gpuCull;
    const mats = this.materials.materials;
    /** early = opaque / alpha-masked geometry, late = blended + transmissive (drawn after the sky and, with transmission, after the opaque copy). */
    const skip = (late: boolean): boolean => (part === 'early' && late) || (part === 'late' && !late);
    pass.setBindGroup(0, this.frameUniform.bindGroup);
    pass.setBindGroup(1, this.sceneResources.bindGroup);
    pass.setBindGroup(3, gpuCull && which !== 'rest' ? this.objectBindGroup(true) : this.objectBindGroup());
    pass.setVertexBuffer(0, this.meshes.vertexBuffer);
    pass.setIndexBuffer(this.meshes.indexBuffer, 'uint32');
    let curPipe: GPURenderPipeline | null = null, curMat = -1;
    /** Set the pipeline and material bind group only when they differ from the previously bound ones. */
    const bind = (matId: number, deformMask: number): void => {
      const pipe = this.pipelineFor(view, matId, deformMask);
      if (pipe !== curPipe) { pass.setPipeline(pipe); curPipe = pipe; }
      if (matId !== curMat) { pass.setBindGroup(2, this.materials.getBindGroup(matId)); curMat = matId; }
    };
    if (gpuCull && which !== 'rest') {
      // GPU-compacted draws: one indirect draw per (batch, LOD level)
      const cu = this.culler!;
      for (let v = 0; v < cu.virtualCount; v++) {
        if (skip((mats[cu.virtualMaterial[v]].features & MaterialFeature.Transmission) !== 0)) continue;
        bind(cu.virtualMaterial[v], this.meshes.get(cu.virtualMesh[v]).deformMask);
        pass.drawIndexedIndirect(cu.argsBuffer, (argBase + v) * 20);
        st.drawCalls++;
      }
    }
    if (which === 'culled') return;
    if (gpuCull && which === 'all') pass.setBindGroup(3, this.objectBindGroup());   // remaining batches use the uncompacted records
    const b = view.draw.batches;
    let curMesh = -1;
    for (let i = gpuCull ? f.nCullBatches : 0; i < b.count; i++) {
      if (skip(b.late[i] === 1)) continue;
      const matId = b.materialId[i];
      const meshId = b.meshId[i];
      const mesh = this.meshes.get(meshId);
      const pipe = this.pipelineFor(view, matId, mesh.deformMask);
      if (pipe !== curPipe) { pass.setPipeline(pipe); curPipe = pipe; if (this.batching === 'unsorted') st.pipelineSwitches++; }
      if (matId !== curMat) { pass.setBindGroup(2, this.materials.getBindGroup(matId)); curMat = matId; if (this.batching === 'unsorted') st.materialSwitches++; }
      if (this.batching === 'unsorted' && meshId !== curMesh) st.meshSwitches++;
      curMesh = meshId;
      pass.drawIndexed(mesh.indexCount, b.instanceCount[i], mesh.firstIndex, mesh.baseVertex, b.firstInstance[i]);
      st.drawCalls++;
      st.instances += b.instanceCount[i];
      st.triangles += (mesh.indexCount / 3) * b.instanceCount[i];
    }
  }

  /** Graph resources the main pass(es) read: whatever the features' passes produce (shadow map, cluster grid, fog volume, particles ...). */
  private get mainReads(): readonly string[] { return this.features.producedResources; }

  /** Name of the graph resource the main pass(es) produce: the swap chain, or the HDR scene target when the post chain is on. */
  private get colorResource(): string { return this.post.enabled ? 'sceneColor' : 'backbuffer'; }

  /** Clear colour as the main pass target expects it (the HDR target holds linear values, the swap chain sRGB-encoded ones). */
  private mainClearValue(): GPUColor {
    return this.post.enabled ? Renderer.srgbToLinear(this.clearColor) : this.clearColor;
  }

  /** sRGB-encoded colour -> linear (HDR targets hold linear values). */
  private static srgbToLinear(c: { r: number; g: number; b: number; a: number }): GPUColor {
    const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return { r: lin(c.r), g: lin(c.g), b: lin(c.b), a: c.a };
  }

  /** Colour attachment of the main pass: swap chain or HDR scene target, through the multisampled buffer (resolved) when MSAA is on. */
  private mainColorAttachment(clear: boolean, keepMsaa = false): GPURenderPassColorAttachment {
    const final = this.post.enabled ? this.post.sceneView : this.gpu.context.getCurrentTexture().createView();
    const loadOp = clear ? 'clear' : 'load';
    if (this.mainView.target.sampleCount > 1) return { view: this.post.msaaView, resolveTarget: final, clearValue: this.mainClearValue(), loadOp, storeOp: keepMsaa ? 'store' : 'discard' };
    return { view: final, clearValue: this.mainClearValue(), loadOp, storeOp: 'store' };
  }

  /** The standard single main pass: clear (or load the prepass depth), draw geometry, then skybox / particles / ribbons. */
  private addMainPass(g: RenderGraph, rw: RenderWorld, prepass: boolean): void {
    const geometry = (pass: GPURenderPassEncoder, part: 'early' | 'late'): void => {
      if (rw.hasCamera && this.mainView.draw.frame.total > 0) this.drawGeometry(pass, this.mainView, 'all', 0, part);
    };
    const depthAttachment = (load: boolean): GPURenderPassDepthStencilAttachment => (
      { view: this.depthView, depthClearValue: 1, depthLoadOp: load ? 'load' : 'clear', depthStoreOp: 'store' });
    if (!this.transmissionActive) {
      // opaque + alpha-masked, then the sky, then blended / transmissive surfaces, then particles / ribbons / overlays
      g.addPass({ name: 'main', reads: [...this.mainReads, 'depth', 'culled'], writes: [this.colorResource], sideEffect: !this.post.enabled, execute: (enc) => {
        const pass = enc.beginRenderPass({
          label: 'main', timestampWrites: this.profiler.writes('main'),
          colorAttachments: [this.mainColorAttachment(true)], depthStencilAttachment: depthAttachment(prepass),
        });
        geometry(pass, 'early');
        this.features.drawBackdrop(pass, this.featureFrame);
        geometry(pass, 'late');
        this.features.drawMain(pass, this.featureFrame);   // particles, ribbons, overlays, custom features
        pass.end();
      } });
      return;
    }
    // Screen-space transmission: finish the opaque scene + sky, copy it (with mips), then draw what refracts it.
    g.addPass({ name: 'main-opaque', reads: [...this.mainReads, 'depth', 'culled'], writes: ['sceneColor'], execute: (enc) => {
      const pass = enc.beginRenderPass({
        label: 'main-opaque', timestampWrites: this.profiler.writes('main'),
        colorAttachments: [this.mainColorAttachment(true, true)], depthStencilAttachment: depthAttachment(prepass),
      });
      geometry(pass, 'early');
      this.features.drawBackdrop(pass, this.featureFrame);
      pass.end();
    } });
    g.addPass({ name: 'transmission-copy', reads: ['sceneColor'], writes: ['transmissionTex'], execute: (enc) => this.transmission.copyFrom(enc, this.post.sceneTexture) });
    g.addPass({ name: 'main-late', reads: ['transmissionTex', ...this.features.producedResources], writes: ['sceneColor'], execute: (enc) => {
      const pass = enc.beginRenderPass({
        label: 'main-late', colorAttachments: [this.mainColorAttachment(false)], depthStencilAttachment: depthAttachment(true),
      });
      geometry(pass, 'late');
      this.features.drawMain(pass, this.featureFrame);   // particles, ribbons, overlays, custom features
      pass.end();
    } });
  }

  /**
   * Two-phase occlusion culling (`hiz2`). Phase A draws what was visible last frame (clears the targets); the depth is turned into a
   * Hi-Z pyramid; cull-B tests everything else against it; phase B draws the newly visible rest (loads the targets) plus extras.
   */
  private addTwoPhaseMainPasses(g: RenderGraph, rw: RenderWorld): void {
    const cam = rw.camera, f = this.mainView.draw.frame;
    const srcBase = f.byteOffset / INSTANCE_BYTES;
    g.addPass({ name: 'main-A', reads: [...this.mainReads, 'culledA'], writes: ['depth', 'color'], execute: (enc) => {
      const pass = enc.beginRenderPass({
        label: 'main-A', timestampWrites: this.profiler.writes('mainA'),
        colorAttachments: [this.mainColorAttachment(true)],
        depthStencilAttachment: { view: this.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      if (f.total > 0) this.drawGeometry(pass, this.mainView, 'culled', 0);
      pass.end();
    } });
    g.addPass({ name: 'hiz-build', reads: ['depth'], writes: ['hizTex'], execute: (e) => this.hiz!.encode(e, this.depthView, this.profiler.writes('hiz')) });
    g.addPass({ name: 'cull-B', reads: ['hizTex'], writes: ['culledB'],
      execute: (e) => this.culler!.encode(e, this.instanceAlloc.buffer, srcBase, cam.frustum.planes, cam.viewProjection, this.hizArg(), this.profiler.writes('cullB'), 2, cam) });
    g.addPass({ name: 'main-B', reads: ['culledB', 'depth', 'color', ...this.features.producedResources], writes: [this.colorResource], sideEffect: !this.post.enabled, execute: (enc) => {
      const pass = enc.beginRenderPass({
        label: 'main-B', timestampWrites: this.profiler.writes('mainB'),
        colorAttachments: [this.mainColorAttachment(false)],
        depthStencilAttachment: { view: this.depthView, depthLoadOp: 'load', depthStoreOp: 'store' },
      });
      // same order as the single main pass: opaque (GPU-culled), sky, then the blended batches the GPU path does not cover, then extras.
      // (Drawing the sky last would paint over blended surfaces that sit in front of it: they write no depth.)
      if (f.total > 0) this.drawGeometry(pass, this.mainView, 'culled', this.culler!.virtualCount);
      this.features.drawBackdrop(pass, this.featureFrame);
      if (f.total > 0) this.drawGeometry(pass, this.mainView, 'rest', 0);
      this.features.drawMain(pass, this.featureFrame);   // particles, ribbons, overlays, custom features
      pass.end();
    } });
  }
}
