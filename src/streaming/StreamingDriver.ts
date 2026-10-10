import type { MaterialManager } from '../rendering/materials/MaterialManager';
import type { RenderWorld } from '../rendering/RenderWorld';
import type { VisibleSet } from '../visibility/VisibilitySystem';
import type { TextureStreamer, StreamedTexture } from './TextureStreamer';
import { FeatureOrder, type FeatureFrame, type RenderFeature } from '../rendering/RenderFeature';

/**
 * Connects a {@link TextureStreamer} to the renderer: reports each material's on-screen coverage every frame (so mip residency follows what
 * is visible and how large), and rebuilds a material's bind group whenever one of its streamed textures changes its resident mips.
 */
export class StreamingDriver implements RenderFeature {
  readonly name = 'texture-streaming';
  order = FeatureOrder.streaming;
  /** The attached streamer, or null. */
  streamer: TextureStreamer | null = null;
  private coverage = new Map<number, number>();
  private readonly viewChanged = (t: StreamedTexture): void => this.materials.textureChanged(t);

  constructor(private materials: MaterialManager) {}

  /** Attach (or detach with null) a streamer. */
  attach(s: TextureStreamer | null): void {
    if (this.streamer?.onViewChanged === this.viewChanged) this.streamer.onViewChanged = null;
    this.streamer = s;
    if (s) s.onViewChanged = this.viewChanged;
  }

  /** Report the frame's coverage before any bind group of the frame is used. */
  beginFrame(f: FeatureFrame): void {
    if (this.streamer && f.hasCamera) this.update(f.rw, f.visible, f.visibleCount, f.height);
  }

  /** Report per-material screen coverage to the streamer, then apply its plan (before the frame's bind groups are used). */
  update(rw: RenderWorld, visible: VisibleSet | null, visibleCount: number, canvasHeight: number): void {
    const s = this.streamer;
    if (!s) return;
    s.beginFrame();
    const cam = rw.camera, tanHalf = Math.tan(cam.fovY / 2), sph = rw.boundsSphere;
    const px = this.coverage;
    px.clear();
    for (let n = 0; n < visibleCount; n++) {
      const slot = visible?.slots ? visible.slots[n] : n;
      const dx = sph[slot * 4] - cam.position[0], dy = sph[slot * 4 + 1] - cam.position[1], dz = sph[slot * 4 + 2] - cam.position[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz), r = sph[slot * 4 + 3];
      const pixels = d <= r ? canvasHeight : (r / (d * tanHalf)) * canvasHeight;
      const m = rw.materialId[slot];
      if (pixels > (px.get(m) ?? 0)) px.set(m, pixels);
    }
    const streamed = new Set(s.textures);
    // Material textures and streamer membership can change after the first visible frame.
    for (const [m, pixels] of px) for (const t of this.materials.get(m).textures) {
      if (t && streamed.has(t as StreamedTexture)) s.touch(t as StreamedTexture, pixels);
    }
    s.update();
  }
}
