import type { GPUContext } from '../gpu/GPUContext';
import type { FrameBuilder } from './graph/FrameGraph';
import type { TrackedRenderPass } from './graph/TrackedRenderPass';
import { MainPassNode, declareMainPass, srgbToLinear, type MainPassSegment } from './MainPassNode';
import type { BindLayouts } from '../gpu/BindLayouts';
import { FrameUniform } from './FrameUniform';
import type { MaterialManager } from './materials/MaterialManager';
import type { TextureRef } from './materials/Material';
import type { SceneResources, ViewScene } from './lighting/SceneResources';
import type { Environment, IBLBaker } from './lighting/IBL';
import type { RenderWorld } from './RenderWorld';
import { Camera } from './Camera';
import { RenderTarget, RENDER_TARGET_FORMAT, type RenderTargetDesc } from './RenderTarget';
import { RenderView, type RenderViewOptions } from './RenderView';
import { ViewState } from './RenderDrawState';
import { DEPTH_FORMAT } from './formats';
import { mirrorView, planeToView, obliqueProjection, cubeFaceView, cubeFaceProjection } from './viewMath';
import { VisibilitySystem } from '../visibility/VisibilitySystem';

/** The frame and scene uniforms of one view that is recorded into the frame (a uniform of its own, so several views can share one command encoder). */
export interface ViewSlot { frame: FrameUniform; scene: ViewScene; }

/** Everything an off-screen render needs besides the scene: a camera and the colour / depth views to draw into. */
export interface ViewJob {
  camera: Camera;
  /** The colour texture to draw into, and the array layer of it (a cube capture's face; 0 for a target). */
  colorTexture: GPUTexture;
  colorLayer: number;
  depthTexture: GPUTexture;
  width: number;
  height: number;
  clearColor: { r: number; g: number; b: number; a: number };
  /** Draw the environment as the background. */
  skybox: boolean;
  /** Culling for this camera. */
  visibility: VisibilitySystem;
  /** Objects whose material samples this texture are skipped (a target must not be read while it is written). */
  excludeRef: TextureRef | null;
  /** Objects to leave out (e.g. the object that shows the view). */
  exclude: ((entity: number) => boolean) | null;
  /** The view's own uniforms, for a view recorded into the frame (see {@link ViewHost.prepareJob}); a probe capture shares the main view's. */
  slot?: ViewSlot;
}

/** What `OffscreenViews` needs from the renderer: draw primitives that work on any view's draw state. */
export interface ViewHost {
  readonly clearColor: { r: number; g: number; b: number; a: number };
  readonly ibl: IBLBaker;
  /** Time of the frame being rendered (for the view's frame uniform). */
  readonly time: number;
  /** Queue and batch `objects` (already culled and filtered) for `job` into `view`'s draw state; the instance records are appended to this frame's ring. */
  buildBatches(job: ViewJob, view: ViewState, objects: { slots: Uint32Array | null; count: number }, rw: RenderWorld): void;
  /** Record the view's geometry: `early` = opaque + alpha-masked, `late` = blended. */
  drawGeometry(pass: TrackedRenderPass, view: ViewState, part: 'early' | 'late'): void;
  /** Record the environment background when the job wants it and the scene has one. */
  drawSky(pass: TrackedRenderPass, job: ViewJob, view: ViewState, frameBG: GPUBindGroup, sceneBG: GPUBindGroup): void;
}

/** Draw state of off-screen renders with one winding, plus the scratch list of objects they draw. */
interface Scratch { view: ViewState; slots: Uint32Array; }

/**
 * Off-screen rendering of the scene from other cameras: render targets, views (mirrors, minimaps, security cameras) and reflection-probe
 * capture. This class owns the whole life of a view - which views are due, mirror cameras, which objects each view skips, the view's own
 * uniforms and draw state, its render node in the frame - and uses the {@link ViewHost} for the draw primitives only. A frame runs
 * `renderDue` (prepare the due views) and then `declarePasses` (their render nodes, at the head of the frame); a probe capture
 * between frames draws right away.
 */
export class OffscreenViews {
  /** Registered views, rendered before the main view in registration order. */
  readonly views: RenderView[] = [];
  private targets: RenderTarget[] = [];
  private scratch = new Map<boolean, Scratch>();
  /** Draw state and uniforms of each registered view, kept while it is registered (the frame records the views after they were prepared, so each needs its own). */
  private viewStates = new Map<RenderView, Scratch>();
  private viewSlots = new Map<RenderView, ViewSlot>();
  /** Views prepared this frame, waiting to be declared as passes. */
  private pending: { job: ViewJob; view: ViewState }[] = [];
  private textureIds = new WeakMap<GPUTexture, number>();
  private textureCount = 0;
  /** The render node of a probe capture: one per colour texture and layer (a cube capture draws its six faces through six), released with the texture. */
  private captureNodes = new WeakMap<GPUTexture, Map<number, MainPassNode>>();
  private probeVisibility = new VisibilitySystem();

  constructor(
    private gpu: GPUContext, private layouts: BindLayouts, private materials: MaterialManager, private frame: FrameUniform, private scene: SceneResources, private host: ViewHost,
  ) {}

  /** Create an off-screen colour + depth buffer for a {@link RenderView} to draw into (see `RenderTarget.ref` for using it as a texture). */
  createRenderTarget(desc: RenderTargetDesc = {}): RenderTarget {
    const t = new RenderTarget(this.gpu, desc);
    t.onResized = (rt) => this.materials.textureChanged(rt.ref);
    this.targets.push(t);
    return t;
  }

  /** Destroy a render target (and the views drawing into it). Remove the materials that sample it first. */
  destroyRenderTarget(t: RenderTarget): void {
    for (const v of this.views.filter((x) => x.target === t)) this.removeView(v);
    const i = this.targets.indexOf(t);
    if (i >= 0) this.targets.splice(i, 1);
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
    const slot = this.viewSlots.get(v);
    if (slot) { slot.frame.destroy(); slot.scene.destroy(); }
    this.viewSlots.delete(v); this.viewStates.delete(v);
  }

  /**
   * Prepare every due view for the frame: write its uniforms and build its batches. The renderer records the views as passes of the frame, ahead of everything else,
   * so a view can show the result of an earlier one. Called after the main view's data is uploaded and its batches are built.
   */
  renderDue(rw: RenderWorld): void {
    this.pending.length = 0;
    for (const t of this.targets) if (t.scale) t.resize(this.gpu.canvas.width * t.scale, this.gpu.canvas.height * t.scale);
    const due: RenderView[] = [];
    for (const v of this.views) {
      if (!v.enabled) continue;
      if (++v.frameCounter >= v.interval) { v.frameCounter = 0; due.push(v); }
    }
    if (due.length === 0) return;
    for (const v of due) {
      if (v.mirror) {
        if (!rw.hasCamera) continue;
        this.setupMirrorCamera(v, rw.camera);
      }
      const s = this.stateFor(v);
      const job: ViewJob = {
        camera: v.camera, colorTexture: v.target.texture, colorLayer: 0, depthTexture: v.target.depthTexture, width: v.target.width, height: v.target.height,
        clearColor: v.clearColor ?? this.host.clearColor, skybox: v.skybox, visibility: v.visibility,
        excludeRef: v.target.ref, exclude: v.exclude, slot: this.slotFor(v),
      };
      this.prepare(job, s.view, this.visibleSlots(rw, job, s), rw);
      v.lastDrawn = s.view.draw.frame.total;
    }
  }

  /**
   * Declare the prepared views as render nodes `view:<n>` of the frame, in registration order and ahead of the frame's own passes (a view shows the shadow map and lights of the
   * last frame, as it always did). Each draws into its colour texture (or one face of a cube) and discards its depth; nothing in the frame is ordered against them.
   */
  declarePasses(g: FrameBuilder): void {
    this.pending.forEach(({ job, view }, i) => {
      const slot = job.slot!;
      view.sceneBindGroup = slot.scene.bindGroup;
      const segments = this.segments(job, view, slot.frame.bindGroup, view.sceneBindGroup);
      const image = g.importTexture(this.textureName(job.colorTexture, 'color'), job.colorTexture), depth = g.importTexture(this.textureName(job.depthTexture, 'depth'), job.depthTexture);
      // linear HDR colour (the clear colour converted), a fresh depth buffer nothing reads afterwards
      declareMainPass(g, `view:${i}`, { image, msaa: null, depth }, srgbToLinear(job.clearColor), { clear: true, depthLoad: false, depthStore: 'discard' }, segments, { layer: job.colorLayer });
    });
    this.pending.length = 0;
  }

  /**
   * Capture a reflection probe: render the scene from `position` into the six faces of a cube map and bake it into an
   * {@link Environment} (diffuse irradiance + prefiltered specular). Use it with `setEnvironment` (image-based lighting for the
   * whole scene) - e.g. capture inside a room once, or re-capture every few seconds. Call between frames with the current `rw`.
   */
  captureEnvironment(rw: RenderWorld, position: ArrayLike<number>, o: { size?: number; near?: number; far?: number; skybox?: boolean; exclude?: (entity: number) => boolean } = {}): Environment {
    const size = o.size ?? 128, near = o.near ?? 0.1, far = o.far ?? 500;
    const { ibl } = this.host;
    const source = ibl.createCaptureCube(size);
    const depth = this.gpu.resources.textures.create({ label: 'probe-depth', size: [size, size], format: DEPTH_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.gpu.resources.pipelines.unfreeze();
    this.probeVisibility.mode = 'linear';
    const cam = new Camera(), s = this.scratchFor(true);
    const view = new Float32Array(16), proj = cubeFaceProjection(new Float32Array(16), near, far);
    const mainFrame = this.frame.snapshot();
    for (let face = 0; face < 6; face++) {
      cubeFaceView(view, face, position[0], position[1], position[2]);
      cam.setMatrices(view, proj, near, far);
      this.render({
        camera: cam, colorTexture: source, colorLayer: face,
        depthTexture: depth, width: size, height: size, clearColor: this.host.clearColor, skybox: o.skybox ?? true,
        visibility: this.probeVisibility, excludeRef: null, exclude: o.exclude ?? null,
      }, s, rw);
    }
    this.restoreMainView(mainFrame);
    this.gpu.resources.textures.destroy(depth);
    return ibl.bakeCube(source, size);
  }

  // ---- internals ------------------------------------------------------------------------------------------------------------------

  /** Each job wrote its own frame / scene uniforms: put the main view's back before it continues (queue order: job writes, job submit, these writes, main submit). */
  private restoreMainView(mainFrame: Float32Array): void {
    this.frame.restore(mainFrame);
    this.scene.restoreUniform();
  }

  /** The view's own uniforms and batches, ready for the frame to record. */
  private prepare(job: ViewJob, view: ViewState, objects: { slots: Uint32Array | null; count: number }, rw: RenderWorld): void {
    const slot = job.slot!;
    slot.frame.writeView(job.camera, this.host.time, job.width, job.height, true);   // linear HDR output; the view's own uniforms, not the main view's
    slot.scene.write(this.gpu.queue);
    view.frameBindGroup = slot.frame.bindGroup;
    this.host.buildBatches(job, view, objects, rw);
    this.pending.push({ job, view });
  }

  /**
   * Cull for the job's camera, drop what it must not show, then draw it right away as a mini frame of its own (own queues and batches, one command buffer, one submit): the main
   * view's uniforms are overwritten for it, so callers restore them afterwards. Shading is linear HDR (no tone mapping), lighting is the plain light loop (no clusters, no fog
   * volume), shadows are the main view's. Features do not run: no particles, ribbons, overlays or post-processing.
   */
  private render(job: ViewJob, s: Scratch, rw: RenderWorld): void {
    const objects = this.visibleSlots(rw, job, s), view = s.view;
    this.frame.writeView(job.camera, this.host.time, job.width, job.height, true);   // the colour is used as a texture; no opaque copy, so views refract the environment
    this.scene.writeViewUniform();
    this.host.buildBatches(job, view, objects, rw);
    const enc = this.gpu.device.createCommandEncoder({ label: 'view' });
    this.captureNode(job).run(enc, { final: job.colorTexture, layer: job.colorLayer, msaa: null, depth: job.depthTexture, clear: srgbToLinear(job.clearColor) },
      { clear: true, depthLoad: false, depthStore: 'discard' }, this.segments(job, view, this.frame.bindGroup, this.scene.bindGroup));
    this.gpu.queue.submit([enc.finish()]);
  }

  /** The draws of a view in order: opaque + alpha-masked geometry, the sky, blended geometry; `frameBG` / `sceneBG` are the uniforms it draws with. */
  private segments(job: ViewJob, view: ViewState, frameBG: GPUBindGroup, sceneBG: GPUBindGroup): MainPassSegment[] {
    const total = view.draw.frame.total;
    return [
      { name: 'scene:early', record: (pass) => { if (total > 0) this.host.drawGeometry(pass, view, 'early'); } },
      { name: 'skybox', record: (pass) => this.host.drawSky(pass, job, view, frameBG, sceneBG) },
      { name: 'scene:late', record: (pass) => { if (total > 0) this.host.drawGeometry(pass, view, 'late'); } },
    ];
  }

  private captureNode(job: ViewJob): MainPassNode {
    let layers = this.captureNodes.get(job.colorTexture);
    if (!layers) this.captureNodes.set(job.colorTexture, layers = new Map());
    let node = layers.get(job.colorLayer);
    if (!node) layers.set(job.colorLayer, node = new MainPassNode(this.gpu, `view-${job.colorLayer}`));
    return node;
  }

  /** A frame resource name for a view's colour or depth texture (a texture keeps its name for as long as it lives). */
  private textureName(texture: GPUTexture, kind: string): string {
    let id = this.textureIds.get(texture);
    if (id === undefined) this.textureIds.set(texture, id = ++this.textureCount);
    return `view-${kind}-${id}`;
  }

  /** Point a mirror view's camera at the main camera's reflection (oblique near plane = the mirror plane). */
  private setupMirrorCamera(v: RenderView, main: Camera): void {
    const m = v.mirror!;
    const mv = mirrorView(new Float32Array(16), main.view, m.point, m.normal);
    const plane = planeToView(mv, m.point, m.normal);
    const proj = obliqueProjection(new Float32Array(16), main.projection, plane);
    v.camera.setMatrices(mv, proj, main.near, main.far);
  }

  /** The draw state of a registered view (its winding is the mirror's). */
  private stateFor(v: RenderView): Scratch {
    const flip = v.mirror !== null;   // (a view can become or stop being a mirror: its winding follows)
    let s = this.viewStates.get(v);
    if (!s || s.view.flipWinding !== flip) {
      s = { view: new ViewState({ colorFormat: RENDER_TARGET_FORMAT, depthFormat: DEPTH_FORMAT, sampleCount: 1, flipWinding: flip }), slots: s?.slots ?? new Uint32Array(0) };
      this.viewStates.set(v, s);
    }
    return s;
  }

  /** The uniforms of a registered view. */
  private slotFor(v: RenderView): ViewSlot {
    let slot = this.viewSlots.get(v);
    if (!slot) { slot = { frame: new FrameUniform(this.gpu, this.layouts), scene: this.scene.createViewScene() }; this.viewSlots.set(v, slot); }
    return slot;
  }

  /** Draw state for off-screen renders with the given winding (a probe capture, which is drawn right away). */
  private scratchFor(flip: boolean): Scratch {
    let s = this.scratch.get(flip);
    if (!s) {
      s = { view: new ViewState({ colorFormat: RENDER_TARGET_FORMAT, depthFormat: DEPTH_FORMAT, sampleCount: 1, flipWinding: flip }), slots: new Uint32Array(0) };
      this.scratch.set(flip, s);
    }
    return s;
  }

  /** Cull for the job's camera, then drop excluded objects and objects whose material samples the job's target. */
  private visibleSlots(rw: RenderWorld, job: ViewJob, s: Scratch): { slots: Uint32Array | null; count: number } {
    const proxy = Object.create(rw, { camera: { value: job.camera } }) as RenderWorld;   // culling reads rw.camera only
    const vis = job.visibility.update(proxy);
    if (!job.excludeRef && !job.exclude) return vis;
    const n = vis.slots ? vis.count : rw.count;
    if (s.slots.length < n) s.slots = new Uint32Array(Math.max(n, s.slots.length * 2, 256));
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
      s.slots[c++] = slot;
    }
    return { slots: s.slots, count: c };
  }
}
