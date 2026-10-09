import { Camera } from './Camera';
import type { RenderTarget } from './RenderTarget';
import { VisibilitySystem, type CullMode } from '../visibility/VisibilitySystem';

/** A planar mirror: the view is rendered from the main camera reflected in the plane through `point` with `normal` (pointing to the visible side). */
export interface MirrorPlane {
  point: readonly [number, number, number];
  normal: readonly [number, number, number];
}

export interface RenderViewOptions {
  /** Where the view is drawn. Objects whose material samples this target are skipped automatically (no feedback loops). */
  target: RenderTarget;
  /** The camera to render from; a fresh {@link Camera} when omitted (configure `position` / `target` / `fovY` + `update()`, or `setMatrices`). Ignored for mirrors. */
  camera?: Camera;
  /** Render the main camera reflected in this plane every frame (see {@link createMirrorMaterial}); sets the camera, projection and winding. */
  mirror?: MirrorPlane;
  /** Background colour (sRGB, like `renderer.clearColor`; default: the renderer's). */
  clearColor?: { r: number; g: number; b: number; a: number };
  /** Draw the environment cube map as the background (default true). */
  skybox?: boolean;
  /** Render only every Nth frame (default 1): cheap minimaps, security cameras and slowly updating probes. */
  interval?: number;
  /** CPU culling of the view (default 'linear'). */
  cull?: CullMode;
  /** Return true to leave an entity (entity index) out of the view, e.g. the mirror's own mesh or the player. */
  exclude?: (entity: number) => boolean;
  enabled?: boolean;
}

/**
 * A registered off-screen render of the scene from another camera into a {@link RenderTarget}. Created with `engine.addView`.
 *
 * What a view renders: opaque, alpha-masked and blended meshes with direct lighting (every light, no clusters), image-based
 * lighting, the skybox, and the shadow maps of the main view. It does not render particles, ribbons, fog, post-processing or MSAA.
 */
export class RenderView {
  readonly target: RenderTarget;
  readonly camera: Camera;
  mirror: MirrorPlane | null;
  clearColor: { r: number; g: number; b: number; a: number } | null;
  skybox: boolean;
  interval: number;
  exclude: ((entity: number) => boolean) | null;
  enabled: boolean;
  readonly visibility = new VisibilitySystem();
  /** Frames since the view last rendered (managed by the renderer). */
  frameCounter = 0;
  /** Objects drawn by the last render of this view. */
  lastDrawn = 0;

  constructor(o: RenderViewOptions) {
    this.target = o.target;
    this.camera = o.camera ?? new Camera();
    this.mirror = o.mirror ?? null;
    this.clearColor = o.clearColor ?? null;
    this.skybox = o.skybox ?? true;
    this.interval = Math.max(1, Math.round(o.interval ?? 1));
    this.exclude = o.exclude ?? null;
    this.enabled = o.enabled ?? true;
    this.visibility.mode = o.cull ?? 'linear';
    this.frameCounter = this.interval;   // render on the first frame
  }
}
