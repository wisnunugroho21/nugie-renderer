import type { Camera } from './Camera';
import type { RenderGraph } from './RenderGraph';
import type { PassTarget } from './materials/MaterialManager';
import type { ParticleSystem } from '../particles/ParticleSystem';
import type { RibbonSystem } from '../particles/RibbonSystem';
import type { Overlay } from './overlay/Overlay';

/** What the renderer tells a feature about the frame being built. One object, updated in place every frame: do not keep it. */
export interface FeatureFrame {
  /** The main view's camera (valid when `hasCamera`). */
  camera: Camera;
  /** The scene has a camera this frame; without one nothing is drawn. */
  hasCamera: boolean;
  /** Seconds, as passed to `Renderer.render`. */
  time: number;
  /** Bind group 0 (the per-view frame uniform): set it before drawing with an engine pipeline layout. */
  frameBindGroup: GPUBindGroup;
  /** Bind group 1 (lights, shadows, environment): set it if the feature's shaders include `scene_eval`. */
  sceneBindGroup: GPUBindGroup;
  /** Colour / depth formats and sample count of the main pass, for building render pipelines. Changes with MSAA / HDR (see `retarget`). */
  target: PassTarget;
}

/** `FeatureFrame` plus the HDR scene colour, for features that post-process it (see `RenderFeature.addPostPasses`). */
export interface PostFeatureFrame extends FeatureFrame {
  /** The linear HDR scene colour (rgba16float, single-sample, after MSAA resolve). Usable as a texture and as a copy destination / source. */
  sceneTexture: GPUTexture;
  width: number;
  height: number;
}

/**
 * A self-contained piece of rendering that plugs into the renderer without editing it: GPU particles, ribbons and the line / point / sprite
 * overlays are all features. Every hook is optional. Register with `renderer.addFeature(feature)`.
 *
 * Frame order of the hooks: `prepare` (CPU -> GPU uploads) -> `addPasses` (compute or render passes, ordered by the render graph from their
 * declared reads / writes) -> `drawMain` (inside the main pass, after the scene geometry and sky) -> `endFrame`.
 */
export interface RenderFeature {
  /** For diagnostics and `removeFeature`. */
  readonly name: string;
  /** Position among the features inside the main pass: lower draws first (default 100). Built-ins: particles 100, ribbons 200, overlays 300. */
  drawOrder?: number;
  /**
   * Graph resource names this feature's passes write and the main pass must wait for (e.g. `['myBuffer']`). The main pass declares them as
   * reads, so a compute pass in `addPasses` that writes one of them always runs before the scene is drawn.
   */
  produces?: readonly string[];
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
  /** Record draw calls into the main pass. Skipped when the scene has no camera. */
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

  /** Add a feature (ignored when it is already registered). Features are kept sorted by `drawOrder`; equal orders keep registration order. */
  add<T extends RenderFeature>(f: T): T {
    if (this.list.includes(f)) return f;
    const order = f.drawOrder ?? 100;
    let i = this.list.length;
    while (i > 0 && (this.list[i - 1].drawOrder ?? 100) > order) i--;
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

  /** Registered features in draw order. */
  get all(): readonly RenderFeature[] { return this.list; }

  /** Union of the features' `produces` (what the main pass has to wait for). */
  get producedResources(): readonly string[] {
    return this.produced ??= [...new Set(this.list.flatMap((f) => f.produces ?? []))];
  }

  prepare(frame: FeatureFrame): void { for (const f of this.list) f.prepare?.(frame); }
  addPasses(graph: RenderGraph, frame: FeatureFrame): void { for (const f of this.list) f.addPasses?.(graph, frame); }
  addPostPasses(graph: RenderGraph, frame: PostFeatureFrame): void { for (const f of this.list) f.addPostPasses?.(graph, frame); }
  drawMain(pass: GPURenderPassEncoder, frame: FeatureFrame): void { if (frame.hasCamera) for (const f of this.list) f.drawMain?.(pass, frame); }
  retarget(): void { for (const f of this.list) f.retarget?.(); }
  endFrame(): void { for (const f of this.list) f.endFrame?.(); }
}

/** The GPU particle system as a feature: simulate / compact in a compute pass, one indirect draw per pool in the main pass. */
export function particleFeature(ps: ParticleSystem): RenderFeature {
  return {
    name: 'particles', drawOrder: 100, produces: ['particles'],
    addPasses: (g) => g.addPass({ name: 'particles-sim', writes: ['particles'], execute: (e) => ps.encodeCompute(e) }),   // emit / simulate / compact before any draw reads them
    drawMain: (pass, f) => { if (ps.pools.length) ps.encodeDraw(pass, f.frameBindGroup); },
    retarget: () => ps.retarget(),
  };
}

/** A ribbon system as a feature: update its vertices in a compute pass, one draw call in the main pass. */
export function ribbonFeature(rs: RibbonSystem, index: number): RenderFeature {
  return {
    name: `ribbons:${index}`, drawOrder: 200, produces: ['ribbons'],
    addPasses: (g) => g.addPass({ name: `ribbons-update:${index}`, writes: ['ribbons'], execute: (e) => rs.encodeCompute(e) }),
    drawMain: (pass, f) => rs.encodeDraw(pass, f.frameBindGroup),
    retarget: () => rs.retarget(),
  };
}

/** A line / point / sprite / text system as a feature: upload before the passes, draw on top of the scene, optionally clear after the frame. */
export function overlayFeature(o: Overlay): RenderFeature {
  return {
    name: 'overlay', drawOrder: 300,
    prepare: () => o.flush(),
    drawMain: (pass, f) => o.encodeDraw(pass, f.frameBindGroup),
    retarget: () => o.retarget(),
    endFrame: () => { if (o.autoClear) o.clear(); },
  };
}
