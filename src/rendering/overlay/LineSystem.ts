import type { GPUContext } from '../../gpu/GPUContext';
import type { BindLayouts } from '../../gpu/BindLayouts';
import { LINES_SOURCE, registerEngineShaderChunks } from '../../shaders';
import { sub, mul, len, norm, basisFromNormal } from '../../math/Tuple3';
import { StorageArray, OverlaySystem, type OverlayTarget, type Color, type Vec3 } from './Overlay';

export interface LineSystemOptions {
  /** Initial segment capacity (grows automatically). */
  maxSegments?: number;
  /** Hide lines behind geometry (default true). false draws on top of everything (gizmos, selection outlines). */
  depthTest?: boolean;
  /** Default width in pixels (default 1.5). */
  width?: number;
  /** Default colour (default white). */
  color?: Color;
  /** Width unit: 'pixels' (default; constant on screen) or 'world' (lines shrink with distance, like geometry). */
  widthUnit?: 'pixels' | 'world';
  /** Dashed lines: dash and gap lengths in WORLD units along the line (the pattern runs on continuously along a `polyline`; each `line` starts a fresh pattern). */
  dashSize?: number;
  gapSize?: number;
  /** Shifts the dash pattern along the line (world units): animate it for marching ants. */
  dashOffset?: number;
  /** Ends of every segment: 'square' (default, joins neighbours without gaps), 'round' or 'butt'. */
  caps?: 'butt' | 'square' | 'round';
  /** Clear after every frame: re-issue the lines each frame (immediate mode, e.g. debug drawing). Default false: lines stay until `clear()`. */
  autoClear?: boolean;
  name?: string;
}

const SEG_FLOATS = 20;     // a (xyz, width), b (xyz, width), colorA, colorB, distance along the polyline at a / at b

/**
 * Thick, anti-aliased lines in world space (three.js `Line` / `LineSegments` / `Line2`), plus debug-draw helpers (boxes, spheres, arrows,
 * axes, grids, frusta). Width is in screen pixels, colour is linear HDR with alpha. All segments of a system are ONE draw call.
 *
 * ```ts
 * const lines = engine.createLineSystem({ autoClear: true });
 * engine.addSystem({ update: () => { lines.box(min, max, [1, 0.4, 0]); lines.axes([0, 0, 0], 1); } }, 'afterTransforms');
 * ```
 */
export class LineSystem extends OverlaySystem {
  width: number;
  color: Color;
  readonly depthTest: boolean;
  readonly widthUnit: 'pixels' | 'world';
  /** Dash pattern (world units; `dashSize` 0 = solid line). Changes take effect on the next frame. */
  dashSize: number;
  gapSize: number;
  dashOffset: number;
  caps: 'butt' | 'square' | 'round';
  private store: StorageArray;
  private params0: GPUBuffer;
  private params1: GPUBuffer;
  private n = 0;
  private dirty = false;
  private layout: GPUBindGroupLayout;
  private bindGroup: GPUBindGroup | null = null;
  private bindGen = -1;
  private pipeline!: GPURenderPipeline;

  constructor(private gpu: GPUContext, layouts: BindLayouts, private target: OverlayTarget, o: LineSystemOptions = {}) {
    super('lines');
    registerEngineShaderChunks(gpu.resources.shaders);
    this.autoClear = o.autoClear ?? false;
    this.width = o.width ?? 1.5;
    this.color = o.color ?? [1, 1, 1, 1];
    this.depthTest = o.depthTest ?? true;
    this.widthUnit = o.widthUnit ?? 'pixels';
    this.dashSize = o.dashSize ?? 0; this.gapSize = o.gapSize ?? 0; this.dashOffset = o.dashOffset ?? 0; this.caps = o.caps ?? 'square';
    this.store = new StorageArray(gpu, `${o.name ?? 'lines'}:segments`, SEG_FLOATS, o.maxSegments ?? 4096);
    const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    this.layout = gpu.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: V | F, buffer: { type: 'uniform' } },
      { binding: 2, visibility: V, buffer: { type: 'uniform' } },
    ] });
    const U = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    this.params0 = gpu.resources.buffers.create(`${o.name ?? 'lines'}:params0`, 16, U);
    this.params1 = gpu.resources.buffers.create(`${o.name ?? 'lines'}:params1`, 16, U);
    this.layouts = layouts;
    this.retarget();
  }
  private layouts: BindLayouts;

  /** Number of segments currently stored. */
  get count(): number { return this.n; }

  retarget(): void {
    const { device, resources: r } = this.gpu, t = this.target, depthTest = this.depthTest;
    const blend: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    this.pipeline = r.pipelines.getRender({
      shader: 'lines', vertexEntry: 'vs_main', fragmentEntry: 'fs_main', vertexLayout: [], topology: 'triangle-list', cullMode: 'none',
      depth: { format: t.depthFormat, write: false, compare: depthTest ? 'less-equal' : 'always' },
      targets: [{ format: t.colorFormat, blend }], sampleCount: t.sampleCount, layout: `lines-${depthTest}`,
    }, () => {
      const module = r.shaders.get('lines', LINES_SOURCE);
      return device.createRenderPipeline({
        label: `lines-${depthTest}`, layout: device.createPipelineLayout({ bindGroupLayouts: [this.layouts.frame, this.layout] }),
        vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_main', targets: [{ format: t.colorFormat, blend }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: t.depthFormat, depthWriteEnabled: false, depthCompare: depthTest ? 'less-equal' : 'always' },
        multisample: { count: t.sampleCount },
      });
    });
  }

  /** Change the dash pattern (world units; `dash` 0 = solid). */
  setDash(dash: number, gap: number, offset = 0): this { this.dashSize = dash; this.gapSize = gap; this.dashOffset = offset; return this; }

  private lastParams = '';
  /** Send the dash / cap / width-unit parameters when they changed. */
  private writeParams(): void {
    const cap = this.caps === 'butt' ? 0 : this.caps === 'round' ? 2 : 1;
    const key = `${this.dashSize}|${this.gapSize}|${this.dashOffset}|${cap}|${this.widthUnit}`;
    if (key === this.lastParams) return;
    this.lastParams = key;
    this.gpu.queue.writeBuffer(this.params0, 0, new Float32Array([this.dashSize, this.gapSize, this.dashOffset, cap]));
    this.gpu.queue.writeBuffer(this.params1, 0, new Float32Array([this.widthUnit === 'world' ? 1 : 0, 0, 0, 0]));
  }

  clear(): void { if (this.n !== 0) { this.n = 0; this.dirty = true; } }

  flush(): void {
    this.writeParams();
    if (this.dirty) { this.store.upload(this.n); this.dirty = false; }
  }

  encodeDraw(pass: GPURenderPassEncoder, frameBG: GPUBindGroup): void {
    if (!this.visible || this.n === 0) return;
    if (!this.bindGroup || this.bindGen !== this.store.generation) {
      this.bindGroup = this.gpu.device.createBindGroup({ label: 'lines', layout: this.layout, entries: [
        { binding: 0, resource: { buffer: this.store.buffer } }, { binding: 1, resource: { buffer: this.params0 } }, { binding: 2, resource: { buffer: this.params1 } },
      ] });
      this.bindGen = this.store.generation;
      this.dirty = true;                                  // a re-created buffer is empty
      this.flush();
    }
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameBG);
    pass.setBindGroup(1, this.bindGroup);
    pass.draw(6, this.n);
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------------------------

  /** One segment from `a` to `b`. */
  line(a: Vec3, b: Vec3, color: Color = this.color, width: number = this.width): this {
    return this.gradient(a, b, color, color, width);
  }

  /** One segment whose colour blends from `ca` at `a` to `cb` at `b`. `startDist` is the distance along the line at `a` (continues a dash pattern). */
  gradient(a: Vec3, b: Vec3, ca: Color, cb: Color, width: number = this.width, startDist = 0): this {
    this.store.ensure(this.n + 1);
    const d = this.store.data, o = this.n * SEG_FLOATS;
    d[o] = a[0]; d[o + 1] = a[1]; d[o + 2] = a[2]; d[o + 3] = width;
    d[o + 4] = b[0]; d[o + 5] = b[1]; d[o + 6] = b[2]; d[o + 7] = width;
    d[o + 8] = ca[0]; d[o + 9] = ca[1]; d[o + 10] = ca[2]; d[o + 11] = ca[3] ?? 1;
    d[o + 12] = cb[0]; d[o + 13] = cb[1]; d[o + 14] = cb[2]; d[o + 15] = cb[3] ?? 1;
    d[o + 16] = startDist; d[o + 17] = startDist + len(sub(b, a)); d[o + 18] = 0; d[o + 19] = 0;
    this.n++; this.dirty = true;
    return this;
  }

  /** Connected segments through `points` (like three.js `Line`); `closed` joins the last point back to the first (`LineLoop`). */
  polyline(points: ReadonlyArray<Vec3>, color: Color = this.color, width: number = this.width, closed = false): this {
    let dist = 0;                                     // the dash pattern runs on across the joints
    const seg = (a: Vec3, b: Vec3) => { this.gradient(a, b, color, color, width, dist); dist += len(sub(b, a)); };
    for (let i = 0; i + 1 < points.length; i++) seg(points[i], points[i + 1]);
    if (closed && points.length > 2) seg(points[points.length - 1], points[0]);
    return this;
  }

  /** Independent segments from a flat array of points: [a0, b0, a1, b1, ...] as xyz triples (like three.js `LineSegments`). */
  segments(xyz: ArrayLike<number>, color: Color = this.color, width: number = this.width): this {
    for (let i = 0; i + 5 < xyz.length; i += 6) this.line([xyz[i], xyz[i + 1], xyz[i + 2]], [xyz[i + 3], xyz[i + 4], xyz[i + 5]], color, width);
    return this;
  }

  /** The 12 edges of the axis-aligned box [min, max]. */
  box(min: Vec3, max: Vec3, color: Color = this.color, width: number = this.width): this {
    const c = (i: number): Vec3 => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
    for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) this.line(c(a), c(b), color, width);
    return this;
  }

  /** The edges of the box [min, max] after transforming its corners by the column-major matrix `m` (an oriented box). */
  transformedBox(m: ArrayLike<number>, min: Vec3, max: Vec3, color: Color = this.color, width: number = this.width): this {
    const c = (i: number): Vec3 => {
      const x = i & 1 ? max[0] : min[0], y = i & 2 ? max[1] : min[1], z = i & 4 ? max[2] : min[2];
      return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    };
    for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) this.line(c(a), c(b), color, width);
    return this;
  }

  /** A circle of `radius` around `centre` in the plane with the given `normal`. */
  circle(centre: Vec3, normal: Vec3, radius: number, color: Color = this.color, segments = 32, width: number = this.width): this {
    const [u, v] = basisFromNormal(norm(normal));
    const pt = (k: number): Vec3 => {
      const a = (k / segments) * Math.PI * 2, c = Math.cos(a) * radius, s = Math.sin(a) * radius;
      return [centre[0] + u[0] * c + v[0] * s, centre[1] + u[1] * c + v[1] * s, centre[2] + u[2] * c + v[2] * s];
    };
    for (let k = 0; k < segments; k++) this.line(pt(k), pt(k + 1), color, width);
    return this;
  }

  /** Three perpendicular great circles (a wire sphere). */
  sphere(centre: Vec3, radius: number, color: Color = this.color, segments = 32, width: number = this.width): this {
    return this.circle(centre, [1, 0, 0], radius, color, segments, width).circle(centre, [0, 1, 0], radius, color, segments, width).circle(centre, [0, 0, 1], radius, color, segments, width);
  }

  /** A line with an arrow head at `to` (head length `head`, default 15% of the length). */
  arrow(from: Vec3, to: Vec3, color: Color = this.color, head?: number, width: number = this.width): this {
    const d = sub(to, from), l = len(d);
    this.line(from, to, color, width);
    if (l < 1e-9) return this;
    const h = head ?? l * 0.15, u = mul(d, 1 / l);
    const [p, q] = basisFromNormal(u);
    const back = sub(to, mul(u, h)), r = h * 0.4;
    for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      this.line(to, [back[0] + (p[0] * sx + q[0] * sy) * r, back[1] + (p[1] * sx + q[1] * sy) * r, back[2] + (p[2] * sx + q[2] * sy) * r], color, width);
    }
    return this;
  }

  /** Red / green / blue X / Y / Z axes of length `size` from `origin` (like three.js `AxesHelper`). */
  axes(origin: Vec3, size = 1, width: number = this.width): this {
    this.line(origin, [origin[0] + size, origin[1], origin[2]], [1, 0.15, 0.15], width);
    this.line(origin, [origin[0], origin[1] + size, origin[2]], [0.2, 1, 0.2], width);
    this.line(origin, [origin[0], origin[1], origin[2] + size], [0.3, 0.45, 1], width);
    return this;
  }

  /** A grid in the XZ plane at height `y`, `size` wide with `divisions` cells; every `majorEvery`th line (and the centre axes) is brighter. */
  grid(size = 10, divisions = 10, y = 0, color: Color = [0.35, 0.35, 0.35, 1], majorColor: Color = [0.6, 0.6, 0.6, 1], majorEvery = 5, width: number = this.width): this {
    const h = size / 2;
    for (let i = 0; i <= divisions; i++) {
      const t = -h + (i / divisions) * size, major = i % majorEvery === 0 || i === divisions / 2;
      const c = major ? majorColor : color;
      this.line([t, y, -h], [t, y, h], c, width);
      this.line([-h, y, t], [h, y, t], c, width);
    }
    return this;
  }

  /** A small 3D cross at `p` (marks a point). */
  cross(p: Vec3, size = 0.1, color: Color = this.color, width: number = this.width): this {
    this.line([p[0] - size, p[1], p[2]], [p[0] + size, p[1], p[2]], color, width);
    this.line([p[0], p[1] - size, p[2]], [p[0], p[1] + size, p[2]], color, width);
    this.line([p[0], p[1], p[2] - size], [p[0], p[1], p[2] + size], color, width);
    return this;
  }

  /** The 12 edges of a camera frustum given the INVERSE of its view-projection matrix (clip depth 0..1). */
  frustum(invViewProjection: ArrayLike<number>, color: Color = this.color, width: number = this.width): this {
    const m = invViewProjection;
    const c = (i: number): Vec3 => {
      const x = i & 1 ? 1 : -1, y = i & 2 ? 1 : -1, z = i & 4 ? 1 : 0;
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
    };
    for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) this.line(c(a), c(b), color, width);
    return this;
  }
}
