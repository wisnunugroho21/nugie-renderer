import type { Camera } from './Camera';
import type { RenderGraph } from './RenderGraph';
import type { RenderWorld } from './RenderWorld';
import type { PassTarget } from './materials/MaterialManager';
import type { LightData } from './lighting/LightData';
import type { VisibleSet } from '../visibility/VisibilitySystem';
import type { DynamicBufferAllocator } from '../gpu/DynamicBufferAllocator';
import type { GPUProfiler } from '../profiling/GPUProfiler';

/**
 * Where the built-in features sit among each other (lower runs first in every hook). Your own features default to `FeatureOrder.default`,
 * which puts them after the scene-lighting features (shadows, clusters, fog) and before particles, ribbons and overlays.
 */
export const FeatureOrder = {
  streaming: 0, shadows: 10, clusters: 20, fog: 30,
  default: 100, particles: 100, ribbons: 200, overlays: 300,
  postChain: 1000,
} as const;

/** What the renderer tells a feature about the frame being built. One object, updated in place every frame: do not keep it. */
export interface FeatureFrame {
  /** The extracted scene for this frame. */
  rw: RenderWorld;
  /** The main view's camera (`rw.camera`; valid when `hasCamera`). */
  camera: Camera;
  /** The scene has a camera this frame; without one nothing is drawn. */
  hasCamera: boolean;
  /** Seconds, as passed to `Renderer.render`. */
  time: number;
  /** Canvas size in pixels. */
  width: number;
  height: number;
  /** The light set used this frame (the scene's lights, or the legacy sun + ambient). `beginFrame` hooks may adjust it (shadows assign their slots). */
  lights: LightData;
  /** CPU visibility result for the main view (`null` = everything), and how many objects it lists. */
  visible: VisibleSet | null;
  visibleCount: number;
  /** Bind group 0 (the per-view frame uniform): set it before drawing with an engine pipeline layout. */
  frameBindGroup: GPUBindGroup;
  /** Bind group 1 (lights, shadows, environment): set it if the feature's shaders include `scene_eval`. */
  sceneBindGroup: GPUBindGroup;
  /** Bind group 3 (transforms, instance records, joints, morph data), valid once the frame's instances are built. */
  objectBindGroup(): GPUBindGroup;
  /** Colour / depth formats and sample count of the main pass, for building render pipelines. Changes with MSAA / HDR (see `retarget`). */
  target: PassTarget;
  /** GPU timestamp queries: `profiler.writes('name')` for a pass's `timestampWrites`. */
  profiler: GPUProfiler;
  /** The per-frame instance-record ring buffer (see `buildInstances`). */
  instances: DynamicBufferAllocator;
}

/** `FeatureFrame` plus what a post-processing feature needs (see `RenderFeature.addPostPasses`). */
export interface PostFeatureFrame extends FeatureFrame {
  /** The linear HDR scene colour (rgba16float, single-sample, after MSAA resolve). Usable as a texture and as a copy destination / source. */
  sceneTexture: GPUTexture;
  /** The camera's projection matrix (column-major). */
  projection: ArrayLike<number>;
  /** Depth-only view of the main depth buffer, for sampling (multisampled when `depthSamples` > 1). */
  depthView: GPUTextureView;
  depthSamples: number;
}

/**
 * A self-contained piece of rendering that plugs into the renderer without editing it. Shadows, light clusters, volumetric fog, the sky, texture
 * streaming, GPU particles, ribbons, the line / point / sprite overlays and the built-in post-processing chain are all features; so is whatever you
 * add with `renderer.addFeature(feature)`. Every hook is optional.
 *
 * Order of the hooks within a frame:
 *  1. `beginFrame`      CPU state the scene uniform will carry (assign shadow slots, size grids, report texture coverage ...)
 *  2. `buildInstances`  extra instance records, before the instance buffer is uploaded
 *  3. `prepare`         uploads that need the frame's batches
 *  4. `addPasses`       compute / render passes, ordered by the render graph from their declared reads and writes
 *  5. `addPostPasses`   post-processing on the HDR scene colour (only while the post chain is on)
 *  6. `drawBackdrop`    inside the main pass, after the opaque geometry and before blended surfaces (the sky)
 *  7. `drawMain`        inside the main pass, after the scene (particles, ribbons, overlays)
 *  8. `endFrame`        after the frame was submitted
 * `retarget` is called whenever the main pass's format or sample count changes. Within each hook, features run in `order`.
 */
export interface RenderFeature {
  /** For diagnostics and `removeFeature`. */
  readonly name: string;
  /** Position among the features in every hook: lower runs first (default `FeatureOrder.default`). */
  order?: number;
  /**
   * Graph resource names this feature's passes write and the scene passes must wait for (e.g. `['shadowMap']`). The main pass declares them as
   * reads, so a pass in `addPasses` that writes one of them always runs before the scene is drawn.
   */
  produces?: readonly string[];
  /** Update CPU state that the scene uniform / lights depend on. Runs before the lights are uploaded; may modify `frame.lights`. */
  beginFrame?(frame: FeatureFrame): void;
  /** Write extra instance records with `frame.instances` (main view only). Runs before the instance buffer is flushed to the GPU. */
  buildInstances?(frame: FeatureFrame): void;
  /** Upload CPU-side changes. Called once per frame, before the passes are recorded. */
  prepare?(frame: FeatureFrame): void;
  /** Declare this frame's passes in the graph (`graph.addPass({ name, reads, writes, execute })`). */
  addPasses?(graph: RenderGraph, frame: FeatureFrame): void;
  /**
   * Post-process the scene colour (only while the HDR post chain is on: `renderer.post.configure({})`). Called after the scene is drawn and
   * before the built-in SSAO / SSR / bloom / tone mapping, so the effect works on linear HDR values. A pass that changes the colour declares
   * `reads: ['sceneColor'], writes: ['sceneColor']`; {@link FullscreenEffect} does the rest for a per-pixel effect.
   */
  addPostPasses?(graph: RenderGraph, frame: PostFeatureFrame): void;
  /** Draw behind blended surfaces: after the opaque geometry, before the blended batches. Skipped when the scene has no camera. */
  drawBackdrop?(pass: GPURenderPassEncoder, frame: FeatureFrame): void;
  /** Record draw calls into the main pass, after the scene. Skipped when the scene has no camera. */
  drawMain?(pass: GPURenderPassEncoder, frame: FeatureFrame): void;
  /** The main pass's colour format or sample count changed (HDR, MSAA): re-create pipelines that target it. */
  retarget?(): void;
  /** After the frame was submitted (clear immediate-mode data here). */
  endFrame?(): void;
}

/** The renderer's ordered list of features, with the loops over the hooks. */
export class FeatureRegistry {
  private list: RenderFeature[] = [];
  private produced: string[] | null = null;

  /** Add a feature (ignored when it is already registered). Features are kept sorted by `order`; equal orders keep registration order. */
  add<T extends RenderFeature>(f: T): T {
    if (this.list.includes(f)) return f;
    const order = f.order ?? FeatureOrder.default;
    let i = this.list.length;
    while (i > 0 && (this.list[i - 1].order ?? FeatureOrder.default) > order) i--;
    this.list.splice(i, 0, f);
    this.produced = null;
    return f;
  }

  /** Remove a feature; returns whether it was registered. */
  remove(f: RenderFeature): boolean {
    const i = this.list.indexOf(f);
    if (i < 0) return false;
    this.list.splice(i, 1);
    this.produced = null;
    return true;
  }

  /** Registered features in `order`. */
  get all(): readonly RenderFeature[] { return this.list; }

  /** Union of the features' `produces` (what the scene passes have to wait for). */
  get producedResources(): readonly string[] {
    return this.produced ??= [...new Set(this.list.flatMap((f) => f.produces ?? []))];
  }

  beginFrame(frame: FeatureFrame): void { for (const f of this.list) f.beginFrame?.(frame); }
  buildInstances(frame: FeatureFrame): void { for (const f of this.list) f.buildInstances?.(frame); }
  prepare(frame: FeatureFrame): void { for (const f of this.list) f.prepare?.(frame); }
  addPasses(graph: RenderGraph, frame: FeatureFrame): void { for (const f of this.list) f.addPasses?.(graph, frame); }
  addPostPasses(graph: RenderGraph, frame: PostFeatureFrame): void { for (const f of this.list) f.addPostPasses?.(graph, frame); }
  drawBackdrop(pass: GPURenderPassEncoder, frame: FeatureFrame): void { if (frame.hasCamera) for (const f of this.list) f.drawBackdrop?.(pass, frame); }
  drawMain(pass: GPURenderPassEncoder, frame: FeatureFrame): void { if (frame.hasCamera) for (const f of this.list) f.drawMain?.(pass, frame); }
  retarget(): void { for (const f of this.list) f.retarget?.(); }
  endFrame(): void { for (const f of this.list) f.endFrame?.(); }
}
