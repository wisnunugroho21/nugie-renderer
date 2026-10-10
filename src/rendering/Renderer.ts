import type { GPUContext } from '../gpu/GPUContext';
import { DynamicBufferAllocator } from '../gpu/DynamicBufferAllocator';
import { createBindLayouts, type BindLayouts } from '../gpu/BindLayouts';
import { MeshManager } from './MeshManager';
import { MaterialManager, type PassTarget } from './materials/MaterialManager';
import { countSwitches } from './RenderQueue';
import { RenderDrawState } from './RenderDrawState';
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
import { Mat4 } from '../math/Mat4';
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
import { RenderTarget, RENDER_TARGET_FORMAT, type RenderTargetDesc } from './RenderTarget';
import { RenderView, type RenderViewOptions } from './RenderView';
import { mirrorView, planeToView, obliqueProjection, cubeFaceView, cubeFaceProjection } from './viewMath';
import { VisibilitySystem } from '../visibility/VisibilitySystem';
import type { Overlay } from './overlay/Overlay';
import { FeatureRegistry, particleFeature, ribbonFeature, overlayFeature, type RenderFeature, type FeatureFrame } from './RenderFeature';
import { LineSystem, type LineSystemOptions } from './overlay/LineSystem';
import { PointSystem, type PointSystemOptions } from './overlay/PointSystem';
import { SpriteSystem, type SpriteSystemOptions } from './overlay/SpriteSystem';
import type { TextureRef } from './materials/Material';
import type { VisibleSet } from '../visibility/VisibilitySystem';

const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

/** Everything an off-screen render needs besides the scene: a camera and the colour / depth views to draw into. */
interface ViewJob {
  camera: Camera;
  colorView: GPUTextureView;
  depthView: GPUTextureView;
  width: number;
  height: number;
  /** Mirrored camera: triangle winding is reversed. */
  flipWinding: boolean;
  clearColor: { r: number; g: number; b: number; a: number };
  skybox: boolean;
  visibility: VisibilitySystem;
  /** Objects whose material samples this texture are skipped (a target must not be read while it is written). */
  excludeRef: TextureRef | null;
  exclude: ((entity: number) => boolean) | null;
}

/** Per-variant (normal / mirrored winding) scratch state of off-screen renders, swapped in while a view is drawn. */
interface ViewScratch {
  target: PassTarget;
  state: RenderDrawState;
  slots: Uint32Array;
}

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
  private target: PassTarget;
  /** Per-view uniform + bind group 0 (camera, time, viewport, output flags). */
  private frameUniform: FrameUniform;
  private transformBuffer: TransformBuffer;
  private instanceAlloc: DynamicBufferAllocator;

  private drawState = new RenderDrawState();
  /** Sun + ambient lights built from `SceneSettings`, used when the scene defines no lights. */
  private legacyLights = new LegacySceneLights();

  private targetPre: PassTarget;
  /** Create every GPU-side manager for `gpu`: bind layouts, mesh / material managers, transform / joint / morph / instance buffers, scene resources, light clusters, shadows and the profiler. */
  constructor(private gpu: GPUContext) {
    const { device, resources: r } = gpu;
    this.layouts = createBindLayouts(device);
    this.meshes = new MeshManager(device, r.buffers);
    this.materials = new MaterialManager(device, r, this.layouts);
    this.lodLibrary = new LODLibrary(this.meshes);
    this.lod = new LODSystem(this.lodLibrary);
    this.target = { colorFormat: gpu.format, depthFormat: DEPTH_FORMAT, sampleCount: 1 };
    this.targetPre = { ...this.target, depthEqual: true };
    this.extrasTarget = { colorFormat: gpu.format, depthFormat: DEPTH_FORMAT, sampleCount: 1 };
    this.post = new PostProcessor(gpu);

    this.frameUniform = new FrameUniform(gpu, this.layouts);
    this.sceneResources = new SceneResources(gpu, this.layouts);
    this.skybox = new Skybox(gpu, this.layouts, DEPTH_FORMAT);
    this.transmission = new TransmissionCopy(gpu, this.sceneResources);
    this.streaming = new StreamingDriver(this.materials);
    this.gpuLodIndex = new GPULodIndex(this.lodLibrary);
    this.featureFrame = { camera: new Camera(), hasCamera: false, time: 0, frameBindGroup: this.frameUniform.bindGroup, sceneBindGroup: this.sceneResources.bindGroup, target: this.target };

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
  }

  /** Clustered forward light assignment (used when ranged lights exist and `clusteredShading` is on). */
  readonly clusters: ClusterGrid;
  /** Shadow maps (cascaded directional + spot). Set `shadows.enabled = false` to skip. */
  readonly shadows: ShadowSystem;
  /** GPU pass timings (timestamp queries; no-op where unsupported). */
  readonly profiler: GPUProfiler;
  /** false = every fragment loops over every light (the naive baseline). */
  clusteredShading = true;
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
  private prepassActive = false;
  /** Per-frame pass graph (ordering + culling of the frame's passes). */
  readonly graph = new RenderGraph();
  private static nextId = 0;
  /** Unique id: bind-group cache keys must not collide between renderers sharing one GPU context. */
  private readonly id = Renderer.nextId++;
  private baker: IBLBaker | null = null;
  private skybox: Skybox;
  /** Off-screen views (mirrors, minimaps, security cameras ...), rendered before the main view every frame. Add with `addView`. */
  readonly views: RenderView[] = [];
  private renderTargets: RenderTarget[] = [];
  /** Pluggable rendering features (particles, ribbons, overlays and anything added with `addFeature`). */
  private readonly features = new FeatureRegistry();
  /** The feature of each overlay created through `createLineSystem` / `createPointSystem` / `createSpriteSystem`. */
  private overlayFeatures = new Map<Overlay, RenderFeature>();
  /** Handed to the features' hooks; filled in at the start of every frame. */
  private featureFrame!: FeatureFrame;
  private viewScratch = new Map<boolean, ViewScratch>();
  private probeVisibility = new VisibilitySystem();
  private lastTime = 0;
  /** Copy of the opaque scene (HDR, mip chain) that transmissive materials refract. */
  private transmission: TransmissionCopy;
  /** Screen-space transmission runs this frame (post chain on, a transmissive material visible). */
  private transmissionActive = false;
  /** Draw the bound environment as the background (when one is set). */
  showSkybox = true;

  /** Turn on froxel volumetric fog (light shafts from shadow-mapped lights, height fog). */
  enableFog(settings?: Partial<FogSettings>): VolumetricFog {
    this.fog ??= new VolumetricFog(this.gpu, this.layouts, this.sceneResources);
    if (settings) Object.assign(this.fog.settings, settings);
    this.fog.enabled = true;
    return this.fog;
  }

  /** Pre-build the main-pass pipelines of all PBR materials (async, no frame hitch). Call after creating materials. */
  warmup(deformMasks: number[] = [0, 1, 2, 3]): Promise<number> {
    this.syncFramebuffer();
    return this.materials.warmup(this.prepassActive || this.depthPrepass ? this.targetPre : this.target, deformMasks);
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
    this.addOverlay(s);
    return s;
  }

  /** Screen-facing discs / squares (point clouds), sized in pixels or world units. One draw call per system. */
  createPointSystem(o?: PointSystemOptions): PointSystem {
    this.syncFramebuffer();
    const s = new PointSystem(this.gpu, this.layouts, this.extrasTarget, o);
    this.addOverlay(s);
    return s;
  }

  /** Textured sprites and text (see `createFont`). One system draws one texture in one draw call. */
  createSpriteSystem(o: SpriteSystemOptions): SpriteSystem {
    this.syncFramebuffer();
    const s = new SpriteSystem(this.gpu, this.layouts, this.extrasTarget, o);
    this.addOverlay(s);
    return s;
  }

  /** Stop drawing a line / point / sprite system. */
  removeOverlay(o: Overlay): void {
    const f = this.overlayFeatures.get(o);
    if (f) { this.features.remove(f); this.overlayFeatures.delete(o); }
  }

  private addOverlay(o: Overlay): void { this.overlayFeatures.set(o, this.features.add(overlayFeature(o))); }

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

  // ---- render-to-texture: render targets, off-screen views, probe capture -------------------------------------------------------------

  /** Create an off-screen colour + depth buffer for a {@link RenderView} to draw into (see `RenderTarget.ref` for using it as a texture). */
  createRenderTarget(desc: RenderTargetDesc = {}): RenderTarget {
    const t = new RenderTarget(this.gpu, desc);
    t.onResized = (rt) => this.materials.textureChanged(rt.ref);
    this.renderTargets.push(t);
    return t;
  }

  /** Destroy a render target (and the views drawing into it). Remove the materials that sample it first. */
  destroyRenderTarget(t: RenderTarget): void {
    for (const v of this.views.filter((x) => x.target === t)) this.removeView(v);
    const i = this.renderTargets.indexOf(t);
    if (i >= 0) this.renderTargets.splice(i, 1);
    t.destroy();
  }

  /**
   * Register an off-screen render of the scene from another camera. It runs every frame (or every `interval`th) before the main view,
   * in registration order, so a view can show the result of an earlier one.
   */
  addView(o: RenderViewOptions): RenderView {
    const v = new RenderView(o);
    this.views.push(v);
    this.gpu.resources.pipelines.unfreeze();   // the view's pipelines are created on first use
    return v;
  }

  /** Stop rendering a view (its target stays alive). */
  removeView(v: RenderView): void {
    const i = this.views.indexOf(v);
    if (i >= 0) this.views.splice(i, 1);
  }

  /** Render every due view into its target. Called by `render` after the main view's data is uploaded and its batches are built. */
  private renderViews(rw: RenderWorld, time: number): void {
    for (const t of this.renderTargets) if (t.scale) t.resize(this.gpu.canvas.width * t.scale, this.gpu.canvas.height * t.scale);
    const due: RenderView[] = [];
    for (const v of this.views) {
      if (!v.enabled) continue;
      if (++v.frameCounter >= v.interval) { v.frameCounter = 0; due.push(v); }
    }
    if (due.length === 0) return;
    const mainFrame = this.frameUniform.snapshot();
    for (const v of due) {
      if (v.mirror) {
        if (!rw.hasCamera) continue;
        this.setupMirrorCamera(v, rw.camera);
      }
      this.renderJob({
        camera: v.camera, colorView: v.target.view, depthView: v.target.depthView, width: v.target.width, height: v.target.height,
        flipWinding: v.mirror !== null, clearColor: v.clearColor ?? this.clearColor, skybox: v.skybox, visibility: v.visibility,
        excludeRef: v.target.ref, exclude: v.exclude,
      }, rw, time);
      v.lastDrawn = this.viewScratch.get(v.mirror !== null)?.state.frame.total ?? 0;
    }
    // the main view continues with its own uniforms (queue order: view writes, view submit, then these writes, main submit)
    this.frameUniform.restore(mainFrame);
    this.sceneResources.restoreUniform();
  }

  /** Point a mirror view's camera at the main camera's reflection (oblique near plane = the mirror plane). */
  private setupMirrorCamera(v: RenderView, main: Camera): void {
    const m = v.mirror!;
    const mv = mirrorView(new Float32Array(16), main.view, m.point, m.normal);
    const plane = planeToView(mv, m.point, m.normal);
    const proj = obliqueProjection(new Float32Array(16), main.projection, plane);
    v.camera.setMatrices(mv, proj, main.near, main.far);
  }

  /** Scratch state for off-screen renders with the given winding. */
  private scratchFor(flip: boolean): ViewScratch {
    let s = this.viewScratch.get(flip);
    if (!s) {
      s = {
        target: { colorFormat: RENDER_TARGET_FORMAT, depthFormat: DEPTH_FORMAT, sampleCount: 1, flipWinding: flip },
        state: new RenderDrawState(), slots: new Uint32Array(0),
      };
      this.viewScratch.set(flip, s);
    }
    return s;
  }

  /** Cull for the job's camera, then drop excluded objects and objects whose material samples the job's target. */
  private viewSlots(rw: RenderWorld, job: ViewJob, scratch: ViewScratch): { slots: Uint32Array | null; count: number } {
    const proxy = Object.create(rw, { camera: { value: job.camera } }) as RenderWorld;   // culling reads rw.camera only
    const vis = job.visibility.update(proxy);
    if (!job.excludeRef && !job.exclude) return vis;
    const n = vis.slots ? vis.count : rw.count;
    if (scratch.slots.length < n) scratch.slots = new Uint32Array(Math.max(n, scratch.slots.length * 2, 256));
    let bad: Uint8Array | null = null;
    if (job.excludeRef) {
      for (const m of this.materials.materials) {
        if (m.textures.includes(job.excludeRef)) { bad ??= new Uint8Array(this.materials.materials.length); bad[m.id] = 1; }
      }
    }
    let c = 0;
    for (let i = 0; i < n; i++) {
      const slot = vis.slots ? vis.slots[i] : i;
      if (bad && bad[rw.materialId[slot]]) continue;
      if (job.exclude && job.exclude(rw.entityIndex[slot])) continue;
      scratch.slots[c++] = slot;
    }
    return { slots: scratch.slots, count: c };
  }

  /**
   * Render the scene once from `job.camera` into the job's colour / depth views, as a self-contained mini frame: own frame uniform,
   * CPU culling, queues and batches (appended to this frame's instance ring), one command buffer, one submit. Queue order makes the
   * per-job uniform writes safe; callers restore the main view's uniforms afterwards. Shading is linear HDR (no tone mapping), lighting
   * is the plain light loop (no clusters, no fog volume), shadows are the main view's. Particles, ribbons and post-processing are skipped.
   */
  private renderJob(job: ViewJob, rw: RenderWorld, time: number): void {
    const { device, queue } = this.gpu;
    const scratch = this.scratchFor(job.flipWinding);
    const slots = this.viewSlots(rw, job, scratch);
    const saved = {
      target: this.target, targetPre: this.targetPre, state: this.drawState,
      prepass: this.prepassActive, gpuCulling: this.gpuCulling,
    };
    this.target = scratch.target; this.targetPre = scratch.target;
    this.drawState = scratch.state;

    this.prepassActive = false; this.gpuCulling = 'off';
    try {
      const cam = job.camera;
      this.frameUniform.writeView(cam, time, job.width, job.height, true);   // linear HDR output: the colour is used as a texture; no opaque copy, so views refract the environment
      this.sceneResources.writeViewUniform();

      scratch.state.queueBuilder.build(rw, slots.slots, slots.count, this.materials.materials, this.meshes.records, cam, this.batching === 'unsorted' ? 'none' : 'sorted', this.drawState.queues);
      this.buildBatches(rw, true);

      const enc = device.createCommandEncoder({ label: 'view' });
      const pass = enc.beginRenderPass({
        label: 'view',
        colorAttachments: [{ view: job.colorView, clearValue: Renderer.srgbToLinear(job.clearColor), loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: job.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      });
      if (this.drawState.frame.total > 0) this.drawGeometry(pass, 'all', 0, 'early');
      if (job.skybox && this.showSkybox && this.sceneResources.env.enabled) this.skybox.draw(pass, this.target, this.frameUniform.bindGroup, this.sceneResources.bindGroup);
      if (this.drawState.frame.total > 0) this.drawGeometry(pass, 'all', 0, 'late');
      pass.end();
      queue.submit([enc.finish()]);
    } finally {
      this.target = saved.target; this.targetPre = saved.targetPre;
      this.drawState = saved.state;

      this.prepassActive = saved.prepass; this.gpuCulling = saved.gpuCulling;
    }
  }

  /**
   * Capture a reflection probe: render the scene from `position` into the six faces of a cube map and bake it into an
   * {@link Environment} (diffuse irradiance + prefiltered specular). Use it with `setEnvironment` (image-based lighting for the
   * whole scene) - e.g. capture inside a room once, or re-capture every few seconds. Call between frames with the current `rw`.
   */
  captureEnvironment(rw: RenderWorld, position: ArrayLike<number>, o: { size?: number; near?: number; far?: number; skybox?: boolean; exclude?: (entity: number) => boolean } = {}): Environment {
    const size = o.size ?? 128, near = o.near ?? 0.1, far = o.far ?? 500;
    const source = this.ibl.createCaptureCube(size);
    const depth = this.gpu.resources.textures.create({ label: 'probe-depth', size: [size, size], format: DEPTH_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const depthView = depth.createView();
    this.gpu.resources.pipelines.unfreeze();
    this.probeVisibility.mode = 'linear';
    const cam = new Camera();
    const view = new Float32Array(16), proj = cubeFaceProjection(new Float32Array(16), near, far);
    const mainFrame = this.frameUniform.snapshot();
    for (let face = 0; face < 6; face++) {
      cubeFaceView(view, face, position[0], position[1], position[2]);
      cam.setMatrices(view, proj, near, far);
      this.renderJob({
        camera: cam, colorView: source.createView({ dimension: '2d', baseArrayLayer: face, arrayLayerCount: 1, baseMipLevel: 0, mipLevelCount: 1 }),
        depthView, width: size, height: size, flipWinding: true, clearColor: this.clearColor, skybox: o.skybox ?? true,
        visibility: this.probeVisibility, excludeRef: null, exclude: o.exclude ?? null,
      }, rw, this.lastTime);
    }
    this.frameUniform.restore(mainFrame);
    this.sceneResources.restoreUniform();
    this.gpu.resources.textures.destroy(depth);
    return this.ibl.bakeCube(source, size);
  }

  /** Create the GPU particle system bound to this renderer's frame layout / render target. */
  enableParticles(): ParticleSystem {
    this.syncFramebuffer();
    if (!this.particles) {
      this.particles = new ParticleSystem(this.gpu, this.layouts, this.meshes, this.extrasTarget);
      this.features.add(particleFeature(this.particles));
    }
    return this.particles;
  }

  /** Create a ribbon system (trails, beams/chains, flat streaks) bound to this renderer's frame layout / render target. */
  createRibbonSystem(config: RibbonSystemConfig): RibbonSystem {
    this.syncFramebuffer();
    const rs = new RibbonSystem(this.gpu, this.layouts, this.extrasTarget, config);
    this.features.add(ribbonFeature(rs, this.ribbonSystems.length));
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
    this.target.colorFormat = colorFormat; this.target.sampleCount = samples;
    this.targetPre.colorFormat = colorFormat; this.targetPre.sampleCount = samples;
    this.extrasTarget.colorFormat = colorFormat; this.extrasTarget.sampleCount = samples;
    this.drawState.pipelines.clear();
    this.skybox.retarget();
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
      label: 'depth', size: [Math.max(1, width), Math.max(1, height)], format: DEPTH_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, sampleCount: this.target.sampleCount,
    });
    this.depthView = this.depthTexture.createView();
    this.depthSampleView = this.depthTexture.createView({ aspect: 'depth-only' });
  }

  /** Pipeline for (material, mesh deform variant); cached per pair to avoid rebuilding key strings per batch. */
  private pipelineFor(materialId: number, deformMask: number): GPURenderPipeline {
    if (this.prepassActive) return this.materials.getPipeline(materialId, this.targetPre, deformMask);
    return this.drawState.pipelines.get(this.materials, this.target, materialId, deformMask);
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
    if (this.depthTexture.width !== this.gpu.canvas.width || this.depthTexture.height !== this.gpu.canvas.height || this.depthTexture.sampleCount !== this.target.sampleCount) this.resize(this.gpu.canvas.width, this.gpu.canvas.height);   // keep depth matched to the swapchain
    this.post.ensureTargets(this.gpu.canvas.width, this.gpu.canvas.height, this.target.sampleCount);
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
    const lights = this.uploadFrameData(rw, scene, time, visible, vCount);
    const t1 = performance.now();
    st.cpu.upload = t1 - t0;

    this.drawState.queueBuilder.build(rw, visible ? visible.slots : null, vCount, this.materials.materials, this.meshes.records, rw.camera,
      this.batching === 'unsorted' ? 'none' : 'sorted', this.drawState.queues);
    const t2 = performance.now();
    st.cpu.sorting = t2 - t1;

    this.buildBatches(rw);
    const t3 = performance.now();
    st.cpu.batching = t3 - t2;
    this.transmissionActive = this.post.enabled && this.drawState.frame.transmissive && rw.hasCamera && !(this.drawState.frame.gpuCull && this.gpuCulling === 'hiz2');
    if (this.transmissionActive) this.transmission.ensure(this.gpu.canvas.width, this.gpu.canvas.height);
    this.frameUniform.setTransmission(this.transmissionActive, this.transmission.maxMip);
    this.renderViews(rw, time);

    const enc = device.createCommandEncoder();
    this.profiler.beginFrame();
    this.fillFeatureFrame(rw, time);
    this.features.prepare(this.featureFrame);
    this.recordPasses(enc, rw, lights, time);
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
   * @returns the light set actually used this frame (ECS lights, or the legacy sun/ambient fallback)
   */
  private uploadFrameData(rw: RenderWorld, scene: SceneSettings, time: number, visible: VisibleSet | null, vCount: number): LightData {
    const st = this.stats, cam = rw.camera;
    this.frameUniform.writeView(cam, time, this.gpu.canvas.width, this.gpu.canvas.height, this.post.enabled);   // the transmission flags are set once the batches are known (see render)
    // Lights come from the ECS (rw.lights). If the scene defines none, fall back to the legacy SceneSettings sun + ambient.
    let L = rw.lights;
    if (L.count === 0 && L.ambientSky[0] === 0 && L.ambientSky[1] === 0 && L.ambientSky[2] === 0) L = this.legacyLights.get(scene);
    if (this.streaming.streamer && rw.hasCamera) this.streaming.update(rw, visible, vCount, this.gpu.canvas.height);
    this.shadows.assign(L, cam);
    if (this.fog && rw.hasCamera) { this.fog.resize(this.gpu.canvas.width, this.gpu.canvas.height); this.fog.applySettings(); }
    this.sceneResources.syncLights(L);
    const useClusters = this.clusteredShading && L.count > L.globalCount;
    this.drawState.frame.useClusters = useClusters;
    if (useClusters) this.clusters.resize(this.gpu.canvas.width, this.gpu.canvas.height);
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
    return L;
  }

  /**
   * Turn the sorted queues into batches (one per mesh+material run) and write their instance records straight into the
   * per-frame ring buffer; also prepares GPU culling and shadow caster data and counts state switches.
   * Results are stored in `this.drawState.frame` for {@link recordPasses}.
   */
  private buildBatches(rw: RenderWorld, view = false): void {
    const st = this.stats;
    const lists = this.drawState.queues.ordered;
    const total = lists[0].count + lists[1].count + lists[2].count;
    if (!view) this.instanceAlloc.beginFrame();   // off-screen views append to the current frame's region
    const byteOffset = this.instanceAlloc.allocate(Math.max(total, 1) * INSTANCE_BYTES);
    if (byteOffset % INSTANCE_BYTES !== 0) throw new Error('instance buffer offset is not record-aligned');
    const local = this.instanceAlloc.localOffset(byteOffset) / 4;
    const instData = this.instanceAlloc.uint32.subarray(local, local + total * INSTANCE_WORDS);
    const gpuCull = this.gpuCulling !== 'off' && rw.hasCamera && total > 0;
    if (gpuCull && this.sphereScratch.length < total * 4) this.sphereScratch = new Float32Array(Math.max(total * 4, this.sphereScratch.length * 2));
    buildBatches(lists, rw, this.meshes.records, instData, byteOffset / INSTANCE_BYTES, this.batching === 'instanced' ? 'instanced' : 'individual', this.drawState.batches, gpuCull ? this.sphereScratch : undefined);
    // GPU culling covers the leading opaque / alpha-mask batches (queue id < 2); transparent batches stay on the CPU path.
    let nCullBatches = 0;
    if (gpuCull) while (nCullBatches < this.drawState.batches.count && this.drawState.batches.queue[nCullBatches] < 2) nCullBatches++;
    const total01 = lists[0].count + lists[1].count;
    if (gpuCull) {
      this.culler ??= new GPUCuller(this.gpu);
      this.culler.prepare(this.drawState.batches, nCullBatches, total01, this.sphereScratch, byteOffset / INSTANCE_BYTES, this.meshes, this.gpuLOD ? (m) => this.gpuLodIndex.groupOf(m) : undefined);
    }
    if (rw.hasCamera && !view) this.shadows.prepare(rw, this.instanceAlloc);
    this.instanceAlloc.flush();
    if (!view) st.bufferUploadBytes = this.instanceAlloc.bytesUploadedThisFrame + this.transformBuffer.lastUploadBytes;
    if (!view && this.batching !== 'unsorted') {
      for (const l of lists) {
        const c = countSwitches(l, rw, this.materials.materials, this.meshes.records);
        st.pipelineSwitches += c.pipeline; st.materialSwitches += c.material; st.meshSwitches += c.mesh;
      }
    }
    const f = this.drawState.frame;
    f.total = total; f.total01 = total01; f.byteOffset = byteOffset; f.instData = instData; f.gpuCull = gpuCull; f.nCullBatches = nCullBatches;
    this.markLateBatches();
  }

  /** Flag the batches drawn after the opaque geometry + sky (blended surfaces, transmissive materials) and note whether transmission is needed. */
  private markLateBatches(): void {
    const b = this.drawState.batches, mats = this.materials.materials;
    if (b.late.length < b.count) b.late = new Uint8Array(Math.max(b.count, b.late.length * 2));
    let transmissive = false;
    for (let i = 0; i < b.count; i++) {
      const t = b.queue[i] < 2 && (mats[b.materialId[i]].features & MaterialFeature.Transmission) !== 0;
      b.late[i] = b.queue[i] === 2 || t ? 1 : 0;
      if (t) transmissive = true;
    }
    this.drawState.frame.transmissive = transmissive;
  }

  /**
   * Declare this frame's passes in the render graph (shadows, clusters, particles, prepass, culling, fog, main pass(es)),
   * then compile and execute it into `enc`. The graph orders passes by their declared reads/writes and drops unused ones.
   */
  private recordPasses(enc: GPUCommandEncoder, rw: RenderWorld, L: LightData, time: number): void {
    const cam = rw.camera, f = this.drawState.frame;
    const g = this.graph;
    g.reset();
    if (rw.hasCamera && this.shadows.layers.length) {
      g.addPass({ name: 'shadows', writes: ['shadowMap'], execute: (e) => this.shadows.encode(e, this.objectBindGroup(), time, this.profiler) });
    }
    if (f.useClusters && rw.hasCamera) {
      g.addPass({ name: 'clusters', reads: ['lights'], writes: ['clusterGrid'], execute: (e) => this.clusters.encode(e, cam.view, cam.projection[0], cam.projection[5], cam.near, cam.far, L, this.profiler.writes('clusters')) });
    }
    this.features.addPasses(g, this.featureFrame);
    const twoPhase = f.gpuCull && this.gpuCulling === 'hiz2';
    const prepass = this.depthPrepass && rw.hasCamera && f.total > 0;
    this.prepassActive = prepass;
    if (prepass) this.addDepthPrepass(g);
    if (f.gpuCull) this.addCullingPasses(g, rw, twoPhase);
    if (this.fog?.enabled && rw.hasCamera) {
      const camWorld = Mat4.invert(Mat4.create(), cam.view);
      if (camWorld) g.addPass({ name: 'volumetrics', reads: ['shadowMap', 'clusterGrid', 'lights'], writes: ['fogVolume'], execute: (e) => this.fog!.encode(e, this.frameUniform.bindGroup, camWorld, cam.projection[0], cam.projection[5], cam.near, this.profiler.writes('fog')) });
    }
    if (twoPhase) this.addTwoPhaseMainPasses(g, rw);
    else this.addMainPass(g, rw, prepass);
    if (this.post.needsAux) this.addAuxPass(g, rw);
    if (this.post.enabled) this.features.addPostPasses(g, { ...this.featureFrame, sceneTexture: this.post.sceneTexture, width: this.gpu.canvas.width, height: this.gpu.canvas.height });
    this.post.addPasses(g, { projection: cam.projection, depthView: this.depthSampleView, depthSamples: this.target.sampleCount });
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
      if (rw.hasCamera && this.drawState.frame.total > 0) {
        ap.setBindGroup(0, this.frameUniform.bindGroup); ap.setBindGroup(1, this.sceneResources.bindGroup); ap.setBindGroup(3, this.objectBindGroup());
        ap.setVertexBuffer(0, this.meshes.vertexBuffer); ap.setIndexBuffer(this.meshes.indexBuffer, 'uint32');
        let pp: GPURenderPipeline | null = null, pm = -1;
        const b = this.drawState.batches;
        for (let i = 0; i < b.count; i++) {
          if (b.queue[i] > 1) continue;   // blended surfaces have no depth to reflect from or occlude with
          const mesh = this.meshes.get(b.meshId[i]);
          const pipe = this.materials.getAuxPipeline(b.materialId[i], mesh.deformMask, this.target.depthFormat ?? DEPTH_FORMAT, this.target.sampleCount, AUX_FORMAT);
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
      const b = this.drawState.batches;
      for (let i = 0; i < b.count; i++) {
        if (b.queue[i] > 1) continue;   // transparent surfaces never write depth
        const mesh = this.meshes.get(b.meshId[i]);
        const pipe = this.materials.getPrepassPipeline(b.materialId[i], mesh.deformMask, this.target.depthFormat ?? DEPTH_FORMAT, this.target.sampleCount);
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
    const cam = rw.camera, f = this.drawState.frame;
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
  private drawGeometry(pass: GPURenderPassEncoder, which: 'all' | 'culled' | 'rest', argBase: number, part: 'all' | 'early' | 'late' = 'all'): void {
    const f = this.drawState.frame, st = this.stats, gpuCull = f.gpuCull;
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
      const pipe = this.pipelineFor(matId, deformMask);
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
    const b = this.drawState.batches;
    let curMesh = -1;
    for (let i = gpuCull ? f.nCullBatches : 0; i < b.count; i++) {
      if (skip(b.late[i] === 1)) continue;
      const matId = b.materialId[i];
      const meshId = b.meshId[i];
      const mesh = this.meshes.get(meshId);
      const pipe = this.pipelineFor(matId, mesh.deformMask);
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

  /** The environment background (drawn after the opaque geometry, before blended surfaces). */
  private drawSky(pass: GPURenderPassEncoder, rw: RenderWorld): void {
    if (rw.hasCamera && this.showSkybox && this.sceneResources.env.enabled) this.skybox.draw(pass, this.target, this.frameUniform.bindGroup, this.sceneResources.bindGroup);
  }

  /** Draws that follow opaque + transparent geometry in the main pass: skybox (unless drawn separately), particles, ribbons, overlays. */
  private drawExtras(pass: GPURenderPassEncoder, rw: RenderWorld, sky = true): void {
    if (sky) this.drawSky(pass, rw);
    this.features.drawMain(pass, this.featureFrame);   // after opaque + transparent geometry: particles, ribbons, lines / points / sprites / text, custom features
  }

  /** Update the per-frame object handed to the features' hooks. */
  private fillFeatureFrame(rw: RenderWorld, time: number): void {
    const f = this.featureFrame;
    f.camera = rw.camera; f.hasCamera = rw.hasCamera; f.time = time;
    f.sceneBindGroup = this.sceneResources.bindGroup;
  }

  /** Resources the main pass(es) read, declared so the render graph orders them after their producers. */
  private static readonly MAIN_READS = ['shadowMap', 'clusterGrid', 'lights', 'fogVolume'];

  /** Resources the main pass(es) read: the engine's own plus whatever the registered features produce. */
  private get mainReads(): string[] { return [...Renderer.MAIN_READS, ...this.features.producedResources]; }

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
    if (this.target.sampleCount > 1) return { view: this.post.msaaView, resolveTarget: final, clearValue: this.mainClearValue(), loadOp, storeOp: keepMsaa ? 'store' : 'discard' };
    return { view: final, clearValue: this.mainClearValue(), loadOp, storeOp: 'store' };
  }

  /** The standard single main pass: clear (or load the prepass depth), draw geometry, then skybox / particles / ribbons. */
  private addMainPass(g: RenderGraph, rw: RenderWorld, prepass: boolean): void {
    const geometry = (pass: GPURenderPassEncoder, part: 'early' | 'late'): void => {
      if (rw.hasCamera && this.drawState.frame.total > 0) this.drawGeometry(pass, 'all', 0, part);
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
        this.drawSky(pass, rw);
        geometry(pass, 'late');
        this.drawExtras(pass, rw, false);
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
      this.drawSky(pass, rw);
      pass.end();
    } });
    g.addPass({ name: 'transmission-copy', reads: ['sceneColor'], writes: ['transmissionTex'], execute: (enc) => this.transmission.copyFrom(enc, this.post.sceneTexture) });
    g.addPass({ name: 'main-late', reads: ['transmissionTex', ...this.features.producedResources], writes: ['sceneColor'], execute: (enc) => {
      const pass = enc.beginRenderPass({
        label: 'main-late', colorAttachments: [this.mainColorAttachment(false)], depthStencilAttachment: depthAttachment(true),
      });
      geometry(pass, 'late');
      this.drawExtras(pass, rw, false);
      pass.end();
    } });
  }

  /**
   * Two-phase occlusion culling (`hiz2`). Phase A draws what was visible last frame (clears the targets); the depth is turned into a
   * Hi-Z pyramid; cull-B tests everything else against it; phase B draws the newly visible rest (loads the targets) plus extras.
   */
  private addTwoPhaseMainPasses(g: RenderGraph, rw: RenderWorld): void {
    const cam = rw.camera, f = this.drawState.frame;
    const srcBase = f.byteOffset / INSTANCE_BYTES;
    g.addPass({ name: 'main-A', reads: [...this.mainReads, 'culledA'], writes: ['depth', 'color'], execute: (enc) => {
      const pass = enc.beginRenderPass({
        label: 'main-A', timestampWrites: this.profiler.writes('mainA'),
        colorAttachments: [this.mainColorAttachment(true)],
        depthStencilAttachment: { view: this.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      if (f.total > 0) this.drawGeometry(pass, 'culled', 0);
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
      if (f.total > 0) { this.drawGeometry(pass, 'culled', this.culler!.virtualCount); this.drawGeometry(pass, 'rest', 0); }
      this.drawExtras(pass, rw);
      pass.end();
    } });
  }
}
