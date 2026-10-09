import type { MaterialManager } from '../rendering/materials/MaterialManager';
import type { RenderWorld } from '../rendering/RenderWorld';
import type { VisibleSet } from '../visibility/VisibilitySystem';
import type { TextureStreamer, StreamedTexture } from './TextureStreamer';

/**
 * Connects a {@link TextureStreamer} to the renderer: reports each material's on-screen coverage every frame (so mip residency follows what
 * is visible and how large), and rebuilds a material's bind group whenever one of its streamed textures changes its resident mips.
 */
export class StreamingDriver {
  /** The attached streamer, or null. */
  streamer: TextureStreamer | null = null;
  /** Streamed textures used by each material (computed once per material). */
  private refs = new Map<number, StreamedTexture[]>();

  constructor(private materials: MaterialManager) {}

  /** Attach (or detach with null) a streamer. */
  attach(s: TextureStreamer | null): void {
    this.streamer = s; this.refs.clear();
    if (s) s.onViewChanged = (t) => this.materials.textureChanged(t);
  }

  /** Report per-material screen coverage to the streamer, then apply its plan (before the frame's bind groups are used). */
  update(rw: RenderWorld, visible: VisibleSet | null, visibleCount: number, canvasHeight: number): void {
    const s = this.streamer;
    if (!s) return;
    s.beginFrame();
    const cam = rw.camera, tanHalf = Math.tan(cam.fovY / 2), sph = rw.boundsSphere;
    const px = new Map<number, number>();
    for (let n = 0; n < visibleCount; n++) {
      const slot = visible ? visible.slots![n] : n;
      const dx = sph[slot * 4] - cam.position[0], dy = sph[slot * 4 + 1] - cam.position[1], dz = sph[slot * 4 + 2] - cam.position[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz), r = sph[slot * 4 + 3];
      const pixels = d <= r ? canvasHeight : (r / (d * tanHalf)) * canvasHeight;
      const m = rw.materialId[slot];
      if (pixels > (px.get(m) ?? 0)) px.set(m, pixels);
    }
    for (const [m, pixels] of px) {
      let refs = this.refs.get(m);
      if (!refs) {
        refs = this.materials.get(m).textures.filter((t): t is StreamedTexture => !!t && s.textures.includes(t as StreamedTexture));
        this.refs.set(m, refs);
      }
      for (const t of refs) s.touch(t, pixels);
    }
    s.update();
  }
}
