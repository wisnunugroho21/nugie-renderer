import type { GPUContext } from '../../gpu/GPUContext';
import type { BindLayouts } from '../../gpu/BindLayouts';
import { POINTS_SOURCE, registerEngineShaderChunks } from '../../shaders';
import { StorageArray, OverlaySystem, type OverlayTarget, type Color, type Vec3 } from './Overlay';

export interface PointSystemOptions {
  /** Initial point capacity (grows automatically). */
  maxPoints?: number;
  /** Point size unit: 'pixels' (default; constant on screen) or 'world' (shrinks with distance like a small ball). */
  sizeUnit?: 'pixels' | 'world';
  /** 'disc' (anti-aliased circle, default) or 'square'. */
  shape?: 'disc' | 'square';
  /** Hide points behind geometry (default true). */
  depthTest?: boolean;
  /** Smallest / largest on-screen size in pixels (default 1 / unlimited): keeps distant world-sized points visible and near ones from covering the screen. */
  minSize?: number;
  maxSize?: number;
  /** Default size (pixels or world units depending on `sizeUnit`; default 4 px / 0.05 world). */
  size?: number;
  color?: Color;
  autoClear?: boolean;
  name?: string;
}

const PT_FLOATS = 8;

/**
 * Point clouds (three.js `Points`): many screen-facing discs / squares in one draw call. Points are positions + size + colour; there is
 * no texture (use a {@link SpriteSystem} for textured billboards). Retained until `clear()` unless `autoClear`.
 */
export class PointSystem extends OverlaySystem {
  size: number;
  color: Color;
  readonly depthTest: boolean;
  readonly sizeUnit: 'pixels' | 'world';
  readonly shape: 'disc' | 'square';
  private store: StorageArray;
  private n = 0;
  private dirty = false;
  private layout: GPUBindGroupLayout;
  private params: GPUBuffer;
  private bindGroup: GPUBindGroup | null = null;
  private bindGen = -1;
  private pipeline!: GPURenderPipeline;
  private layouts: BindLayouts;

  constructor(private gpu: GPUContext, layouts: BindLayouts, private target: OverlayTarget, o: PointSystemOptions = {}) {
    super('points');
    registerEngineShaderChunks(gpu.resources.shaders);
    this.layouts = layouts;
    this.autoClear = o.autoClear ?? false;
    this.sizeUnit = o.sizeUnit ?? 'pixels';
    this.shape = o.shape ?? 'disc';
    this.depthTest = o.depthTest ?? true;
    this.size = o.size ?? (this.sizeUnit === 'world' ? 0.05 : 4);
    this.color = o.color ?? [1, 1, 1, 1];
    this.store = new StorageArray(gpu, `${o.name ?? 'points'}:points`, PT_FLOATS, o.maxPoints ?? 4096);
    const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    this.layout = gpu.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: V | F, buffer: { type: 'uniform' } },
    ] });
    this.params = gpu.resources.buffers.create(`${o.name ?? 'points'}:params`, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    gpu.queue.writeBuffer(this.params, 0, new Float32Array([this.sizeUnit === 'world' ? 1 : 0, this.shape === 'disc' ? 1 : 0, Math.max(o.minSize ?? 1, 1), o.maxSize ?? 0]));
    this.retarget();
  }

  get count(): number { return this.n; }

  retarget(): void {
    const { device, resources: r } = this.gpu, t = this.target, depthTest = this.depthTest;
    const blend: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    this.pipeline = r.pipelines.getRender({
      shader: 'points', vertexEntry: 'vs_main', fragmentEntry: 'fs_main', vertexLayout: [], topology: 'triangle-list', cullMode: 'none',
      depth: { format: t.depthFormat, write: false, compare: depthTest ? 'less-equal' : 'always' },
      targets: [{ format: t.colorFormat, blend }], sampleCount: t.sampleCount, layout: `points-${depthTest}`,
    }, () => {
      const module = r.shaders.get('points', POINTS_SOURCE);
      return device.createRenderPipeline({
        label: `points-${depthTest}`, layout: device.createPipelineLayout({ bindGroupLayouts: [this.layouts.frame, this.layout] }),
        vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_main', targets: [{ format: t.colorFormat, blend }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: t.depthFormat, depthWriteEnabled: false, depthCompare: depthTest ? 'less-equal' : 'always' },
        multisample: { count: t.sampleCount },
      });
    });
  }

  clear(): void { if (this.n !== 0) { this.n = 0; this.dirty = true; } }

  flush(): void {
    if (this.dirty) { this.store.upload(this.n); this.dirty = false; }
  }

  encodeDraw(pass: GPURenderPassEncoder, frameBG: GPUBindGroup): void {
    if (!this.visible || this.n === 0) return;
    if (!this.bindGroup || this.bindGen !== this.store.generation) {
      this.bindGroup = this.gpu.device.createBindGroup({ label: 'points', layout: this.layout, entries: [
        { binding: 0, resource: { buffer: this.store.buffer } }, { binding: 1, resource: { buffer: this.params } },
      ] });
      this.bindGen = this.store.generation;
      this.dirty = true;
      this.flush();
    }
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameBG);
    pass.setBindGroup(1, this.bindGroup);
    pass.draw(6, this.n);
  }

  /** Add a point; returns its index (usable with `setAt`). */
  add(position: Vec3, color: Color = this.color, size: number = this.size): number {
    this.store.ensure(this.n + 1);
    this.write(this.n, position, color, size);
    this.dirty = true;
    return this.n++;
  }

  /** Add many points from a flat xyz array (the same colour / size for all). */
  addMany(xyz: ArrayLike<number>, color: Color = this.color, size: number = this.size): this {
    const count = Math.floor(xyz.length / 3);
    this.store.ensure(this.n + count);
    for (let i = 0; i < count; i++) this.write(this.n + i, [xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]], color, size);
    this.n += count; this.dirty = true;
    return this;
  }

  /** Overwrite point `i`. */
  setAt(i: number, position: Vec3, color: Color = this.color, size: number = this.size): void {
    if (i < 0 || i >= this.n) throw new RangeError(`PointSystem.setAt: index ${i} out of range`);
    this.write(i, position, color, size);
    this.dirty = true;
  }

  private write(i: number, p: Vec3, c: Color, size: number): void {
    const d = this.store.data, o = i * PT_FLOATS;
    d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2]; d[o + 3] = size;
    d[o + 4] = c[0]; d[o + 5] = c[1]; d[o + 6] = c[2]; d[o + 7] = c[3] ?? 1;
  }
}
