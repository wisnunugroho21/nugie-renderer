import type { GPUContext } from '../gpu/GPUContext';
import type { FrameUniform } from './FrameUniform';
import type { MaterialManager } from './materials/MaterialManager';
import type { TextureRef } from './materials/Material';
import type { SceneResources } from './lighting/SceneResources';
import type { Environment, IBLBaker } from './lighting/IBL';
import type { RenderWorld } from './RenderWorld';
import { Camera } from './Camera';
import { RenderTarget, RENDER_TARGET_FORMAT, type RenderTargetDesc } from './RenderTarget';
import { RenderView, type RenderViewOptions } from './RenderView';
import { ViewState } from './RenderDrawState';
import { DEPTH_FORMAT } from './formats';
import { mirrorView, planeToView, obliqueProjection, cubeFaceView, cubeFaceProjection } from './viewMath';
import { VisibilitySystem } from '../visibility/VisibilitySystem';

/** Everything an off-screen render needs besides the scene: a camera and the colour / depth views to draw into. */
export interface ViewJob {
  camera: Camera;
  colorView: GPUTextureView;
  depthView: GPUTextureView;
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
}

/** What `OffscreenViews` needs from the renderer. */
export interface ViewHost {
  /** Draw `objects` (already culled and filtered) once for `job` with `view`'s draw state: one command buffer, one submit. */
  renderJob(job: ViewJob, view: ViewState, objects: { slots: Uint32Array | null; count: number }, rw: RenderWorld): void;
  readonly clearColor: { r: number; g: number; b: number; a: number };
  readonly ibl: IBLBaker;
}

/** Draw state of off-screen renders with one winding, plus the scratch list of objects they draw. */
interface Scratch { view: ViewState; slots: Uint32Array; }

/**
 * Off-screen rendering of the scene from other cameras: render targets, views (mirrors, minimaps, security cameras) and reflection-probe
 * capture. This class owns the bookkeeping - which views are due, mirror cameras, which objects each view skips - and hands every
 * actual render to the {@link ViewHost}.
 */
export class OffscreenViews {
  /** Registered views, rendered before the main view in registration order. */
  readonly views: RenderView[] = [];
  private targets: RenderTarget[] = [];
  private scratch = new Map<boolean, Scratch>();
  private probeVisibility = new VisibilitySystem();

  constructor(
    private gpu: GPUContext, private materials: MaterialManager, private frame: FrameUniform, private scene: SceneResources, private host: ViewHost,
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
  }

  /** Render every due view into its target. Called after the main view's data is uploaded and its batches are built. */
  renderDue(rw: RenderWorld): void {
    for (const t of this.targets) if (t.scale) t.resize(this.gpu.canvas.width * t.scale, this.gpu.canvas.height * t.scale);
    const due: RenderView[] = [];
    for (const v of this.views) {
      if (!v.enabled) continue;
      if (++v.frameCounter >= v.interval) { v.frameCounter = 0; due.push(v); }
    }
    if (due.length === 0) return;
    const mainFrame = this.frame.snapshot();
    for (const v of due) {
      if (v.mirror) {
        if (!rw.hasCamera) continue;
        this.setupMirrorCamera(v, rw.camera);
      }
      const s = this.scratchFor(v.mirror !== null);
      this.render({
        camera: v.camera, colorView: v.target.view, depthView: v.target.depthView, width: v.target.width, height: v.target.height,
        clearColor: v.clearColor ?? this.host.clearColor, skybox: v.skybox, visibility: v.visibility,
        excludeRef: v.target.ref, exclude: v.exclude,
      }, s, rw);
      v.lastDrawn = s.view.draw.frame.total;
    }
    this.restoreMainView(mainFrame);
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
    const depthView = depth.createView();
    this.gpu.resources.pipelines.unfreeze();
    this.probeVisibility.mode = 'linear';
    const cam = new Camera(), s = this.scratchFor(true);
    const view = new Float32Array(16), proj = cubeFaceProjection(new Float32Array(16), near, far);
    const mainFrame = this.frame.snapshot();
    for (let face = 0; face < 6; face++) {
      cubeFaceView(view, face, position[0], position[1], position[2]);
      cam.setMatrices(view, proj, near, far);
      this.render({
        camera: cam, colorView: source.createView({ dimension: '2d', baseArrayLayer: face, arrayLayerCount: 1, baseMipLevel: 0, mipLevelCount: 1 }),
        depthView, width: size, height: size, clearColor: this.host.clearColor, skybox: o.skybox ?? true,
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

  /** Cull for the job's camera, drop what it must not show, then let the host draw it. */
  private render(job: ViewJob, s: Scratch, rw: RenderWorld): void {
    this.host.renderJob(job, s.view, this.visibleSlots(rw, job, s), rw);
  }

  /** Point a mirror view's camera at the main camera's reflection (oblique near plane = the mirror plane). */
  private setupMirrorCamera(v: RenderView, main: Camera): void {
    const m = v.mirror!;
    const mv = mirrorView(new Float32Array(16), main.view, m.point, m.normal);
    const plane = planeToView(mv, m.point, m.normal);
    const proj = obliqueProjection(new Float32Array(16), main.projection, plane);
    v.camera.setMatrices(mv, proj, main.near, main.far);
  }

  /** Draw state for off-screen renders with the given winding. */
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
