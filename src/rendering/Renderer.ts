import type { GPUContext } from '../gpu/GPUContext';
import { DynamicBufferAllocator } from '../gpu/DynamicBufferAllocator';
import { createBindLayouts, type BindLayouts } from '../gpu/BindLayouts';
import { MeshManager } from './MeshManager';
import { MaterialManager, type PassTarget } from './materials/MaterialManager';
import { RenderQueueBuilder, RenderQueues, countSwitches } from './RenderQueue';
import { BatchList, INSTANCE_BYTES, INSTANCE_WORDS, buildBatches } from './BatchBuilder';
import { TransformBuffer } from './TransformBuffer';
import { JointMatrixBuffer } from './JointMatrixBuffer';
import { MorphWeightBuffer } from './MorphWeightBuffer';
import { ParticleSystem } from '../particles/ParticleSystem';
import { RibbonSystem, type RibbonSystemConfig } from '../particles/RibbonSystem';
import { LODLibrary, LODSystem } from '../visibility/LODSystem';
import { SceneResources } from './lighting/SceneResources';
import { IBLBaker, type Environment } from './lighting/IBL';
import skyboxSource from '../shaders/skybox.wgsl?raw';
import { TextureStreamer, type StreamedTexture } from '../streaming/TextureStreamer';
import { VolumetricFog, type FogSettings } from './lighting/VolumetricFog';
import { Mat4 } from '../math/Mat4';
import { GPUCuller, type GPULodGroup } from './GPUCuller';
import { HiZ } from './HiZ';
import { RenderGraph } from './RenderGraph';
import { GPUProfiler } from '../profiling/GPUProfiler';
import { ShadowSystem } from './shadows/ShadowSystem';
import { ClusterGrid } from './lighting/ClusterGrid';
import { LightData } from './lighting/LightData';
import { RendererStats } from '../profiling/RendererStats';
import type { RenderWorld } from './RenderWorld';
import type { VisibleSet } from '../visibility/VisibilitySystem';

const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

/** Strategy used to turn the visible set into draw calls (benchmark A compares these). */
export type BatchingMode = 'unsorted' | 'sorted' | 'instanced';

export interface SceneSettings {
  /** Direction TOWARD the sun (does not need to be normalized). */
  sunDirection: [number, number, number];
  sunColor: [number, number, number];
  ambientSky: [number, number, number];
  ambientGround: [number, number, number];
}

export const DEFAULT_SCENE: SceneSettings = {
  sunDirection: [0.4, 0.8, 0.5], sunColor: [3, 2.9, 2.7], ambientSky: [0.25, 0.3, 0.4], ambientGround: [0.08, 0.07, 0.06],
};


/**
 * Conventional CPU-driven renderer: RenderWorld -> (visible set) -> render queues -> batches -> draws.
 * Reads only the RenderWorld. All GPU resources come from the shared managers.
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
  /** LOD groups and the CPU LOD selector (run after culling; see applyLOD). */
  /** GPU resources behind bind group 1 (lights, clusters, shadows, environment). */
  readonly sceneResources: SceneResources;
  readonly lodLibrary: LODLibrary;
  readonly lod: LODSystem;
  /** Ribbon / trail systems (one draw call each). */
  readonly ribbonSystems: RibbonSystem[] = [];
  batching: BatchingMode = 'instanced';
  clearColor = { r: 0.05, g: 0.06, b: 0.09, a: 1 };

  private depthTexture!: GPUTexture;
  private depthView!: GPUTextureView;
  private target: PassTarget;
  private frameBuffer: GPUBuffer;
  private frameBG: GPUBindGroup;
  private transformBuffer: TransformBuffer;
  private instanceAlloc: DynamicBufferAllocator;
  private frameData = new Float32Array(56);

  private queueBuilder = new RenderQueueBuilder();
  private queues = new RenderQueues();
  private batches = new BatchList();

  // per-material pipeline cache (avoids rebuilding key strings per batch)
  // legacy SceneSettings -> lights (rebuilt only when the settings change, so the upload gate stays quiet)
  private legacy = new LightData();
  private legacyKey = '';
  private legacyLights(scene: SceneSettings): LightData {
    const key = JSON.stringify(scene);
    if (key !== this.legacyKey) {
      this.legacyKey = key;
      const L = this.legacy, sl = Math.hypot(...scene.sunDirection) || 1;
      L.clear();
      L.add({ type: 0, position: [0, 0, 0], direction: [-scene.sunDirection[0] / sl, -scene.sunDirection[1] / sl, -scene.sunDirection[2] / sl], color: scene.sunColor, intensity: 1, range: 0, innerCone: 0, outerCone: 0 });
      L.add({ type: 3, position: [0, 0, 0], direction: [0, -1, 0], color: scene.ambientSky, intensity: 1, range: 0, innerCone: 0, outerCone: 0, groundColor: scene.ambientGround });
      L.finalize();
    }
    return this.legacy;
  }

  private targetPre: PassTarget;
  private pipeCache: (GPURenderPipeline | undefined)[] = [];
  private pipeSort: number[] = [];
  private pipeFailed: boolean[] = [];

  constructor(private gpu: GPUContext) {
    const { device, resources: r } = gpu;
    this.layouts = createBindLayouts(device);
    this.meshes = new MeshManager(device, r.buffers);
    this.materials = new MaterialManager(device, r, this.layouts);
    this.lodLibrary = new LODLibrary(this.meshes);
    this.lod = new LODSystem(this.lodLibrary);
    this.target = { colorFormat: gpu.format, depthFormat: DEPTH_FORMAT, sampleCount: 1 };
    this.targetPre = { ...this.target, depthEqual: true };

    this.frameBuffer = r.buffers.create('FrameUniformBuffer', this.frameData.byteLength, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.sceneResources = new SceneResources(gpu, this.layouts);
    this.frameBG = device.createBindGroup({ label: 'frame-bg', layout: this.layouts.frame, entries: [{ binding: 0, resource: { buffer: this.frameBuffer } }] });

    this.transformBuffer = new TransformBuffer(device, r.buffers);
    this.joints = new JointMatrixBuffer(device, r.buffers);
    this.morphWeights = new MorphWeightBuffer(device, r.buffers);
    this.instanceAlloc = new DynamicBufferAllocator(device, r.buffers, {
      // 768 = lcm(48-byte instance record, 256-byte storage alignment): every frame region starts at an
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
   * 'hiz' additionally occlusion-culls against a depth pyramid of this frame's depth prepass (enables the prepass automatically).
   */
  gpuCulling: 'off' | 'frustum' | 'hiz' | 'hiz2' = 'off';
  /** Optional texture streaming (mip residency follows on-screen coverage); see `setTextureStreamer`. */
  textureStreamer: TextureStreamer | null = null;
  private streamRefs = new Map<number, StreamedTexture[]>();
  /** Volumetric fog (null until `enableFog`). */
  fog: VolumetricFog | null = null;
  /** With GPU culling on: select LOD levels in the culling shader (batches of LOD-group meshes expand into one draw per level). */
  gpuLOD = false;
  private lodByMesh = new Map<number, GPULodGroup>();
  private lodMapGroups = -1;
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
  private skyPipeline: GPURenderPipeline | null = null;
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
    return this.materials.warmup(this.prepassActive || this.depthPrepass ? this.targetPre : this.target, deformMasks);
  }

  setTextureStreamer(s: TextureStreamer | null): void {
    this.textureStreamer = s; this.streamRefs.clear();
    if (s) s.onViewChanged = (t) => this.materials.textureChanged(t);
  }

  /** Report per-material screen coverage to the streamer, then apply its plan (before the frame's bind groups are used). */
  private streamTextures(rw: RenderWorld, visible: VisibleSet | null, vCount: number): void {
    const s = this.textureStreamer!;
    s.beginFrame();
    const cam = rw.camera, tanHalf = Math.tan(cam.fovY / 2), H = this.gpu.canvas.height, sph = rw.boundsSphere;
    const px = new Map<number, number>();
    for (let n = 0; n < vCount; n++) {
      const slot = visible ? visible.slots![n] : n;
      const dx = sph[slot * 4] - cam.position[0], dy = sph[slot * 4 + 1] - cam.position[1], dz = sph[slot * 4 + 2] - cam.position[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz), r = sph[slot * 4 + 3];
      const pixels = d <= r ? H : (r / (d * tanHalf)) * H;
      const m = rw.materialId[slot];
      if (pixels > (px.get(m) ?? 0)) px.set(m, pixels);
    }
    for (const [m, pixels] of px) {
      let refs = this.streamRefs.get(m);
      if (!refs) { refs = this.materials.get(m).textures.filter((t): t is StreamedTexture => !!t && s.textures.includes(t as StreamedTexture)); this.streamRefs.set(m, refs); }
      for (const t of refs) s.touch(t, pixels);
    }
    s.update();
  }

  /** Lazily created IBL baker (procedural sky / HDR / BRDF LUT generation). */
  get ibl(): IBLBaker { return (this.baker ??= new IBLBaker(this.gpu)); }

  /** Bind an environment for image-based lighting (null = back to the hemisphere ambient term). */
  setEnvironment(env: Environment | null, intensity = 1, rotation = 0): void {
    this.sceneResources.setEnvironment(env, env ? this.ibl.brdfLut() : undefined, intensity, rotation);
  }

  private skyboxPipeline(): GPURenderPipeline {
    return (this.skyPipeline ??= (() => {
      const module = this.gpu.resources.shaders.get('skybox', skyboxSource, { HAS_SKINNING: false, HAS_MORPH_TARGETS: false });
      return this.gpu.device.createRenderPipeline({
        label: 'skybox', layout: this.gpu.device.createPipelineLayout({ bindGroupLayouts: [this.layouts.frame, this.layouts.scene] }),
        vertex: { module, entryPoint: 'vs_main' },
        fragment: { module, entryPoint: 'fs_main', targets: [{ format: this.target.colorFormat ?? this.gpu.format }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: this.target.depthFormat ?? DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less-equal' },
      });
    })());
  }

  /** LOD group that `meshId` belongs to (any of its levels), for GPU LOD. */
  private lodGroupOfMesh(meshId: number): GPULodGroup | null {
    const groups = this.lodLibrary.groups;
    if (groups.length !== this.lodMapGroups) {
      this.lodByMesh.clear();
      for (const g of groups) for (const l of g.levels) if (!this.lodByMesh.has(l.meshId)) this.lodByMesh.set(l.meshId, g);
      this.lodMapGroups = groups.length;
    }
    return this.lodByMesh.get(meshId) ?? null;
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

  /** Create the GPU particle system bound to this renderer's frame layout / render target. */
  enableParticles(): ParticleSystem {
    this.particles ??= new ParticleSystem(this.gpu, this.layouts, this.meshes, { colorFormat: this.gpu.format, depthFormat: this.target.depthFormat, sampleCount: this.target.sampleCount });
    return this.particles;
  }

  /** Create a ribbon system (trails, beams/chains, flat streaks) bound to this renderer's frame layout / render target. */
  createRibbonSystem(config: RibbonSystemConfig): RibbonSystem {
    const rs = new RibbonSystem(this.gpu, this.layouts, { colorFormat: this.gpu.format, depthFormat: this.target.depthFormat, sampleCount: this.target.sampleCount }, config);
    this.ribbonSystems.push(rs);
    return rs;
  }

  resize(width: number, height: number): void {
    const { resources: r } = this.gpu;
    if (this.depthTexture) r.textures.destroy(this.depthTexture);
    this.depthTexture = r.textures.create({
      label: 'depth', size: [Math.max(1, width), Math.max(1, height)], format: DEPTH_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.depthView = this.depthTexture.createView();
  }

  /** Pipeline for (material, mesh deform variant); cached per pair to avoid rebuilding key strings per batch. */
  private pipelineFor(materialId: number, deformMask: number): GPURenderPipeline {
    const m = this.materials.get(materialId);
    const slot = materialId * 4 + deformMask;
    if (this.prepassActive) return this.materials.getPipeline(materialId, this.targetPre, deformMask);
    const cached = this.pipeCache[slot];
    if (cached && this.pipeSort[slot] === m.pipelineSortId && this.pipeFailed[slot] === m.failed) return cached;
    const p = this.materials.getPipeline(materialId, this.target, deformMask);
    this.pipeCache[slot] = p; this.pipeSort[slot] = m.pipelineSortId; this.pipeFailed[slot] = m.failed;
    return p;
  }

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
        { binding: 4, resource: { buffer: m.skin.buffer } },
        { binding: 5, resource: { buffer: m.morphPosition.buffer } },
        { binding: 6, resource: { buffer: m.morphNormal.buffer } },
        { binding: 7, resource: { buffer: m.morphTangent.buffer } },
      ],
    }));
  }

  /** Render one frame from the RenderWorld. `visible` null = every object. */
  render(rw: RenderWorld, scene: SceneSettings = DEFAULT_SCENE, time = 0, visible: VisibleSet | null = null): void {
    const { device, context, queue } = this.gpu;
    const st = this.stats;
    if (this.depthTexture.width !== this.gpu.canvas.width || this.depthTexture.height !== this.gpu.canvas.height) this.resize(this.gpu.canvas.width, this.gpu.canvas.height);   // keep depth matched to the swapchain
    st.reset();
    const t0 = performance.now();
    const cam = rw.camera;
    const vCount = visible ? visible.count : rw.count;
    st.renderables = rw.count;
    st.visible = vCount;
    st.frustumTested = visible?.tested ?? 0;
    st.frustumRejected = visible?.rejected ?? 0;
    st.cpu.culling = visible?.cullMs ?? 0;
    if (this.pendingLod) { st.lodCounts.set(this.lod.counts); st.lodCulled = this.lod.culled; this.pendingLod = false; }

    // ---- uploads: frame/scene uniforms, transforms (sparse), materials (dirty range)
    const fd = this.frameData;
    fd.set(cam.viewProjection, 0); fd.set(cam.view, 16); fd.set(cam.projection, 32);
    fd.set(cam.position, 48); fd[51] = time;
    fd[52] = this.gpu.canvas.width; fd[53] = this.gpu.canvas.height; fd[54] = cam.near; fd[55] = cam.far;
    queue.writeBuffer(this.frameBuffer, 0, fd);
    // Lights come from the ECS (rw.lights). If the scene defines none, fall back to the legacy SceneSettings sun + ambient.
    let L = rw.lights;
    if (L.count === 0 && L.ambientSky[0] === 0 && L.ambientSky[1] === 0 && L.ambientSky[2] === 0) L = this.legacyLights(scene);
    if (this.textureStreamer && rw.hasCamera) this.streamTextures(rw, visible, vCount);
    this.shadows.assign(L, cam);
    if (this.fog && rw.hasCamera) { this.fog.resize(this.gpu.canvas.width, this.gpu.canvas.height); this.fog.applySettings(); }
    this.sceneResources.syncLights(L);
    const useClusters = this.clusteredShading && L.count > L.globalCount;
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
    const t1 = performance.now();
    st.cpu.upload = t1 - t0;

    // ---- queues (sorting)
    this.queueBuilder.build(rw, visible ? visible.slots : null, vCount, this.materials.materials, this.meshes.records, cam,
      this.batching === 'unsorted' ? 'none' : 'sorted', this.queues);
    const t2 = performance.now();
    st.cpu.sorting = t2 - t1;

    // ---- batching + instance data written straight into the ring buffer
    const lists = this.queues.ordered;
    const total = lists[0].count + lists[1].count + lists[2].count;
    this.instanceAlloc.beginFrame();
    const byteOffset = this.instanceAlloc.allocate(Math.max(total, 1) * INSTANCE_BYTES);
    if (byteOffset % INSTANCE_BYTES !== 0) throw new Error('instance buffer offset is not record-aligned');
    const local = this.instanceAlloc.localOffset(byteOffset) / 4;
    const instData = this.instanceAlloc.uint32.subarray(local, local + total * INSTANCE_WORDS);
    const gpuCull = this.gpuCulling !== 'off' && rw.hasCamera && total > 0;
    if (gpuCull && this.sphereScratch.length < total * 4) this.sphereScratch = new Float32Array(Math.max(total * 4, this.sphereScratch.length * 2));
    buildBatches(lists, rw, this.meshes.records, instData, byteOffset / INSTANCE_BYTES, this.batching === 'instanced' ? 'instanced' : 'individual', this.batches, gpuCull ? this.sphereScratch : undefined);
    const nCullBatches = gpuCull ? (() => { let n = 0; while (n < this.batches.count && this.batches.queue[n] < 2) n++; return n; })() : 0;
    const total01 = lists[0].count + lists[1].count;
    if (gpuCull) { this.culler ??= new GPUCuller(this.gpu); this.culler.prepare(this.batches, nCullBatches, total01, this.sphereScratch, byteOffset / INSTANCE_BYTES, this.meshes, this.gpuLOD && this.gpuCulling !== 'hiz' ? (m) => this.lodGroupOfMesh(m) : undefined); }
    if (rw.hasCamera) this.shadows.prepare(rw, this.instanceAlloc);
    this.instanceAlloc.flush();
    st.bufferUploadBytes = this.instanceAlloc.bytesUploadedThisFrame + this.transformBuffer.lastUploadBytes;
    const t3 = performance.now();
    st.cpu.batching = t3 - t2;
    if (this.batching !== 'unsorted') {
      for (const l of lists) {
        const c = countSwitches(l, rw, this.materials.materials, this.meshes.records);
        st.pipelineSwitches += c.pipeline; st.materialSwitches += c.material; st.meshSwitches += c.mesh;
      }
    }

    // ---- encode
    const enc = device.createCommandEncoder();
    this.profiler.beginFrame();
    const g = this.graph;
    g.reset();
    if (rw.hasCamera && this.shadows.layers.length) {
      g.addPass({ name: 'shadows', writes: ['shadowMap'], execute: (e) => this.shadows.encode(e, this.objectBindGroup(), time, this.profiler) });
    }
    if (useClusters && rw.hasCamera) {
      g.addPass({ name: 'clusters', reads: ['lights'], writes: ['clusterGrid'], execute: (e) => this.clusters.encode(e, cam.view, cam.projection[0], cam.projection[5], cam.near, cam.far, L, this.profiler.writes('clusters')) });
    }
    if (this.particles) g.addPass({ name: 'particles-sim', writes: ['particles'], execute: (e) => this.particles!.encodeCompute(e) });   // emit/simulate/compact before any draw reads them
    if (this.ribbonSystems.length) g.addPass({ name: 'ribbons-update', writes: ['ribbons'], execute: (e) => { for (const rs of this.ribbonSystems) rs.encodeCompute(e); } });
    const useHiz = gpuCull && this.gpuCulling === 'hiz';
    const prepass = (this.depthPrepass || useHiz) && rw.hasCamera && total > 0;
    this.prepassActive = prepass;
    if (prepass) g.addPass({ name: 'depth-prepass', writes: ['depth'], execute: (enc) => {
      const dp = enc.beginRenderPass({
        label: 'depth-prepass', colorAttachments: [], timestampWrites: this.profiler.writes('prepass'),
        depthStencilAttachment: { view: this.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      dp.setBindGroup(0, this.frameBG); dp.setBindGroup(1, this.sceneResources.bindGroup); dp.setBindGroup(3, this.objectBindGroup());
      dp.setVertexBuffer(0, this.meshes.vertexBuffer); dp.setIndexBuffer(this.meshes.indexBuffer, 'uint32');
      let pp: GPURenderPipeline | null = null, pm = -1;
      const b = this.batches;
      for (let i = 0; i < b.count; i++) {
        if (b.queue[i] > 1) continue;   // transparent surfaces never write depth
        const mesh = this.meshes.get(b.meshId[i]);
        const pipe = this.materials.getPrepassPipeline(b.materialId[i], mesh.deformMask, this.target.depthFormat ?? DEPTH_FORMAT);
        if (pipe !== pp) { dp.setPipeline(pipe); pp = pipe; }
        if (b.materialId[i] !== pm) { dp.setBindGroup(2, this.materials.getBindGroup(b.materialId[i])); pm = b.materialId[i]; }
        dp.drawIndexed(mesh.indexCount, b.instanceCount[i], mesh.firstIndex, mesh.baseVertex, b.firstInstance[i]);
      }
      dp.end();
    } });
    const twoPhase = gpuCull && this.gpuCulling === 'hiz2';
    const hizArg = () => ({ view: this.hiz!.fullView!, width: this.hiz!.width, height: this.hiz!.height, mips: this.hiz!.mips });
    const srcBase = byteOffset / INSTANCE_BYTES;
    if (gpuCull) {
      if (useHiz || twoPhase) {
        this.hiz ??= new HiZ(this.gpu);
        this.hiz.resize(this.gpu.canvas.width, this.gpu.canvas.height);
      }
      if (twoPhase) {
        let maxObj = 0;
        for (let i = 0; i < total01; i++) maxObj = Math.max(maxObj, instData[i * INSTANCE_WORDS + 6]);
        this.culler!.ensureVisibility(maxObj + 1);
        g.addPass({ name: 'cull-A', reads: [], writes: ['culledA'],
          execute: (e) => this.culler!.encode(e, this.instanceAlloc.buffer, srcBase, cam.frustum.planes, cam.viewProjection, null, this.profiler.writes('cullA'), 1, cam) });
      } else if (useHiz) {
        g.addPass({ name: 'hiz-build', reads: ['depth'], writes: ['hizTex'], execute: (e) => this.hiz!.encode(e, this.depthTexture.createView(), this.profiler.writes('hiz')) });
      }
      if (!twoPhase) {
        g.addPass({
          name: 'gpu-cull', reads: useHiz ? ['hizTex'] : [], writes: ['culled'],
          execute: (e) => this.culler!.encode(e, this.instanceAlloc.buffer, srcBase, cam.frustum.planes, cam.viewProjection, useHiz ? hizArg() : null, this.profiler.writes('cull'), 0, cam),
        });
      }
    }
    // One draw loop for the opaque/alpha batches (CPU draws, or indirect draws from the culled set at argBase) and the rest.
    const drawGeometry = (pass: GPURenderPassEncoder, which: 'all' | 'culled' | 'rest', argBase: number): void => {
      pass.setBindGroup(0, this.frameBG);
      pass.setBindGroup(1, this.sceneResources.bindGroup);
      pass.setBindGroup(3, gpuCull && which !== 'rest' ? this.objectBindGroup(true) : this.objectBindGroup());
      pass.setVertexBuffer(0, this.meshes.vertexBuffer);
      pass.setIndexBuffer(this.meshes.indexBuffer, 'uint32');
      let curPipe: GPURenderPipeline | null = null, curMat = -1;
      const bind = (matId: number, deformMask: number): void => {
        const pipe = this.pipelineFor(matId, deformMask);
        if (pipe !== curPipe) { pass.setPipeline(pipe); curPipe = pipe; }
        if (matId !== curMat) { pass.setBindGroup(2, this.materials.getBindGroup(matId)); curMat = matId; }
      };
      if (gpuCull && which !== 'rest') {
        // GPU-compacted draws: one indirect draw per (batch, LOD level)
        const cu = this.culler!;
        for (let v = 0; v < cu.virtualCount; v++) {
          bind(cu.virtualMaterial[v], this.meshes.get(cu.virtualMesh[v]).deformMask);
          pass.drawIndexedIndirect(cu.argsBuffer, (argBase + v) * 20);
          st.drawCalls++;
        }
      }
      if (which === 'culled') return;
      if (gpuCull && which === 'all') pass.setBindGroup(3, this.objectBindGroup());   // remaining batches use the uncompacted records
      const b = this.batches;
      let curMesh = -1;
      for (let i = gpuCull ? nCullBatches : 0; i < b.count; i++) {
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
    };
    const extras = (pass: GPURenderPassEncoder): void => {
      if (rw.hasCamera && this.showSkybox && this.sceneResources.env.enabled) {
        pass.setPipeline(this.skyboxPipeline());
        pass.setBindGroup(0, this.frameBG); pass.setBindGroup(1, this.sceneResources.bindGroup);
        pass.draw(3);
      }
      if (rw.hasCamera && this.particles && this.particles.pools.length) this.particles.encodeDraw(pass, this.frameBG);   // after opaque + transparent geometry
      if (rw.hasCamera) for (const rs of this.ribbonSystems) rs.encodeDraw(pass, this.frameBG);                            // one draw per ribbon system
    };
    const common = ['shadowMap', 'clusterGrid', 'particles', 'ribbons', 'lights', 'fogVolume'];
    if (this.fog?.enabled && rw.hasCamera) {
      const camWorld = Mat4.invert(Mat4.create(), cam.view);
      if (camWorld) g.addPass({ name: 'volumetrics', reads: ['shadowMap', 'clusterGrid', 'lights'], writes: ['fogVolume'], execute: (e) => this.fog!.encode(e, this.frameBG, camWorld, cam.projection[0], cam.projection[5], cam.near, this.profiler.writes('fog')) });
    }
    if (twoPhase) {
      // Phase A: draw what was visible last frame (clear). Pyramid from that depth. Phase B: draw the newly visible rest (load).
      let colorView: GPUTextureView | null = null;
      g.addPass({ name: 'main-A', reads: [...common, 'culledA'], writes: ['depth', 'color'], execute: (enc) => {
        colorView = context.getCurrentTexture().createView();
        const pass = enc.beginRenderPass({
          label: 'main-A', timestampWrites: this.profiler.writes('mainA'),
          colorAttachments: [{ view: colorView, clearValue: this.clearColor, loadOp: 'clear', storeOp: 'store' }],
          depthStencilAttachment: { view: this.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        });
        if (total > 0) drawGeometry(pass, 'culled', 0);
        pass.end();
      } });
      g.addPass({ name: 'hiz-build', reads: ['depth'], writes: ['hizTex'], execute: (e) => this.hiz!.encode(e, this.depthTexture.createView(), this.profiler.writes('hiz')) });
      g.addPass({ name: 'cull-B', reads: ['hizTex'], writes: ['culledB'],
        execute: (e) => this.culler!.encode(e, this.instanceAlloc.buffer, srcBase, cam.frustum.planes, cam.viewProjection, hizArg(), this.profiler.writes('cullB'), 2, cam) });
      g.addPass({ name: 'main-B', reads: ['culledB', 'depth', 'color', 'particles', 'ribbons'], writes: ['backbuffer'], sideEffect: true, execute: (enc) => {
        const pass = enc.beginRenderPass({
          label: 'main-B', timestampWrites: this.profiler.writes('mainB'),
          colorAttachments: [{ view: colorView!, loadOp: 'load', storeOp: 'store' }],
          depthStencilAttachment: { view: this.depthView, depthLoadOp: 'load', depthStoreOp: 'store' },
        });
        if (total > 0) { drawGeometry(pass, 'culled', this.culler!.virtualCount); drawGeometry(pass, 'rest', 0); }
        extras(pass);
        pass.end();
      } });
    } else {
      g.addPass({ name: 'main', reads: [...common, 'depth', 'culled'], writes: ['backbuffer'], sideEffect: true, execute: (enc) => {
        const pass = enc.beginRenderPass({
          label: 'main', timestampWrites: this.profiler.writes('main'),
          colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: this.clearColor, loadOp: 'clear', storeOp: 'store' }],
          depthStencilAttachment: { view: this.depthView, depthClearValue: 1, depthLoadOp: prepass ? 'load' : 'clear', depthStoreOp: 'store' },
        });
        if (rw.hasCamera && total > 0) drawGeometry(pass, 'all', 0);
        extras(pass);
        pass.end();
      } });
    }
    g.compile();
    g.execute(enc);
    this.profiler.resolve(enc);
    queue.submit([enc.finish()]);
    const t4 = performance.now();
    st.cpu.encoding = t4 - t3;
    st.cpu.total = t4 - t0;
  }
}
