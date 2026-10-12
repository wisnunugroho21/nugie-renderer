import type { GPUContext } from '../gpu/GPUContext';
import { CachedTechnique } from './graph/CachedTechnique';
import type { ResourceRef, TechniqueBuilder } from './graph/TechniqueBuilder';
import type { TrackedRenderPass } from './graph/TrackedRenderPass';

/** What a main pass renders into this frame. */
export interface MainPassTargets {
  /** The image the pass ends up in: the HDR scene texture, the swap chain's current texture, an off-screen target, or (with `layer`) one face of a cube capture. */
  final: GPUTexture;
  /** Array layer of `final` to draw into (a cube map face). Default 0. */
  layer?: number;
  /** The multisampled colour buffer drawn into (and resolved into `final`) when MSAA is on. */
  msaa: GPUTexture | null;
  depth: GPUTexture;
  /** Clear colour in the units of `final` (linear for the HDR target, sRGB-encoded for the swap chain). */
  clear: { r: number; g: number; b: number; a: number };
}

/** One ordered part of a main pass: the scene's geometry, or the draws of one feature. */
export interface MainPassSegment {
  name: string;
  record: (pass: TrackedRenderPass) => void;
}

export interface MainPassOptions {
  /** Clear the colour target (else load it). */
  clear: boolean;
  /** Load the depth buffer (a prepass or an earlier pass filled it) instead of clearing it. */
  depthLoad: boolean;
  /** MSAA: keep the multisampled samples after the resolve (a later pass loads them). Default: discard. */
  keepMsaa?: boolean;
  /** `discard` when nothing reads the depth afterwards (an off-screen view). Default `store`. */
  depthStore?: 'store' | 'discard';
}

/** sRGB-encoded colour -> linear (HDR targets hold linear values). */
export function srgbToLinear(c: MainPassTargets['clear']): MainPassTargets['clear'] {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return { r: lin(c.r), g: lin(c.g), b: lin(c.b), a: c.a };
}

/** The resources a main pass draws into, as handles of the technique that declares the pass. */
export interface MainPassHandles {
  /** The image the pass ends up in (`final`); a 2d-array for a cube capture, with `layer` naming the face. */
  image: ResourceRef;
  /** The multisampled colour buffer (resolved into `image`), or null. */
  msaa: ResourceRef | null;
  depth: ResourceRef;
}

/**
 * Declare a main pass as a render node of `g`: the attachments (colour with the MSAA resolve, depth) with their load / store ops and clear colour, and the ordered
 * `segments` (the scene's geometry and each feature's draws), which are recorded through one `TrackedRenderPass`. The frame graph declares its passes with this, and
 * `MainPassNode` declares the off-screen views' passes with it. `after` lists resources the pass's draws read that other passes produce.
 */
export function declareMainPass(
  g: TechniqueBuilder, name: string, h: MainPassHandles, clear: MainPassTargets['clear'], options: MainPassOptions,
  segments: readonly MainPassSegment[], o: { layer?: number; after?: ResourceRef[] } = {},
): void {
  const color = [clear.r, clear.g, clear.b, clear.a] as [number, number, number, number];
  const loadOp = options.clear ? 'clear' as const : 'load' as const;
  const target = h.msaa
    ? { resource: h.msaa, resolve: h.image, loadOp, clearValue: color, storeOp: options.keepMsaa ? 'store' as const : 'discard' as const }
    : { resource: h.image, loadOp, clearValue: color, ...(o.layer ? { layer: o.layer } : {}) };
  g.renderPass(name, {
    colorTargets: [target], depthTarget: { resource: h.depth, loadOp: options.depthLoad ? 'load' : 'clear', clearValue: 1, ...(options.depthStore ? { storeOp: options.depthStore } : {}) },
    segments: segments.map((segment) => ({ name: segment.name, record: segment.record })),
    ...(o.after?.length ? { after: o.after } : {}),
  });
}

/**
 * One of the off-screen views' main passes as a render node of a small technique: the technique owns the attachments (the swap chain or HDR scene image, the
 * multisampled buffer it resolves from, the depth buffer, their load / store ops and the clear colour) and the pass timestamps. The scene's geometry and each feature's draws
 * are the node's ordered segments, recorded through one `TrackedRenderPass`, so a pipeline or bind group shared by neighbouring segments is set once. The technique is
 * rebuilt only when the targets, the options or the list of segments change.
 */
export class MainPassNode {
  private pass: CachedTechnique;
  /** The current frame's segment draws; the node's segments call through this array, so the technique outlives the per-frame closures. */
  private records: ((pass: TrackedRenderPass) => void)[] = [];

  constructor(gpu: GPUContext, readonly name: string) {
    this.pass = new CachedTechnique(gpu, name);
  }

  /** Record the pass into `enc`, with `segments` drawn in order (the node itself is built once and reused while the segment names stay the same). */
  run(
    enc: GPUCommandEncoder, targets: MainPassTargets, options: MainPassOptions, segments: readonly MainPassSegment[],
    timestampWrites?: GPURenderPassTimestampWrites,
  ): void {
    const { final, msaa, depth, clear } = targets;
    const color = [clear.r, clear.g, clear.b, clear.a] as [number, number, number, number];
    const layers = final.depthOrArrayLayers, layer = targets.layer ?? 0;
    const key = [final.width, final.height, layers, layer, options.depthStore ?? 'store', final.format, msaa ? msaa.sampleCount : 1, msaa?.format, depth.format, depth.sampleCount, options.clear, options.depthLoad, options.keepMsaa === true, options.clear ? color.join(',') : '', segments.map((s) => s.name).join(',')].join('|');
    const fx = this.pass.get(key, (t) => {
      const size = [final.width, final.height];
      const image = t.texture('color', { format: final.format, size: layers > 1 ? [...size, layers] : size, ...(layers > 1 ? { dimension: '2d-array' as const } : {}), visibility: 'imported' });
      const msaaHandle = msaa ? t.texture('msaa', { format: msaa.format, size, samples: msaa.sampleCount as 1 | 4, visibility: 'imported' }) : null;
      const depthTarget = t.texture('depth', { format: depth.format, size, samples: depth.sampleCount as 1 | 4, visibility: 'imported' });
      declareMainPass(t, this.name, { image, msaa: msaaHandle, depth: depthTarget }, clear, options, segments.map((segment, i) => ({ name: segment.name, record: (pass) => this.records[i](pass) })), { layer });
    });
    this.records = segments.map((segment) => segment.record);
    fx.setImport('color', final); fx.setImport('depth', depth);
    if (msaa) fx.setImport('msaa', msaa);
    fx.execute(enc, { timestampWrites: () => timestampWrites });
    this.records = [];
  }

  /** Free the node's technique. */
  dispose(): void { this.pass.dispose(); }
}
