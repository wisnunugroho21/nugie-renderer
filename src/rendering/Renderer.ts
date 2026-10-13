import type { GPUContext } from '../gpu/GPUContext';
import { DynamicBufferAllocator } from '../gpu/DynamicBufferAllocator';
import { createBindLayouts, type BindLayouts } from '../gpu/BindLayouts';
import { MeshManager } from './MeshManager';
import { MaterialManager } from './materials/MaterialManager';
import { countSwitches } from './RenderQueue';
import { ViewState } from './RenderDrawState';
import { OffscreenViews, type ViewHost } from './OffscreenViews';
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
import { FrameGraph, type FrameBuilder } from './graph/FrameGraph';
import { declareMainPass, srgbToLinear, type MainPassOptions, type MainPassSegment } from './MainPassNode';
import type { TextureHandle } from './graph/TechniqueBuilder';
import { TrackedRenderPass } from './graph/TrackedRenderPass';
import { GPUProfiler } from '../profiling/GPUProfiler';
import { ShadowSystem } from './shadows/ShadowSystem';
import { PostProcessor, HDR_FORMAT, AUX_FORMAT } from './post/PostProcessor';
import { MaterialFeature } from './materials/MaterialFlags';
import { STANDARD_VARIANT, drawVariant, isSpecialized, type DrawVariant } from './materials/DrawVariant';
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

/** Which half of the main view's geometry a draw call covers: opaque + alpha-mask ('early'), blended + transmissive ('late'), or everything. */
type DrawPart = 'all' | 'early' | 'late';

/** The draw path chosen for a view this frame (see `Renderer.resolveDrawPath`). */
interface DrawPath {
  retained: boolean;
  directional: boolean;
  variant: DrawVariant;
  /** Group-1 bind group: the full scene resources, or the small directional-lights-only group. */
  sceneGroup: GPUBindGroup;
}

/** The pipeline / material currently bound on an encoder, so redundant binds can be skipped. */
interface BoundState { pipeline: GPURenderPipeline | null; material: number; }

/** True when `part` excludes a batch (`late`: drawn after the sky, i.e. blended or transmissive). */
function isSkippedPart(part: DrawPart, late: boolean): boolean {
  return (part === 'early' && late) || (part === 'late' && !late);
}

/** Strategy used to turn the visible set into draw calls (benchmark A compares these). */
export type BatchingMode = 'unsorted' | 'sorted' | 'instanced';

export { DEFAULT_SCENE, type SceneSettings };

/** The attachments of the frame, as handles of the frame technique. */
interface FrameTargets { image: TextureHandle; msaa: TextureHandle | null; depth: TextureHandle }

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
  /** Reuse versioned extraction data when visibility, LOD and draw dependencies allow it. Disable for A/B profiling. */
  cacheDraws = true;
  /** Optional packed instance attributes/cofactor normals. Off by default; profile on the target GPU before enabling. */
  retainedVertex = false;
  /** Exact base-PBR lighting variant when only directional lights and ambient are active. */
  retainedLighting = true;
  /** Reuse geometry commands for retained rigid instances. */
  retainedBundles = true;
  private directionalLighting = false;
  clearColor = { r: 0.05, g: 0.06, b: 0.09, a: 1 };

  /** Post-processing and anti-aliasing (HDR scene target, bloom, tone mapping, FXAA, MSAA). Off by default: `renderer.post.configure({ ... })`. */
  readonly post: PostProcessor;
  /** Colour / depth target of the particle and ribbon pipelines; mutated in place when the framebuffer configuration changes. */
  private extrasTarget: { colorFormat: GPUTextureFormat; depthFormat: GPUTextureFormat; sampleCount: number };
  private fbKey = '';
  private msaaWarned = false;
  private depthTexture!: GPUTexture;
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
    this.frame = new FrameGraph(gpu, 'frame', { hostLayouts: { frame: this.layouts.frame, scene: this.layouts.scene } });
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
    this.offscreen = new OffscreenViews(gpu, this.layouts, this.materials, this.frameUniform, this.sceneResources, this.viewHost());
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
  /** The render world of the frame being recorded (the aux pass's draw callback reads it). */
  private passRenderWorld: RenderWorld | null = null;
  private sphereScratch = new Float32Array(4 * 1024);
  /** The frame's passes as one technique of callback nodes (ordering + culling of the frame's passes; the plan is reused while the passes stay the same). */
  readonly frame: FrameGraph;
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
    return this.materials.warmup(mainView.prepassActive || this.depthPrepass ? mainView.targetPre : mainView.target, deformMasks, {
      directional: this.cacheDraws && this.retainedLighting && this.gpuCulling === 'off', packed: this.cacheDraws && this.retainedVertex,
    });
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
  removeOverlay(o: Overlay): void { this.removeFeature(o); }

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
  removeFeature(feature: RenderFeature): boolean {
    if (!this.features.remove(feature)) return false;
    feature.dispose?.();
    return true;
  }

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
    return { ...f, sceneTexture: this.post.sceneTexture, projection: f.camera.projection, depthView: this.depthSampleView, depthTexture: this.depthTexture, depthSamples: this.mainView.target.sampleCount };
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

  /** What the off-screen views need from the renderer: its clear colour and baker, and ways to build a view's batches and to record its geometry and sky. */
  private viewHost(): ViewHost {
    const self = this;
    return {
      get clearColor() { return self.clearColor; },
      get ibl() { return self.ibl; },
      get time() { return self.lastTime; },
      buildBatches: (job, view, objects, rw) => {
        view.draw.queueBuilder.build(rw, objects.slots, objects.count, this.materials.materials, this.meshes.records, job.camera, this.batching === 'unsorted' ? 'none' : 'sorted', view.draw.queues);
        this.buildBatches(view, rw, true);   // appended to this frame's instance ring
      },
      drawGeometry: (pass, view, part) => this.drawGeometry(pass, view, 'all', 0, part),
      drawSky: (pass, job, view, frameBG, sceneBG) => {
        if (job.skybox && this.skybox.visible && this.sceneResources.env.enabled) this.skybox.draw(pass, view.target, frameBG, sceneBG);
      },
    };
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
    this.depthSampleView = this.depthTexture.createView({ aspect: 'depth-only' });
  }

  /** Pipeline for (material, mesh deform variant, draw path) in `view`; cached per combination to avoid rebuilding key strings per batch. */
  private pipelineFor(view: ViewState, materialId: number, deformMask: number, variant: DrawVariant = STANDARD_VARIANT): GPURenderPipeline {
    if (isSpecialized(variant)) return view.draw.pipelines.get(this.materials, view.target, materialId, 0, variant);
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

  private directionalObjectBindGroup(): GPUBindGroup {
    const { device, resources } = this.gpu;
    const key = `directional-object:r${this.id}:t${this.transformBuffer.generation}:i${this.instanceAlloc.generation}`;
    return resources.bindGroups.get(key, () => device.createBindGroup({ layout: this.layouts.directionalObject, entries: [
      { binding: 0, resource: { buffer: this.transformBuffer.buffer } },
      { binding: 1, resource: { buffer: this.instanceAlloc.buffer } },
    ] }));
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

    const cache = this.mainView.draw.retained;
    cache.packedUploadBytes = 0;
    const canRetain = this.canRetainDraws(rw, visible) && cache.stable(rw);
    const reuse = canRetain && cache.matches(rw, this.materials.materials, this.meshes.records);
    if (!reuse) cache.invalidate();
    if (!reuse) this.mainView.draw.queueBuilder.build(rw, visible ? visible.slots : null, vCount, this.materials.materials, this.meshes.records, rw.camera,
      this.batching === 'unsorted' ? 'none' : 'sorted', this.mainView.draw.queues);
    const t2 = performance.now();
    st.cpu.sorting = t2 - t1;

    this.buildBatches(this.mainView, rw, false, reuse);
    if (canRetain && !reuse) {
      cache.capture(rw, this.mainView.draw.batches, this.mainView.draw.frame.instData, this.materials.materials, this.meshes.records,
        { pipeline: st.pipelineSwitches, material: st.materialSwitches, mesh: st.meshSwitches });
      cache.uploadedGenerations.add(this.instanceAlloc.generation);
    }
    st.drawPreparationReused = reuse;
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
    st.bufferUploadBytes += cache.packedUploadBytes;
    const t4 = performance.now();
    st.cpu.encoding = t4 - t3;
    st.cpu.total = t4 - t0;
  }

  /**
   * Whether this frame's draw preparation (queues, batches, instance records) may be captured and reused by later frames. Requires an
   * unfiltered visible set (nothing culled, no LOD swaps), versioned extraction (`rw` was not edited behind the extractor's back) and the
   * plain CPU instanced path: GPU culling rewrites the instance records itself. {@link RetainedDrawCache.stable} additionally requires the
   * view to be unchanged for two frames in a row.
   */
  private canRetainDraws(rw: RenderWorld, visible: VisibleSet | null): boolean {
    const unfiltered = visible === null || (visible.slots === null && visible.count === rw.count);
    const versioned = rw.drawVersion >= 0 && rw.transformVersion >= 0;
    return this.cacheDraws && unfiltered && versioned && !rw.hasLOD && this.batching === 'instanced' && this.gpuCulling === 'off';
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
    this.directionalLighting = L.directionalCount === L.count && !useClusters && this.shadows.layers.length === 0
      && !this.sceneResources.env.enabled && !this.sceneResources.fog.enabled;
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
  private buildBatches(view: ViewState, rw: RenderWorld, offscreen = false, reuse = false): void {
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
    if (!reuse) buildBatches(lists, rw, this.meshes.records, instData, byteOffset / INSTANCE_BYTES, this.batching === 'instanced' ? 'instanced' : 'individual', draw.batches, gpuCull ? this.sphereScratch : undefined);
    // GPU culling covers the leading opaque / alpha-mask batches (queue id < 2); transparent batches stay on the CPU path.
    let nCullBatches = 0;
    if (gpuCull) while (nCullBatches < draw.batches.count && draw.batches.queue[nCullBatches] < 2) nCullBatches++;
    const total01 = lists[0].count + lists[1].count;
    if (gpuCull) {
      this.culler ??= new GPUCuller(this.gpu);
      this.culler.prepare(draw.batches, nCullBatches, total01, this.sphereScratch, byteOffset / INSTANCE_BYTES, this.meshes, this.gpuLOD ? (m) => this.gpuLodIndex.groupOf(m) : undefined);
    }
    const cache = draw.retained;
    let skipPrefix = 0;
    if (reuse) {
      // Allocation may replace the CPU shadow/GPU buffer. Populate every new ring generation from the retained records.
      if (cache.uploadedGenerations.has(this.instanceAlloc.generation)) skipPrefix = total * INSTANCE_BYTES;
      else instData.set(cache.records);
    }
    if (!offscreen) this.features.buildInstances(this.featureFrame);   // shadow casters
    // Feature allocations may grow the buffer: growth discards its resident prefix.
    const generation = this.instanceAlloc.generation;
    if (reuse && !cache.uploadedGenerations.has(generation)) skipPrefix = 0;
    this.instanceAlloc.flush(skipPrefix);
    if (reuse) cache.uploadedGenerations.add(generation);
    if (!offscreen) st.bufferUploadBytes = this.instanceAlloc.bytesUploadedThisFrame + this.transformBuffer.lastUploadBytes;
    if (reuse) {
      st.pipelineSwitches += cache.switches.pipeline; st.materialSwitches += cache.switches.material; st.meshSwitches += cache.switches.mesh;
    } else if (!offscreen && this.batching !== 'unsorted') {
      for (const l of lists) {
        const c = countSwitches(l, rw, this.materials.materials, this.meshes.records);
        st.pipelineSwitches += c.pipeline; st.materialSwitches += c.material; st.meshSwitches += c.mesh;
      }
    }
    const f = draw.frame;
    f.total = total; f.total01 = total01; f.byteOffset = byteOffset; f.instData = this.instanceAlloc.uint32.subarray(local, local + total * INSTANCE_WORDS); f.gpuCull = gpuCull; f.nCullBatches = nCullBatches;
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
    const g = this.frame.begin();
    this.offscreen.declarePasses(g);
    this.features.addPasses(g, this.featureFrame);
    const twoPhase = f.gpuCull && this.gpuCulling === 'hiz2';
    // (two-phase culling builds its own depth in main-A and clears it, so a prepass would only switch the pipelines to depth 'equal' and break the image)
    const prepass = this.depthPrepass && !twoPhase && rw.hasCamera && f.total > 0;
    this.mainView.prepassActive = prepass;
    const targets = this.frameTargets(g);
    if (prepass) this.addDepthPrepass(g, targets);
    if (f.gpuCull) this.addCullingPasses(g, rw, twoPhase);
    if (twoPhase) this.addTwoPhaseMainPasses(g, rw, targets);
    else this.addMainPass(g, rw, prepass, targets);
    if (this.post.needsAux) this.addAuxPass(g, rw, targets);
    if (this.post.enabled) this.features.addPostPasses(g, this.postFeatureFrame());   // user effects first, then the built-in chain
    this.frame.run(g, enc);
  }

  /**
   * After the main pass: redraw opaque + alpha-masked PBR batches into the aux target (view-space normal, roughness, metallic) against
   * the finished depth buffer. SSAO and SSR read it; pixels it does not cover (custom shaders, sky) fall back to depth-derived normals / no reflection.
   */
  private addAuxPass(g: FrameBuilder, rw: RenderWorld, t: FrameTargets): void {
    const aux = g.importTexture('auxTex', this.post.auxTexture), msaa = this.post.auxMsaaTexture;
    const clearValue: [number, number, number, number] = [0, 0, 1, 0];   // cleared to "nothing written"
    const color = msaa ? { resource: g.importTexture('auxMsaa', msaa), resolve: aux, clearValue, storeOp: 'discard' as const } : { resource: aux, clearValue };
    this.passRenderWorld = rw;
    g.renderPass('aux', { colorTargets: [color], depthTarget: { resource: t.depth, readOnly: true }, record: (pass) => this.recordAux(pass) });
  }

  /** Draw the opaque + alpha-masked batches with the aux pipelines (against the finished depth buffer, which the pass only reads). */
  private recordAux(pass: TrackedRenderPass): void {
    if (!this.passRenderWorld?.hasCamera || this.mainView.draw.frame.total === 0) return;
    pass.setBindGroup(0, this.frameUniform.bindGroup); pass.setBindGroup(1, this.sceneResources.bindGroup); pass.setBindGroup(3, this.objectBindGroup());
    pass.setVertexBuffer(0, this.meshes.vertexBuffer); pass.setIndexBuffer(this.meshes.indexBuffer, 'uint32');
    const b = this.mainView.draw.batches;
    for (let i = 0; i < b.count; i++) {
      if (b.queue[i] > 1) continue;   // blended surfaces have no depth to reflect from or occlude with
      const mesh = this.meshes.get(b.meshId[i]);
      const pipe = this.materials.getAuxPipeline(b.materialId[i], mesh.deformMask, this.mainView.target.depthFormat ?? DEPTH_FORMAT, this.mainView.target.sampleCount, AUX_FORMAT);
      if (!pipe) continue;
      pass.setPipeline(pipe);
      pass.setBindGroup(2, this.materials.getBindGroup(b.materialId[i]));
      pass.drawIndexed(mesh.indexCount, b.instanceCount[i], mesh.firstIndex, mesh.baseVertex, b.firstInstance[i]);
    }
  }

  /** Depth-only pass over opaque + alpha-masked batches (lets the main pass shade each pixel once, and feeds the in-frame Hi-Z). */
  private addDepthPrepass(g: FrameBuilder, t: FrameTargets): void {
    g.renderPass('depth-prepass', { depthTarget: { resource: t.depth }, record: (pass) => this.recordDepthPrepass(pass) });
    g.timestamps('depth-prepass', () => this.profiler.writes('prepass'));
  }

  /** The prepass draws: every opaque / alpha-masked batch with its depth-only pipeline. */
  private recordDepthPrepass(pass: TrackedRenderPass): void {
    pass.setBindGroup(0, this.frameUniform.bindGroup); pass.setBindGroup(1, this.sceneResources.bindGroup); pass.setBindGroup(3, this.objectBindGroup());
    pass.setVertexBuffer(0, this.meshes.vertexBuffer); pass.setIndexBuffer(this.meshes.indexBuffer, 'uint32');
    const b = this.mainView.draw.batches;
    for (let i = 0; i < b.count; i++) {
      if (b.queue[i] > 1) continue;   // transparent surfaces never write depth
      const mesh = this.meshes.get(b.meshId[i]);
      pass.setPipeline(this.materials.getPrepassPipeline(b.materialId[i], mesh.deformMask, this.mainView.target.depthFormat ?? DEPTH_FORMAT, this.mainView.target.sampleCount));
      pass.setBindGroup(2, this.materials.getBindGroup(b.materialId[i]));
      pass.drawIndexed(mesh.indexCount, b.instanceCount[i], mesh.firstIndex, mesh.baseVertex, b.firstInstance[i]);
    }
  }

  /** Arguments describing the Hi-Z pyramid for the culling shader. */
  private hizArg() { return { texture: this.hiz!.texture!, width: this.hiz!.width, height: this.hiz!.height, mips: this.hiz!.mips }; }

  /**
   * GPU visibility passes. `hiz2` (two-phase): cull-A against last frame's visibility (cull-B is added with the main passes).
   * `frustum`: frustum cull only.
   */
  private addCullingPasses(g: FrameBuilder, rw: RenderWorld, twoPhase: boolean): void {
    const cam = rw.camera, f = this.mainView.draw.frame;
    const srcBase = f.byteOffset / INSTANCE_BYTES;
    if (twoPhase) {
      this.hiz ??= new HiZ(this.gpu);
      this.hiz.resize(this.gpu.canvas.width, this.gpu.canvas.height);
      let maxObj = 0;
      for (let i = 0; i < f.total01; i++) maxObj = Math.max(maxObj, f.instData[i * INSTANCE_WORDS + 6]);
      this.culler!.ensureVisibility(maxObj + 1);
      this.culler!.addToFrame(g, 'cull-A', this.instanceAlloc.buffer, srcBase, cam.frustum.planes, cam.viewProjection, null, this.profiler.writes('cullA'), 1, cam);
    } else {
      this.culler!.addToFrame(g, 'gpu-cull', this.instanceAlloc.buffer, srcBase, cam.frustum.planes, cam.viewProjection, null, this.profiler.writes('cull'), 0, cam);
    }
  }

  /**
   * Which draw path a view's batches take this frame. The specialised paths (packed per-instance vertex stream, cheap directional-only
   * fragment stage) apply to the main view when its draw preparation was reused, nothing else rewrites the instance records
   * (prepass, GPU culling, off-screen appends) and every batch is an undeformed map-free PBR material.
   */
  private resolveDrawPath(view: ViewState): DrawPath {
    const f = view.draw.frame, cache = view.draw.retained;
    const eligible = view === this.mainView && this.stats.drawPreparationReused && !view.prepassActive && !f.gpuCull
      && f.byteOffset === 0 && cache.supportsPacked() && this.meshes.compactVerticesSupported;
    const retained = this.retainedVertex && eligible;
    const directional = this.retainedLighting && this.directionalLighting && eligible;
    return {
      retained, directional,
      variant: drawVariant({ retained, directional, uniformNormals: cache.uniformNormals }),
      sceneGroup: directional ? this.sceneResources.directionalBindGroup : view.sceneBindGroup ?? this.sceneResources.bindGroup,
    };
  }

  /** Group-2 bind group of a material for the given path (the directional path binds a small uniform instead of the shared record buffer). */
  private materialGroupFor(path: DrawPath, materialId: number): GPUBindGroup {
    return path.directional ? this.materials.getDirectionalBindGroup(materialId) : this.materials.getBindGroup(materialId);
  }

  /**
   * Draw loop for opaque / alpha batches. With GPU culling, `'culled'` issues one indirect draw per (batch, LOD level) from the
   * compacted set (arguments start at `argBase`), `'rest'` draws the batches the GPU path does not cover, `'all'` does both.
   * Without GPU culling every batch is drawn directly. `part` selects the early (opaque + alpha-mask) or late (blended + transmissive) half.
   */
  private drawGeometry(pass: TrackedRenderPass, view: ViewState, which: 'all' | 'culled' | 'rest', argBase: number, part: DrawPart = 'all'): void {
    const path = this.resolveDrawPath(view);
    if ((path.retained || path.directional) && this.retainedBundles && !pass.isBundle) {
      this.drawThroughBundle(pass, view, which, argBase, part, path);
      return;
    }
    const f = view.draw.frame, gpuCull = f.gpuCull, culledDraws = gpuCull && which !== 'rest';
    pass.setBindGroup(0, view.frameBindGroup ?? this.frameUniform.bindGroup);
    pass.setBindGroup(1, path.sceneGroup);
    if (!path.retained) pass.setBindGroup(3, path.directional ? this.directionalObjectBindGroup() : this.objectBindGroup(culledDraws));
    pass.setVertexBuffer(0, (path.retained || path.directional) ? this.meshes.compactVertexBuffer : this.meshes.vertexBuffer);
    pass.setIndexBuffer(this.meshes.indexBuffer, 'uint32');
    const bound: BoundState = { pipeline: null, material: -1 };
    if (culledDraws) this.drawIndirect(pass, view, argBase, part, bound);
    if (which === 'culled') return;
    if (gpuCull && which === 'all') pass.setBindGroup(3, this.objectBindGroup());   // remaining batches use the uncompacted records
    if (path.retained) pass.setVertexBuffer(1, view.draw.retained.packedBuffer(this.gpu));
    this.drawBatches(pass, view, gpuCull ? f.nCullBatches : 0, part, path, bound);
  }

  /** GPU-compacted draws: one indirect draw per (batch, LOD level) in the culler's output. */
  private drawIndirect(pass: TrackedRenderPass, view: ViewState, argBase: number, part: DrawPart, bound: BoundState): void {
    const cu = this.culler!, mats = this.materials.materials, st = this.stats;
    for (let v = 0; v < cu.virtualCount; v++) {
      if (isSkippedPart(part, (mats[cu.virtualMaterial[v]].features & MaterialFeature.Transmission) !== 0)) continue;
      const matId = cu.virtualMaterial[v];
      this.bindPipelineAndMaterial(pass, bound, this.pipelineFor(view, matId, this.meshes.get(cu.virtualMesh[v]).deformMask), matId, this.materials.getBindGroup(matId));
      pass.drawIndexedIndirect(cu.argsBuffer, (argBase + v) * 20);
      st.drawCalls++;
    }
  }

  /** Direct instanced draws of batches `first..count`, switching pipeline and material bind group only when they change. */
  private drawBatches(pass: TrackedRenderPass, view: ViewState, first: number, part: DrawPart, path: DrawPath, bound: BoundState): void {
    const b = view.draw.batches, st = this.stats, unsorted = this.batching === 'unsorted';
    let curMesh = -1;
    for (let i = first; i < b.count; i++) {
      if (isSkippedPart(part, b.late[i] === 1)) continue;
      const matId = b.materialId[i], meshId = b.meshId[i];
      const mesh = this.meshes.get(meshId);
      const pipe = this.pipelineFor(view, matId, mesh.deformMask, path.variant);
      // the unsorted baseline reports its (large) state-change counts here, since nothing was sorted to count them from
      if (pipe !== bound.pipeline && unsorted) st.pipelineSwitches++;
      if (matId !== bound.material && unsorted) st.materialSwitches++;
      if (unsorted && meshId !== curMesh) st.meshSwitches++;
      curMesh = meshId;
      this.bindPipelineAndMaterial(pass, bound, pipe, matId, this.materialGroupFor(path, matId));
      pass.drawIndexed(mesh.indexCount, b.instanceCount[i], mesh.firstIndex, mesh.baseVertex, b.firstInstance[i]);
      if (path.retained) st.retainedVertexDraws++;
      if (path.directional) st.retainedLightingDraws++;
      st.drawCalls++;
      st.instances += b.instanceCount[i];
      st.triangles += (mesh.indexCount / 3) * b.instanceCount[i];
    }
  }

  /** Set the pipeline / material bind group (group 2) unless they are already the bound ones. */
  private bindPipelineAndMaterial(pass: TrackedRenderPass, bound: BoundState, pipeline: GPURenderPipeline, materialId: number, materialGroup: GPUBindGroup): void {
    if (pipeline !== bound.pipeline) { pass.setPipeline(pipeline); bound.pipeline = pipeline; }
    if (materialId !== bound.material) { pass.setBindGroup(2, materialGroup); bound.material = materialId; }
  }

  /**
   * Draw a specialised-path part through a cached render bundle. The bundle is re-recorded only when its signature changes: target formats,
   * the bind groups / buffers it references and, per draw, the pipeline, material group and geometry ranges. Camera, light and material
   * contents change inside the same buffers, so a still scene replays its commands unchanged.
   */
  private drawThroughBundle(pass: TrackedRenderPass, view: ViewState, which: 'all' | 'culled' | 'rest', argBase: number, part: DrawPart, path: DrawPath): void {
    const st = this.stats, target = view.target, cache = view.draw.retained, b = view.draw.batches;
    const signature: unknown[] = [target.colorFormat, target.depthFormat, target.sampleCount,
      this.frameUniform.bindGroup, path.sceneGroup, this.meshes.compactVertexBuffer, this.meshes.indexBuffer,
      path.retained ? cache.packedBuffer(this.gpu) : this.directionalObjectBindGroup()];
    let draws = 0;
    for (let i = 0; i < b.count; i++) {
      if (isSkippedPart(part, b.late[i] === 1)) continue;
      const m = this.meshes.get(b.meshId[i]);
      signature.push(this.pipelineFor(view, b.materialId[i], 0, path.variant), this.materialGroupFor(path, b.materialId[i]),
        m.indexCount, m.firstIndex, m.baseVertex, b.instanceCount[i], b.firstInstance[i]);
      draws++;
    }
    if (draws === 0) return;
    // the packed stream is rebuilt per retained revision; the storage-based path binds the current ring slot's buffer
    const bundleKey = path.retained ? part : `${part}:${this.instanceAlloc.generation}`;
    let saved = view.draw.bundles.get(bundleKey, signature);
    if (!saved) {
      const encoder = this.gpu.device.createRenderBundleEncoder({ label: 'retained-' + part,
        colorFormats: [target.colorFormat!], depthStencilFormat: target.depthFormat, sampleCount: target.sampleCount });
      const before = [st.drawCalls, st.instances, st.triangles];
      this.drawGeometry(new TrackedRenderPass(encoder), view, which, argBase, part);   // records through the ordinary path (a bundle encoder is not a pass, so no recursion)
      const counts: [number, number, number] = [st.drawCalls - before[0], st.instances - before[1], st.triangles - before[2]];
      saved = view.draw.bundles.set(bundleKey, signature, encoder.finish(), counts);
    } else {
      if (path.retained) st.retainedVertexDraws += saved.counts[0];
      if (path.directional) st.retainedLightingDraws += saved.counts[0];
      st.drawCalls += saved.counts[0]; st.instances += saved.counts[1]; st.triangles += saved.counts[2];
    }
    pass.executeBundles([saved.bundle]);   // (clears the wrapper's cache: a replayed bundle leaves the pass with no bindings)
    st.retainedBundleDraws += draws;
  }

  /** Frame resources the main pass(es) wait for: what the other passes of the frame published (shadow map, light grid, fog volume, particles, culled draws) and what user features list in `produces`. */
  private mainAfter(g: FrameBuilder): string[] {
    return [...new Set([...g.published, ...this.features.producedResources.filter((name) => g.hasResource(name))])];
  }

  /** Clear colour as the main pass target expects it (the HDR target holds linear values, the swap chain sRGB-encoded ones). */
  private mainClearValue(): { r: number; g: number; b: number; a: number } {
    return this.post.enabled ? srgbToLinear(this.clearColor) : this.clearColor;
  }

  /** The frame's attachments, imported from the objects the renderer owns: the swap chain or the HDR scene image, the multisampled buffer it resolves from (MSAA), the depth buffer. */
  private frameTargets(g: FrameBuilder): FrameTargets {
    const msaa = this.mainView.target.sampleCount > 1 ? this.post.msaaTexture : null;
    return {
      image: this.post.enabled ? g.importTexture('sceneColor', this.post.sceneTexture) : g.importTexture('backbuffer', this.gpu.context.getCurrentTexture()),
      msaa: msaa ? g.importTexture('sceneMsaa', msaa) : null,
      depth: g.importTexture('depth', this.depthTexture),
    };
  }

  /** One main pass as a render node of the frame: the targets, the ordered segments, the wait for what other passes produced, the GPU timestamps `timestampName` names. */
  private addMainNode(g: FrameBuilder, name: string, t: FrameTargets, options: MainPassOptions, segments: MainPassSegment[], timestampName?: string, also: string[] = []): void {
    declareMainPass(g, name, t, this.mainClearValue(), options, segments, { after: [...this.mainAfter(g), ...also] });
    if (timestampName) g.timestamps(name, () => this.profiler.writes(timestampName));
  }

  /** One segment per feature that has `hook`, in feature order: the feature's draws as an ordered part of the main pass. */
  private featureSegments(hook: 'drawBackdrop' | 'drawMain'): MainPassSegment[] { return this.features.segments(hook, this.featureFrame); }

  /** The scene geometry (`early`: opaque + alpha-masked, `late`: blended + transmissive; the GPU-culled / remaining halves in the two-phase passes) as a segment. */
  private sceneSegment(name: string, rw: RenderWorld, draw: (pass: TrackedRenderPass) => void): MainPassSegment {
    return { name, record: (pass) => { if (rw.hasCamera && this.mainView.draw.frame.total > 0) draw(pass); } };
  }

  /** The standard single main pass: clear (or load the prepass depth), draw geometry, then skybox / particles / ribbons. */
  private addMainPass(g: FrameBuilder, rw: RenderWorld, prepass: boolean, t: FrameTargets): void {
    const early = this.sceneSegment('scene:early', rw, (pass) => this.drawGeometry(pass, this.mainView, 'all', 0, 'early'));
    const late = this.sceneSegment('scene:late', rw, (pass) => this.drawGeometry(pass, this.mainView, 'all', 0, 'late'));
    if (!this.transmissionActive) {
      // opaque + alpha-masked, then the sky, then blended / transmissive surfaces, then particles / ribbons / overlays
      this.addMainNode(g, 'main', t, { clear: true, depthLoad: prepass }, [early, ...this.featureSegments('drawBackdrop'), late, ...this.featureSegments('drawMain')], 'main');
      return;
    }
    // Screen-space transmission: finish the opaque scene + sky, copy it (with mips), then draw what refracts it.
    this.addMainNode(g, 'main-opaque', t, { clear: true, depthLoad: prepass, keepMsaa: true }, [early, ...this.featureSegments('drawBackdrop')], 'main');
    this.transmission.addToFrame(g, this.post.sceneTexture);
    this.addMainNode(g, 'main-late', t, { clear: false, depthLoad: true }, [late, ...this.featureSegments('drawMain')], undefined, ['transmissionTex']);
  }

  /**
   * Two-phase occlusion culling (`hiz2`). Phase A draws what was visible last frame (clears the targets); the depth is turned into a
   * Hi-Z pyramid; cull-B tests everything else against it; phase B draws the newly visible rest (loads the targets) plus extras.
   */
  private addTwoPhaseMainPasses(g: FrameBuilder, rw: RenderWorld, t: FrameTargets): void {
    const cam = rw.camera, f = this.mainView.draw.frame;
    const srcBase = f.byteOffset / INSTANCE_BYTES;
    const culledA: MainPassSegment = { name: 'scene:culled', record: (pass) => { if (f.total > 0) this.drawGeometry(pass, this.mainView, 'culled', 0); } };
    this.addMainNode(g, 'main-A', t, { clear: true, depthLoad: false }, [culledA], 'mainA');
    this.hiz!.addToFrame(g, this.depthTexture, () => this.profiler.writes('hiz'));
    this.culler!.addToFrame(g, 'cull-B', this.instanceAlloc.buffer, srcBase, cam.frustum.planes, cam.viewProjection, this.hizArg(), this.profiler.writes('cullB'), 2, cam);
    // same order as the single main pass: opaque (GPU-culled), sky, then the blended batches the GPU path does not cover, then extras.
    // (Drawing the sky last would paint over blended surfaces that sit in front of it: they write no depth.)
    const culled: MainPassSegment = { name: 'scene:culled', record: (pass) => { if (f.total > 0) this.drawGeometry(pass, this.mainView, 'culled', this.culler!.virtualCount); } };
    const rest: MainPassSegment = { name: 'scene:rest', record: (pass) => { if (f.total > 0) this.drawGeometry(pass, this.mainView, 'rest', 0); } };
    this.addMainNode(g, 'main-B', t, { clear: false, depthLoad: true }, [culled, ...this.featureSegments('drawBackdrop'), rest, ...this.featureSegments('drawMain')], 'mainB');
  }
}
