import type { GPUContext } from '../gpu/GPUContext';
import { mipLevelCount } from '../gpu/TextureManager';
import initSrc from '../shaders/hiz_init.wgsl?raw';
import downSrc from '../shaders/hiz_down.wgsl?raw';
import { technique } from './graph/TechniqueBuilder';
import type { TechniqueInstance } from './graph/TechniqueInstance';
import { DEPTH_FORMAT } from './formats';

/**
 * The timestamps of one pass of the pyramid build: the build is several passes, so the first one carries the start timestamp and the last one the end timestamp
 * (together they time the whole build). `mips` is the pyramid's level count.
 */
export function hizPassTimestamps(path: string, mips: number, whole: GPUComputePassTimestampWrites): GPUComputePassTimestampWrites | undefined {
  const lastPass = mips > 1 ? `hiz-down-${mips - 1}` : 'hiz-init';
  const begin = path === 'hiz-init' ? whole.beginningOfPassWriteIndex : undefined, end = path === lastPass ? whole.endOfPassWriteIndex : undefined;
  if (begin === undefined && end === undefined) return undefined;
  return { querySet: whole.querySet, ...(begin !== undefined ? { beginningOfPassWriteIndex: begin } : {}), ...(end !== undefined ? { endOfPassWriteIndex: end } : {}) };
}

/**
 * Hierarchical depth pyramid (r32float, max reduction => conservative for standard-Z occlusion tests).
 *
 * The build is a technique (see TECHNIQUES.md): one compute node copies the depth buffer into mip 0, then one node per further mip reads mip i-1 and
 * writes mip i of the same exported texture (bindings to single mip levels).
 */
export class HiZ {
  texture: GPUTexture | null = null;
  fullView: GPUTextureView | null = null;
  width = 0;
  height = 0;
  mips = 0;
  private fx: TechniqueInstance | null = null;
  private depthFormat: GPUTextureFormat = DEPTH_FORMAT;

  constructor(private gpu: GPUContext) {}

  /** Free the pyramid. */
  dispose(): void { this.fx?.dispose(); this.fx = null; this.texture = null; this.fullView = null; }

  /** (Re)create the pyramid for a `width` x `height` depth buffer of `depthFormat`; no-op when unchanged. */
  resize(width: number, height: number, depthFormat: GPUTextureFormat = this.depthFormat): void {
    if (width === this.width && height === this.height && depthFormat === this.depthFormat && this.fx) return;
    this.fx?.dispose();
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    this.depthFormat = depthFormat;
    this.mips = mipLevelCount(this.width, this.height);
    const g = technique('hiz');
    const depth = g.texture('depth', { format: depthFormat, size: [this.width, this.height], visibility: 'imported' });
    const hiz = g.texture('hiz', { format: 'r32float', size: [this.width, this.height], mips: 'full', visibility: 'exported' });
    g.compute('hiz-init', {
      shader: initSrc, reads: [depth], writes: [{ resource: hiz, name: 'dst', mip: 0 }], dispatch: { threads: [this.width, this.height] }, workgroupSize: [8, 8],
    });
    for (let m = 1; m < this.mips; m++) {
      g.compute(`hiz-down-${m}`, {
        shader: downSrc, reads: [{ resource: hiz, name: 'src', mip: m - 1, mipCount: 1 }], writes: [{ resource: hiz, name: 'dst', mip: m }],
        dispatch: { threads: [Math.max(1, this.width >> m), Math.max(1, this.height >> m)] }, workgroupSize: [8, 8],
      });
    }
    this.fx = g.instantiate(this.gpu, { label: 'hiz' });
    this.texture = this.fx.resource('hiz') as GPUTexture;
    this.fullView = this.texture.createView();
  }

  /** Append the pyramid build for `depth` (a depth texture with TEXTURE_BINDING usage, sized like the pyramid). */
  encode(enc: GPUCommandEncoder, depth: GPUTexture, timestampWrites?: GPUComputePassTimestampWrites): void {
    if (depth.format !== this.depthFormat) this.resize(this.width, this.height, depth.format);
    const fx = this.fx!;
    fx.setImport('depth', depth);
    fx.execute(enc, { timestampWrites: timestampWrites && ((path) => hizPassTimestamps(path, this.mips, timestampWrites)) });
  }
}
