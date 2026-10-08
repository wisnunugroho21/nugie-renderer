import type { GPUContext } from '../gpu/GPUContext';
import type { BindLayouts } from '../gpu/BindLayouts';
import type { TextureRef } from '../rendering/materials/Material';
import { registerEngineShaderChunks } from '../shaders';
import updateSource from '../shaders/ribbons_update.wgsl?raw';
import renderSource from '../shaders/ribbons_render.wgsl?raw';
import type { Vec3, Vec4 } from './EmitterConfig';

export type RibbonMode = 'trail' | 'chain' | 'flat';
const MODE_ID: Record<RibbonMode, number> = { trail: 0, chain: 1, flat: 2 };

export interface RibbonConfig {
  /** 'trail': history of a moving head | 'chain': explicit points set each frame (beams, lightning, whips) | 'flat': trail on a fixed plane (slash / streak). */
  mode?: RibbonMode;
  colorStart?: Vec4;
  colorEnd?: Vec4;
  /** Width at the head and at the tail (meters). */
  widthHead?: number;
  widthTail?: number;
  /** Seconds a committed point lives (0 = never fades by age; the ribbon then tapers/fades along its length). */
  lifetime?: number;
  /** A new point is committed after the head moved this far (meters). */
  minSegment?: number;
  /** Plane normal for 'flat' ribbons. */
  flatNormal?: Vec3;
  /** Texture u units per meter of ribbon length. */
  uvPerMeter?: number;
}

export interface RibbonSystemConfig {
  name?: string;
  maxRibbons: number;
  /** Ring capacity: max points per ribbon. */
  pointsPerRibbon: number;
  blend?: 'alpha' | 'additive';
  texture?: TextureRef;
}

export const RIBBON_DESC_FLOATS = 28;   // 112 bytes, mirrors `RibbonDesc`
export const SEGMENT_FLOATS = 12;       // 48 bytes, mirrors `Segment`

/**
 * Ribbons, trails, beams/chains and flat streaks. All ribbons share one segment ring buffer and one draw call.
 *   - trail/flat : a compute kernel advances each ribbon's history (commit when the head moved `minSegment`)
 *   - chain      : the CPU writes the ordered control points directly (beams, lightning)
 */
export class RibbonSystem {
  readonly descBuf: GPUBuffer;
  readonly segmentBuf: GPUBuffer;
  readonly updateParams: GPUBuffer;
  count = 0;
  private desc: Float32Array;
  private descU32: Uint32Array;
  private updateBG: GPUBindGroup;
  private renderBG: GPUBindGroup;
  private pipeline: GPURenderPipeline;
  private layout: GPUBindGroupLayout;
  private dirty = new Set<number>();
  /** Ribbons whose descriptor has been uploaded once: from then on the GPU OWNS their trail state (head/count). */
  private gpuStateKnown = new Set<number>();
  private resetPending = new Set<number>();
  private updatePipeline: GPUComputePipeline;
  private upData = new ArrayBuffer(16);
  private N: number;

  /** Allocate the ribbon descriptor and shared segment ring buffers (`maxRibbons` x `pointsPerRibbon`) and build the update + render pipelines. */
  constructor(readonly gpu: GPUContext, layouts: BindLayouts, readonly target: { colorFormat: GPUTextureFormat; depthFormat: GPUTextureFormat; sampleCount: number }, readonly config: RibbonSystemConfig) {
    const { device, resources: res } = gpu;
    registerEngineShaderChunks(res.shaders);
    this.N = config.pointsPerRibbon;
    const M = config.maxRibbons, label = config.name ?? 'ribbons';
    const S = GPUBufferUsage.STORAGE, D = GPUBufferUsage.COPY_DST, C = GPUBufferUsage.COPY_SRC;
    this.descBuf = res.buffers.create(`${label}:RibbonDescBuffer`, M * RIBBON_DESC_FLOATS * 4, S | D | C);
    this.segmentBuf = res.buffers.create(`${label}:RibbonSegmentBuffer`, M * this.N * SEGMENT_FLOATS * 4, S | D | C);
    this.updateParams = res.buffers.create(`${label}:RibbonUpdateParams`, 16, GPUBufferUsage.UNIFORM | D);
    this.desc = new Float32Array(M * RIBBON_DESC_FLOATS);
    this.descU32 = new Uint32Array(this.desc.buffer);

    const C_ = GPUShaderStage.COMPUTE, V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    const updateLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: C_, buffer: { type: 'uniform' } },
      { binding: 1, visibility: C_, buffer: { type: 'storage' } },
      { binding: 2, visibility: C_, buffer: { type: 'storage' } },
    ] });
    this.updateBG = device.createBindGroup({ layout: updateLayout, entries: [
      { binding: 0, resource: { buffer: this.updateParams } }, { binding: 1, resource: { buffer: this.descBuf } }, { binding: 2, resource: { buffer: this.segmentBuf } },
    ] });
    this.updatePipeline = res.pipelines.getCompute(`ribbons-update:${label}`, () => device.createComputePipeline({
      label: 'ribbons-update', compute: { module: res.shaders.get('ribbons-update', updateSource), entryPoint: 'update_trails' },
      layout: device.createPipelineLayout({ bindGroupLayouts: [updateLayout] }),
    }));

    this.layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: F, sampler: { type: 'filtering' } },
      { binding: 3, visibility: F, texture: { sampleType: 'float' } },
    ] });
    const tex = config.texture ?? this.defaultStreak();
    this.renderBG = device.createBindGroup({ layout: this.layout, entries: [
      { binding: 0, resource: { buffer: this.descBuf } }, { binding: 1, resource: { buffer: this.segmentBuf } },
      { binding: 2, resource: res.samplers.get({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge' }) },
      { binding: 3, resource: tex.view },
    ] });

    const blendMode = config.blend ?? 'additive', t = target;
    const blend: GPUBlendState = blendMode === 'additive'
      ? { color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } }
      : { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    this.pipeline = res.pipelines.getRender({
      shader: 'ribbons-render', vertexEntry: 'vs_main', fragmentEntry: 'fs_main', vertexLayout: [], topology: 'triangle-list', cullMode: 'none',
      depth: { format: t.depthFormat, write: false, compare: 'less-equal' }, targets: [{ format: t.colorFormat, blend }], sampleCount: t.sampleCount, layout: `ribbons-${blendMode}`,
    }, () => {
      const module = res.shaders.get('ribbons-render', renderSource);
      return device.createRenderPipeline({
        label: `ribbons-${blendMode}`, layout: device.createPipelineLayout({ bindGroupLayouts: [layouts.frame, this.layout] }),
        vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_main', targets: [{ format: t.colorFormat, blend }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: t.depthFormat, depthWriteEnabled: false, depthCompare: 'less-equal' }, multisample: { count: t.sampleCount },
      });
    });
  }

  /** Soft-edged streak (alpha falls off toward the ribbon's edges), generated on the CPU. */
  private defaultStreak(): TextureRef {
    const { device, resources: res } = this.gpu;
    const W = 8, H = 64, data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = Math.abs((y + 0.5) / H * 2 - 1), a = Math.pow(Math.max(0, 1 - v), 1.5);
      data.set([255, 255, 255, Math.round(a * 255)], (y * W + x) * 4);
    }
    const tex = res.textures.create({ label: 'ribbon-streak', size: [W, H], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: W * 4 }, [W, H]);
    return { id: 'ribbon-streak', view: tex.createView() };
  }

  /** Register a ribbon; returns its id. */
  addRibbon(cfg: RibbonConfig = {}): number {
    if (this.count >= this.config.maxRibbons) throw new Error('RibbonSystem is full');
    const id = this.count++;
    const o = id * RIBBON_DESC_FLOATS, f = this.desc, u = this.descU32;
    const cs = cfg.colorStart ?? [1, 1, 1, 1], ce = cfg.colorEnd ?? [1, 1, 1, 0], n = cfg.flatNormal ?? [0, 1, 0];
    f[o] = 0; f[o + 1] = 0; f[o + 2] = 0; f[o + 3] = 0;                         // target (disabled until the first setTarget)
    f.set(cs, o + 4); f.set(ce, o + 8);
    f[o + 12] = cfg.widthHead ?? 0.2; f[o + 13] = cfg.widthTail ?? 0; f[o + 14] = cfg.lifetime ?? 0.6; f[o + 15] = cfg.uvPerMeter ?? 1;
    f[o + 16] = n[0]; f[o + 17] = n[1]; f[o + 18] = n[2]; f[o + 19] = MODE_ID[cfg.mode ?? 'trail'];
    u[o + 20] = 0; u[o + 21] = 0; u[o + 22] = this.N; u[o + 23] = 0;            // head, count, capacity
    f[o + 24] = cfg.minSegment ?? 0.1;
    this.dirty.add(id);
    return id;
  }

  /** Trail / flat ribbon: set the current head position (call every frame from the moving entity). */
  setTarget(id: number, x: number, y: number, z: number, enabled = true): void {
    const o = id * RIBBON_DESC_FLOATS;
    this.desc[o] = x; this.desc[o + 1] = y; this.desc[o + 2] = z; this.desc[o + 3] = enabled ? 1 : 0;
    this.dirty.add(id);
  }

  /** Forget the history (after a teleport) so no streak is drawn across the jump. */
  reset(id: number): void { const o = id * RIBBON_DESC_FLOATS; this.descU32[o + 20] = 0; this.descU32[o + 21] = 0; this.resetPending.add(id); this.dirty.add(id); }

  /**
   * Chain / beam: write the ordered control points directly (xyz per point, first = head). Optional per-point widths
   * (multiplier) and colors (rgba). Length is accumulated for texture coordinates.
   */
  setChain(id: number, points: ArrayLike<number>, widths?: ArrayLike<number>, colors?: ArrayLike<number>): void {
    const n = Math.min(Math.floor(points.length / 3), this.N);
    const seg = new Float32Array(n * SEGMENT_FLOATS);
    let dist = 0;
    // ring order: slot head = newest = points[0]; older points at lower slots going back => write reversed
    for (let i = 0; i < n; i++) {
      const slot = n - 1 - i;               // head = n - 1 holds points[0]
      const o = slot * SEGMENT_FLOATS;
      if (i > 0) dist += Math.hypot(points[i * 3] - points[(i - 1) * 3], points[i * 3 + 1] - points[(i - 1) * 3 + 1], points[i * 3 + 2] - points[(i - 1) * 3 + 2]);
      seg[o] = points[i * 3]; seg[o + 1] = points[i * 3 + 1]; seg[o + 2] = points[i * 3 + 2]; seg[o + 3] = 0;
      seg[o + 4] = colors?.[i * 4] ?? 1; seg[o + 5] = colors?.[i * 4 + 1] ?? 1; seg[o + 6] = colors?.[i * 4 + 2] ?? 1; seg[o + 7] = colors?.[i * 4 + 3] ?? 1;
      seg[o + 8] = widths?.[i] ?? 1; seg[o + 9] = dist;
    }
    this.gpu.device.queue.writeBuffer(this.segmentBuf, id * this.N * SEGMENT_FLOATS * 4, seg);
    const o = id * RIBBON_DESC_FLOATS;
    this.descU32[o + 20] = n - 1; this.descU32[o + 21] = n; this.desc[o + 3] = n >= 2 ? 1 : 0;
    this.dirty.add(id);
  }

  /** CPU -> GPU: upload changed ribbon descriptors. The segment history itself lives on the GPU. */
  update(time: number): void {
    const { device } = this.gpu;
    // Trail state (head/count) is OWNED by the GPU after creation: only re-upload descriptors the CPU touched, and keep the
    // GPU-side head/count by uploading just the CPU-owned fields (target, config) - done per ribbon to avoid clobbering state.
    for (const id of this.dirty) {
      const o = id * RIBBON_DESC_FLOATS;
      const mode = this.desc[o + 19];
      if (this.gpuStateKnown.has(id) && mode !== MODE_ID.chain) {
        // upload fields 0..19 (target, colors, widths, shape) and 24..27 (params); leave state (20..23) alone
        device.queue.writeBuffer(this.descBuf, o * 4, this.desc.buffer, o * 4, 20 * 4);
        device.queue.writeBuffer(this.descBuf, (o + 24) * 4, this.desc.buffer, (o + 24) * 4, 4 * 4);
        if (this.resetPending.has(id)) { device.queue.writeBuffer(this.descBuf, (o + 20) * 4, this.desc.buffer, (o + 20) * 4, 16); this.resetPending.delete(id); }
      } else {
        device.queue.writeBuffer(this.descBuf, o * 4, this.desc.buffer, o * 4, RIBBON_DESC_FLOATS * 4);
        this.gpuStateKnown.add(id);
      }
    }
    this.dirty.clear();
    new Float32Array(this.upData)[0] = time; new Uint32Array(this.upData)[1] = this.count;
    device.queue.writeBuffer(this.updateParams, 0, this.upData);
  }

  /** Record the compute pass that extends trails and writes new segments (skipped when there are no ribbons). */
  encodeCompute(enc: GPUCommandEncoder): void {
    if (this.count === 0) return;
    const pass = enc.beginComputePass({ label: 'ribbons-update' });
    pass.setPipeline(this.updatePipeline);
    pass.setBindGroup(0, this.updateBG);
    pass.dispatchWorkgroups(Math.ceil(this.count / 64));
    pass.end();
  }

  /** Record the ribbon draw: all segments of all ribbons in one instanced draw call. */
  encodeDraw(pass: GPURenderPassEncoder, frameBG: GPUBindGroup): void {
    if (this.count === 0) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameBG);
    pass.setBindGroup(1, this.renderBG);
    pass.draw(6 * (this.N - 1), this.count);                // every segment of every ribbon: ONE draw call
  }

  /** DEBUG ONLY: read back descriptors (state) and segments of one ribbon. */
  async readRibbon(id: number): Promise<{ head: number; count: number; points: Float32Array }> {
    const { device } = this.gpu;
    const rb = device.createBuffer({ size: RIBBON_DESC_FLOATS * 4 + this.N * SEGMENT_FLOATS * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(this.descBuf, id * RIBBON_DESC_FLOATS * 4, rb, 0, RIBBON_DESC_FLOATS * 4);
    enc.copyBufferToBuffer(this.segmentBuf, id * this.N * SEGMENT_FLOATS * 4, rb, RIBBON_DESC_FLOATS * 4, this.N * SEGMENT_FLOATS * 4);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const all = rb.getMappedRange().slice(0); rb.unmap(); rb.destroy();
    const u = new Uint32Array(all, 0, RIBBON_DESC_FLOATS);
    return { head: u[20], count: u[21], points: new Float32Array(all, RIBBON_DESC_FLOATS * 4) };
  }
}

/**
 * Jittered polyline between two points (lightning / beam / whip), deterministic for a seed. The first and last points are
 * exactly `a` and `b`; interior points are displaced perpendicular to the beam by up to `jitter` (tapering to zero at the ends).
 */
export function beamPoints(a: Vec3, b: Vec3, segments: number, jitter: number, seed = 1): Float32Array {
  const n = Math.max(2, segments + 1), out = new Float32Array(n * 3);
  let s = seed >>> 0 || 1;
  /** Deterministic pseudo-random number in [-1, 1) (LCG). */
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  // two perpendicular axes to the beam direction
  const ux = dx / len, uy = dy / len, uz = dz / len;
  let px = uy * 0 - uz * 1, py = uz * 0 - ux * 0, pz = ux * 1 - uy * 0;     // u x (0,0,1)
  if (Math.hypot(px, py, pz) < 1e-4) { px = 1; py = 0; pz = 0; }
  const pl = Math.hypot(px, py, pz); px /= pl; py /= pl; pz /= pl;
  const qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), taper = Math.sin(Math.PI * t), j1 = rnd() * jitter * taper, j2 = rnd() * jitter * taper;
    out[i * 3] = a[0] + dx * t + px * j1 + qx * j2; out[i * 3 + 1] = a[1] + dy * t + py * j1 + qy * j2; out[i * 3 + 2] = a[2] + dz * t + pz * j1 + qz * j2;
  }
  return out;
}
