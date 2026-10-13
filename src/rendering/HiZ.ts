import type { GPUContext } from '../gpu/GPUContext';
import { mipLevelCount } from '../gpu/TextureManager';
import initSrc from '../shaders/hiz_init.wgsl?raw';
import downSrc from '../shaders/hiz_down.wgsl?raw';
import { technique } from './graph/TechniqueBuilder';
import { TechniqueInstance } from './graph/TechniqueInstance';
import type { FrameBuilder } from './graph/FrameGraph';
import type { Technique } from './graph/TechniqueTypes';
import { DEPTH_FORMAT } from './formats';

/**
 * The timestamps of one pass of the pyramid build: the build is several passes, so the first one carries the start timestamp and the last one the end timestamp
 * (together they time the whole build). `mips` is the pyramid's level count.
 */
export function hizPassTimestamps(path: string, mips: number, whole: GPUComputePassTimestampWrites): GPUComputePassTimestampWrites | undefined {
  const lastPass = mips > 1 ? `hiz-down-${mips - 1}` : 'hiz-init';
  const node = path.slice(path.lastIndexOf('/') + 1);   // in a frame the build's nodes sit below the sub-technique's path
  const begin = node === 'hiz-init' ? whole.beginningOfPassWriteIndex : undefined, end = node === lastPass ? whole.endOfPassWriteIndex : undefined;
  if (begin === undefined && end === undefined) return undefined;
  return { querySet: whole.querySet, ...(begin !== undefined ? { beginningOfPassWriteIndex: begin } : {}), ...(end !== undefined ? { endOfPassWriteIndex: end } : {}) };
}

/**
 * Hierarchical depth pyramid (r32float, max reduction => conservative for standard-Z occlusion tests).
 *
 * The build is a technique (see TECHNIQUES.md): one compute node copies the depth buffer into mip 0, then one node per further mip reads mip i-1 and
 * writes mip i of the same texture (bindings to single mip levels). The pyramid is created here and imported by the technique; in a frame the nodes are part of the
 * frame's graph (`addToFrame`), `encode` runs the same technique on its own (tests, tools).
 */
export class HiZ {
  texture: GPUTexture | null = null;
  width = 0;
  height = 0;
  mips = 0;
  /** The technique on its own, for `encode` (made on first use: frames run the technique as part of the frame's graph). */
  private standalone: TechniqueInstance | null = null;
  private tech: Technique | null = null;
  private depthFormat: GPUTextureFormat = DEPTH_FORMAT;

  constructor(private gpu: GPUContext) {}

  /** Free the pyramid. */
  dispose(): void { this.standalone?.dispose(); this.standalone = null; this.tech = null; this.destroyTexture(); }

  private destroyTexture(): void {
    if (this.texture) this.gpu.resources.textures.destroy(this.texture);
    this.texture = null;
  }

  /** (Re)create the pyramid and its technique for a `width` x `height` depth buffer of `depthFormat`; no-op when unchanged. */
  resize(width: number, height: number, depthFormat: GPUTextureFormat = this.depthFormat): void {
    if (width === this.width && height === this.height && depthFormat === this.depthFormat && this.tech) return;
    this.standalone?.dispose();
    this.standalone = null;
    this.destroyTexture();
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    this.depthFormat = depthFormat;
    this.mips = mipLevelCount(this.width, this.height);
    const g = technique('hiz');
    const depth = g.texture('depth', { format: depthFormat, size: [this.width, this.height], visibility: 'imported' });
    const hiz = g.texture('hiz', { format: 'r32float', size: [this.width, this.height], mips: 'full', visibility: 'imported' });
    g.compute('hiz-init', {
      shader: initSrc, reads: [depth], writes: [{ resource: hiz, name: 'dst', mip: 0 }], dispatch: { threads: [this.width, this.height] }, workgroupSize: [8, 8],
    });
    for (let m = 1; m < this.mips; m++) {
      g.compute(`hiz-down-${m}`, {
        shader: downSrc, reads: [{ resource: hiz, name: 'src', mip: m - 1, mipCount: 1 }], writes: [{ resource: hiz, name: 'dst', mip: m }],
        dispatch: { threads: [Math.max(1, this.width >> m), Math.max(1, this.height >> m)] }, workgroupSize: [8, 8],
      });
    }
    this.tech = g.build();
    this.texture = this.gpu.resources.textures.create({
      label: 'hiz', size: [this.width, this.height], format: 'r32float', mipLevelCount: this.mips,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });
  }

  /** Add the pyramid build for `depth` to the frame: the technique's nodes read the depth buffer and write the pyramid (the frame's `hizTex`). */
  addToFrame(g: FrameBuilder, depth: GPUTexture, whole?: () => GPUComputePassTimestampWrites | undefined): void {
    if (depth.format !== this.depthFormat || !this.tech) this.resize(this.width, this.height, depth.format);
    g.include('hiz', this.tech!, { imports: { depth: { as: 'depth', resource: depth }, hiz: { as: 'hizTex', resource: this.texture! } } });
    if (whole) {
      let writes: GPUComputePassTimestampWrites | undefined, taken = false;
      g.timestamps('hiz', (path) => { if (!taken) { taken = true; writes = whole(); } return writes && hizPassTimestamps(path, this.mips, writes); });
    }
  }

  /** Append the pyramid build for `depth` (a depth texture with TEXTURE_BINDING usage, sized like the pyramid). */
  encode(enc: GPUCommandEncoder, depth: GPUTexture, timestampWrites?: GPUComputePassTimestampWrites): void {
    if (depth.format !== this.depthFormat || !this.tech) this.resize(this.width, this.height, depth.format);
    const fx = this.standalone ??= TechniqueInstance.create(this.gpu, this.tech!, { label: 'hiz', imports: { hiz: this.texture! } });
    fx.setImport('depth', depth);
    fx.execute(enc, { timestampWrites: timestampWrites && ((path) => hizPassTimestamps(path, this.mips, timestampWrites)) });
  }
}
