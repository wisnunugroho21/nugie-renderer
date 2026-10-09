import { Application } from './Application';
import { Renderer, DEFAULT_SCENE, type SceneSettings } from '../rendering/Renderer';
import { RenderWorld } from '../rendering/RenderWorld';
import { RenderExtractor } from '../rendering/RenderExtractor';
import { World } from '../ecs/World';
import { entityIndex } from '../ecs/Entity';
import { TransformSystem } from '../ecs/systems/TransformSystem';
import { BoundsSystem } from '../ecs/systems/BoundsSystem';
import { AnimationSystem } from '../ecs/systems/AnimationSystem';
import { SkeletonSystem } from '../ecs/systems/SkeletonSystem';
import { ParticleEmitterSystem } from '../ecs/systems/ParticleEmitterSystem';
import { RibbonEmitterSystem } from '../ecs/systems/RibbonEmitterSystem';
import { VisibilitySystem } from '../visibility/VisibilitySystem';
import { TextureLoader } from '../assets/TextureLoader';
import { RenderFlags } from '../ecs/components/MeshRendererStore';
import { LightType } from '../ecs/components/LightStore';
import { BitSet } from '../core/BitSet';
import { Mat4 } from '../math/Mat4';
import { raycastWorld, rayFromNDC, type Ray, type RayHit, type RaycastOptions } from '../picking/Raycaster';
import type { PostSettingsInput } from '../rendering/post/PostProcessor';
import type { RenderTarget, RenderTargetDesc } from '../rendering/RenderTarget';
import type { RenderView, RenderViewOptions, MirrorPlane } from '../rendering/RenderView';
import { createMirrorMaterial, type MirrorMaterialOptions } from '../rendering/materials/MirrorMaterial';
import type { Environment } from '../rendering/lighting/IBL';
import type { GPUContext } from '../gpu/GPUContext';

/** Options for {@link Engine.create}. Every field is optional. */
export interface EngineOptions {
  /** Vertical field of view of the default camera, in radians (default 45 degrees). */
  fovY?: number;
  /** Near / far clip distances of the default camera (default 0.1 / 500). */
  near?: number;
  far?: number;
  /** Freeze the pipeline cache after this many frames so late pipeline creation is reported (0 = never). Default 30. */
  freezePipelinesAfterFrames?: number;
  /** Post-processing / anti-aliasing to enable from the start (same shape as `renderer.post.configure`), e.g. `{ msaa: 4 }` or `{ bloom: true, fxaa: true }`. */
  post?: PostSettingsInput & { enabled?: boolean };
}

/** Wall-clock cost (ms) of the CPU phases of the last frame, shown by the HUD. */
export interface EngineTimings {
  animationMs: number;
  transformMs: number;
}

/** Local-space bounds of an object, as [minX, minY, minZ, maxX, maxY, maxZ]. */
export type LocalBounds = readonly [number, number, number, number, number, number];

/** Parameters for {@link Engine.spawnObject}. */
export interface SpawnObjectOptions {
  /** Mesh id from `renderer.meshes.create`. */
  mesh: number;
  /** Material id from `renderer.materials.createPBR` / `createCustom`. */
  material: number;
  position?: readonly [number, number, number];
  /** Uniform scale (number) or per-axis scale. */
  scale?: number | readonly [number, number, number];
  /** Quaternion [x, y, z, w]. */
  rotation?: readonly [number, number, number, number];
  /** `RenderFlags` bit set (default: casts + receives shadows). */
  flags?: number;
  /** Local AABB used for culling (default: the mesh's own bounds). */
  bounds?: LocalBounds;
}

/** Parameters for {@link Engine.spawnLight}. */
export interface SpawnLightOptions {
  type: LightType;
  position?: readonly [number, number, number];
  /** Quaternion [x, y, z, w]; a light shines along its local -Z. */
  rotation?: readonly [number, number, number, number];
  color?: readonly [number, number, number];
  intensity?: number;
  /** Reach of point / spot lights in world units (default 10; 0 = unlimited, which is shaded for every pixel). Ignored for other types. */
  range?: number;
  /** Spot lights: full-intensity and cut-off cone half-angles in radians (defaults 0 and 45 degrees). */
  innerCone?: number;
  outerCone?: number;
  /** Request a shadow map (sun: cascades, spot: one map, point: cube map; the renderer's shadow budgets apply). */
  castShadow?: boolean;
}

/** Anything with a per-frame `update`; register it with {@link Engine.addSystem}. */
export interface EngineSystem {
  /** @param dt seconds since the previous frame; @param time absolute seconds */
  update(dt: number, time: number): void;
}

/**
 * Where a custom system runs inside {@link Engine.frame}:
 *  - `beforeAnimation`: first thing in the frame (gameplay-style logic that writes transforms; they are recomputed this frame)
 *  - `afterTransforms`: after world matrices and bounds are up to date, before render data is extracted (read final positions here)
 */
export type SystemPhase = 'beforeAnimation' | 'afterTransforms';

/**
 * The one object a game needs: it owns the GPU context, the frame loop, the ECS {@link World}, every per-frame system
 * and the {@link Renderer}, and runs them in the correct order each frame.
 *
 * ```ts
 * const engine = await Engine.create(canvas);
 * // ...create meshes / materials / entities through engine.renderer and engine.world...
 * engine.start((time, dt) => { // your gameplay: write to engine.world });
 * ```
 *
 * Frame order (see {@link Engine.frame}): custom `beforeAnimation` systems -> animation -> transforms -> skeletons -> bounds ->
 * particle/ribbon emitters -> custom `afterTransforms` systems -> extraction -> culling + LOD -> render. All fields are public so advanced users can reach any subsystem.
 */
export class Engine {
  readonly app: Application;
  readonly gpu: GPUContext;
  readonly renderer: Renderer;
  readonly world = new World();

  readonly transformSystem: TransformSystem;
  readonly boundsSystem: BoundsSystem;
  readonly animation: AnimationSystem;
  readonly skeletons: SkeletonSystem;
  readonly particleEmitters: ParticleEmitterSystem;
  readonly ribbonEmitters: RibbonEmitterSystem;

  /** Flat arrays produced by {@link RenderExtractor}; the renderer reads only this. */
  readonly renderWorld = new RenderWorld();
  readonly extractor: RenderExtractor;
  /** CPU visibility strategy (`mode = 'bvh' | 'linear' | 'none'`). */
  readonly visibility = new VisibilitySystem();
  /** Shared texture loader (decoding, mipmaps, de-duplication). */
  readonly textures: TextureLoader;
  /** Legacy sun/ambient fallback used only when the world contains no lights. */
  scene: SceneSettings = DEFAULT_SCENE;
  /** Index of the camera entity (the first camera entity is the active one). */
  readonly camera: number;
  readonly timings: EngineTimings = { animationMs: 0, transformMs: 0 };
  /** Called at the end of every frame (the demo HUD hooks in here). */
  onFrameEnd: ((dt: number, time: number) => void) | null = null;

  /**
   * Give every mesh renderer that has no bounds component the bounds of its mesh. Without bounds an object can never be culled and
   * (if static) cannot live in the BVH, so this is on by default. Skinned / morphed meshes are skipped: their bind-pose bounds are
   * not valid once they deform (glTF instantiation adds padded bounds for them; add your own for hand-made ones).
   */
  autoBounds = true;
  private boundsScanVersion = -1;
  private readonly freezeAfter: number;
  private readonly systems: Record<SystemPhase, EngineSystem[]> = { beforeAnimation: [], afterTransforms: [] };

  private constructor(app: Application, options: EngineOptions) {
    this.app = app;
    this.gpu = app.gpu;
    this.freezeAfter = options.freezePipelinesAfterFrames ?? 30;
    this.renderer = new Renderer(this.gpu);
    if (options.post) this.renderer.post.configure(options.post);
    app.onResize = (w, h) => this.renderer.resize(w, h);

    this.transformSystem = new TransformSystem(this.world.transforms);
    this.boundsSystem = new BoundsSystem(this.world.transforms, this.world.bounds);
    this.animation = new AnimationSystem(this.world);
    this.skeletons = new SkeletonSystem(this.world, this.renderer.joints);
    this.particleEmitters = new ParticleEmitterSystem(this.world);
    this.ribbonEmitters = new RibbonEmitterSystem(this.world);
    this.extractor = new RenderExtractor(this.world, this.transformSystem);
    this.textures = new TextureLoader(this.gpu);

    this.camera = entityIndex(this.world.create());
    this.world.transforms.add(this.camera);
    this.world.cameras.add(this.camera, options.fovY ?? Math.PI / 4, options.near ?? 0.1, options.far ?? 500);
  }

  /** Acquire the WebGPU device for `canvas` and build a ready-to-use engine. Rejects if WebGPU is unavailable. */
  static async create(canvas: HTMLCanvasElement, options: EngineOptions = {}): Promise<Engine> {
    const app = new Application(canvas);
    await app.init();
    return new Engine(app, options);
  }

  /** The canvas this engine renders into. */
  get canvas(): HTMLCanvasElement { return this.app.canvas; }

  /**
   * Create an entity with a transform, a mesh renderer and local bounds in one call.
   * @returns the entity INDEX (what every component-store method takes). Use `world.entities`/`world.destroy` with a full handle if you need to delete it.
   */
  spawnObject(o: SpawnObjectOptions): number {
    const w = this.world;
    const e = entityIndex(w.create());
    const p = o.position ?? [0, 0, 0];
    w.transforms.add(e, p[0], p[1], p[2]);
    if (o.scale !== undefined) {
      const s = typeof o.scale === 'number' ? [o.scale, o.scale, o.scale] as const : o.scale;
      w.transforms.setScale(e, s[0], s[1], s[2]);
    }
    if (o.rotation) w.transforms.setRotation(e, o.rotation[0], o.rotation[1], o.rotation[2], o.rotation[3]);
    w.meshRenderers.add(e, o.mesh, o.material, o.flags ?? (RenderFlags.CastShadow | RenderFlags.ReceiveShadow));
    const b = o.bounds ?? this.renderer.meshes.get(o.mesh).bounds;
    w.bounds.add(e, b[0], b[1], b[2], b[3], b[4], b[5]);
    return e;
  }

  /** Create a light entity (directional / point / spot / ambient). Returns its entity index. */
  spawnLight(o: SpawnLightOptions): number {
    const w = this.world;
    const e = entityIndex(w.create());
    const p = o.position ?? [0, 0, 0];
    w.transforms.add(e, p[0], p[1], p[2]);
    if (o.rotation) w.transforms.setRotation(e, o.rotation[0], o.rotation[1], o.rotation[2], o.rotation[3]);
    const c = o.color ?? [1, 1, 1];
    const ranged = o.type === LightType.Point || o.type === LightType.Spot;
    w.lights.add(e, o.type, c[0], c[1], c[2], o.intensity ?? 1, o.range ?? (ranged ? 10 : 0));
    if (o.innerCone !== undefined) w.lights.innerCone[e] = o.innerCone;
    if (o.outerCone !== undefined) w.lights.outerCone[e] = o.outerCone;
    if (o.castShadow) w.lights.castShadow[e] = 1;
    return e;
  }

  /** Add mesh-derived bounds to renderers without any (see `autoBounds`) and compute their world bounds immediately. */
  private addMissingBounds(): void {
    const w = this.world, mr = w.meshRenderers;
    if (mr.version === this.boundsScanVersion) return;
    this.boundsScanVersion = mr.version;
    const added: number[] = [];
    BitSet.forEachAnd([mr.has, w.transforms.has], (i) => {
      if (w.bounds.has.has(i)) return;
      const rec = this.renderer.meshes.get(mr.meshId[i]);
      if (!rec || rec.deformMask !== 0) return;
      const b = rec.bounds;
      w.bounds.add(i, b[0], b[1], b[2], b[3], b[4], b[5]);
      added.push(i);
    });
    if (added.length) this.boundsSystem.update(added);
  }

  /**
   * World-space ray through a point of the canvas, using the camera of the last rendered frame.
   * @param clientX / clientY pointer position in CSS pixels (e.g. `PointerEvent.clientX / clientY`)
   */
  screenRay(clientX: number, clientY: number): Ray {
    const r = this.canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((clientY - r.top) / r.height) * 2;
    const inv = Mat4.invert(Mat4.create(), this.renderWorld.camera.viewProjection);
    if (!inv) throw new Error('screenRay: the camera matrix is singular (has a frame been rendered yet?)');
    return rayFromNDC(inv, nx, ny);
  }

  /** Nearest entity hit by `ray`, or null. Uses the bounds and transforms of the last frame; see {@link raycastWorld}. */
  raycast(ray: Ray, opts?: RaycastOptions): RayHit | null {
    return raycastWorld(this.world, this.renderer.meshes, ray, opts, true)[0] ?? null;
  }

  /** Every entity hit by `ray`, nearest first. */
  raycastAll(ray: Ray, opts?: RaycastOptions): RayHit[] {
    return raycastWorld(this.world, this.renderer.meshes, ray, opts);
  }

  /** Object under a canvas point (`screenRay` + `raycast`): `engine.pick(e.clientX, e.clientY)?.entity`. */
  pick(clientX: number, clientY: number, opts?: RaycastOptions): RayHit | null {
    return this.raycast(this.screenRay(clientX, clientY), opts);
  }

  // ---- render-to-texture ----------------------------------------------------------------------------------------------------

  /** Create an off-screen colour + depth buffer (linear HDR). Use `target.ref` as a material texture; see {@link addView}. */
  createRenderTarget(desc?: RenderTargetDesc): RenderTarget { return this.renderer.createRenderTarget(desc); }

  /**
   * Render the scene from another camera into a render target every frame (minimaps, security cameras, portals, mirrors).
   * `engine.addView({ target, camera })`, then point `view.camera` somewhere each frame (`camera.position`, `camera.target`, `camera.update()`)
   * and show `target.ref` on a material. Views run before the main view, in the order they were added.
   */
  addView(o: RenderViewOptions): RenderView { return this.renderer.addView(o); }

  /** Stop rendering a view. */
  removeView(v: RenderView): void { this.renderer.removeView(v); }

  /**
   * A planar mirror in one call: a canvas-sized render target, a view of the main camera reflected in `plane` (kept in sync every
   * frame) and the material that shows it. Give the returned `material` to a quad lying in the plane. Mirrors do not show other mirrors
   * or particles / fog (see {@link RenderView}).
   */
  createMirror(plane: MirrorPlane, o: MirrorMaterialOptions & { scale?: number; exclude?: (entity: number) => boolean } = {}): { target: RenderTarget; view: RenderView; material: number } {
    const target = this.renderer.createRenderTarget({ scale: o.scale ?? 1, label: o.name ?? 'mirror' });
    const view = this.renderer.addView({ target, mirror: plane, exclude: o.exclude });
    const material = createMirrorMaterial(this.renderer.materials, target.ref, o);
    return { target, view, material };
  }

  /**
   * Reflection probe: render the scene from `position` into a cube map and bake it for image-based lighting. Pass the result to
   * `renderer.setEnvironment(env)` (whole-scene IBL and skybox). Needs at least one rendered frame; re-capture whenever the surroundings change.
   */
  captureEnvironment(position: readonly [number, number, number], o?: { size?: number; near?: number; far?: number; skybox?: boolean; exclude?: (entity: number) => boolean }): Environment {
    return this.renderer.captureEnvironment(this.renderWorld, position, o);
  }

  /** Register a custom per-frame system (e.g. physics sync, AI, a new feature) to run at the given phase of every frame. */
  addSystem(system: EngineSystem, phase: SystemPhase = 'beforeAnimation'): void { this.systems[phase].push(system); }

  /** Unregister a system added with {@link addSystem}. */
  removeSystem(system: EngineSystem): void {
    for (const list of Object.values(this.systems)) { const i = list.indexOf(system); if (i >= 0) list.splice(i, 1); }
  }

  /**
   * Run one full frame: advance all systems in dependency order, extract the render data, cull, apply LOD and draw.
   * {@link Engine.start} calls this for you; call it directly to step the simulation manually (tests, deterministic captures).
   * @param dt seconds since the previous frame
   * @param time absolute time in seconds (drives shader time and particles)
   */
  frame(dt: number, time: number): void {
    const { renderer, world, renderWorld: rw } = this;
    for (const sys of this.systems.beforeAnimation) sys.update(dt, time);
    const a0 = performance.now();
    this.animation.update(dt);                           // clips -> local TRS / morph weights
    const a1 = performance.now();
    this.transformSystem.update();                       // dirty transform hierarchy -> world matrices
    this.skeletons.update(this.transformSystem.updated); // joint matrices (only moved skeletons)
    this.boundsSystem.update(this.transformSystem.updated);
    this.particleEmitters.update();                      // emitter entity transforms -> particle pools
    renderer.particles?.update(Math.min(dt, 0.1), time);
    this.ribbonEmitters.update();                        // trail heads follow their entities
    for (const rs of renderer.ribbonSystems) rs.update(time);
    if (this.autoBounds) this.addMissingBounds();
    for (const sys of this.systems.afterTransforms) sys.update(dt, time);

    const e0 = performance.now();
    this.extractor.extract(rw, this.canvas.width / this.canvas.height);
    renderer.stats.cpu.extraction = performance.now() - e0;
    const an = renderer.stats.animation;
    an.activeAnimators = this.animation.activeAnimators; an.activeSkeletons = world.skins.aliveInstances;
    an.updatedSkeletons = this.skeletons.updatedSkeletons; an.updatedJoints = this.skeletons.updatedJoints;
    this.timings.animationMs = a1 - a0;
    this.timings.transformMs = e0 - a1;

    const visible = renderer.applyLOD(rw, this.visibility.update(rw));   // CPU culling, then CPU LOD
    renderer.render(rw, this.scene, time, visible);
    if (!this.gpu.resources.pipelines.isFrozen && this.freezeAfter > 0 && this.app.frame > this.freezeAfter) this.gpu.resources.pipelines.freeze();
  }

  /**
   * Start the render loop. `update` runs first each frame (put gameplay and camera control here), then the engine systems and the draw.
   * @param update optional per-frame gameplay callback `(time, dt)`
   */
  start(update?: (time: number, dt: number) => void): void {
    this.app.onFrame = (dt) => {
      const time = performance.now() / 1000;
      update?.(time, dt);
      this.frame(dt, time);
      this.onFrameEnd?.(dt, time);
    };
    this.app.start();
  }

  /** Stop the render loop (the GPU resources stay alive). */
  stop(): void { this.app.stop(); }
}
