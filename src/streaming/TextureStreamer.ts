import type { GPUContext } from '../gpu/GPUContext';
import { mipLevelCount } from '../gpu/TextureManager';
import type { TextureRef } from '../rendering/materials/Material';
import { StreamPolicy, mipBytes, type StreamConfig, type StreamEntry } from './StreamPolicy';

import { buildMipChain, type MipImage } from '../assets/MipChain';
export { buildMipChain, type MipImage } from '../assets/MipChain';

/** A texture whose resident mip range changes over time. Materials hold this object as their TextureRef. */
export class StreamedTexture implements TextureRef {
  /** Wraps the current GPU texture / view for `entry`; `gpuTexture` and `currentView` are replaced whenever the resident range changes. */
  constructor(readonly id: string, readonly entry: StreamEntry, readonly mips: MipImage[], readonly format: GPUTextureFormat, public gpuTexture: GPUTexture, public currentView: GPUTextureView) {}
  /** The view materials bind (always the latest resident mip range). */
  get view(): GPUTextureView { return this.currentView; }
  /** Finest resident level. */
  get residentLevel(): number { return this.entry.resident; }
}

/**
 * Applies StreamPolicy decisions on the GPU. Each texture owns a GPU texture holding only mips [resident, mipCount): changing the
 * resident level allocates a new texture, copies the shared mips GPU-side (copyTextureToTexture), uploads the newly resident mips
 * from the CPU chain and drops the old texture. `onViewChanged` lets the material system rebuild bind groups.
 */
export class TextureStreamer {
  readonly policy: StreamPolicy;
  readonly textures: StreamedTexture[] = [];
  onViewChanged: ((t: StreamedTexture) => void) | null = null;
  /** Stats of the last update(). */
  stats = { uploadedBytes: 0, changes: 0, residentBytes: 0 };

  /** Create a streamer; `config` overrides the default memory / upload budgets. */
  constructor(private gpu: GPUContext, config?: Partial<StreamConfig>) {
    this.policy = new StreamPolicy(config ? { ...new StreamPolicy().config, ...config } : undefined);
  }

  /** Register an RGBA8 image (a CPU mip chain is built; only the floor level goes to the GPU immediately). */
  create(id: string, rgba: Uint8Array, width: number, height: number, srgb: boolean): StreamedTexture {
    const mips = buildMipChain(rgba, width, height, srgb), count = mipLevelCount(width, height);
    const entry = this.policy.add(width, height, count, 4);
    const format: GPUTextureFormat = srgb ? 'rgba8unorm-srgb' : 'rgba8unorm';
    const t = new StreamedTexture(id, entry, mips, format, null as unknown as GPUTexture, null as unknown as GPUTextureView);
    this.realise(t, entry.resident, null);
    this.textures.push(t);
    return t;
  }

  /** Report the on-screen extent (pixels) a texture can cover this frame. */
  touch(t: StreamedTexture, pixels: number): void { this.policy.touch(t.entry.id, pixels); }

  /** Start a frame: forget last frame's on-screen coverage. */
  beginFrame(): void { this.policy.beginFrame(); }

  /** Apply the policy's plan for this frame. */
  update(): void {
    this.stats.uploadedBytes = 0;
    const changes = this.policy.plan();
    this.stats.changes = changes.length;
    for (const c of changes) {
      const t = this.textures[c.id];
      this.realise(t, c.to, c.from);
      this.onViewChanged?.(t);
    }
    this.stats.residentBytes = this.policy.totalResidentBytes;
  }

  /** (Re)create the GPU texture so that mips [base, mipCount) are resident; `oldBase` = the base of the existing texture. */
  private realise(t: StreamedTexture, base: number, oldBase: number | null): void {
    const { device, queue, resources } = this.gpu;
    const mips = t.mips, count = mips.length, w = mips[base].width, h = mips[base].height;
    const tex = resources.textures.create({
      label: `${t.id}@${base}`, size: [w, h], format: t.format, mipLevelCount: count - base,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    const enc = oldBase !== null ? device.createCommandEncoder({ label: 'stream-copy' }) : null;
    for (let l = base; l < count; l++) {
      const m = mips[l];
      if (oldBase !== null && l >= oldBase) {
        enc!.copyTextureToTexture({ texture: t.gpuTexture, mipLevel: l - oldBase }, { texture: tex, mipLevel: l - base }, [m.width, m.height]);
      } else {
        queue.writeTexture({ texture: tex, mipLevel: l - base }, m.data as Uint8Array<ArrayBuffer>, { bytesPerRow: m.width * 4 }, [m.width, m.height]);
        this.stats.uploadedBytes += mipBytes(t.entry, l);
      }
    }
    if (enc) queue.submit([enc.finish()]);
    if (t.gpuTexture) resources.textures.destroy(t.gpuTexture);
    t.gpuTexture = tex;
    t.currentView = tex.createView();
  }
}
