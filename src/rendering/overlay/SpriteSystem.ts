import type { GPUContext } from '../../gpu/GPUContext';
import type { BindLayouts } from '../../gpu/BindLayouts';
import type { TextureRef } from '../materials/Material';
import { SPRITES_SOURCE, registerEngineShaderChunks } from '../../shaders';
import { StorageArray, type Overlay, type OverlayTarget, type Color, type Vec3 } from './Overlay';
import { layoutText, type FontMetrics, type TextLayoutOptions } from './Font';

export interface SpriteSystemOptions {
  /** Texture shown by every sprite of the system (an image, an atlas, or a font's `texture`). */
  texture: TextureRef;
  /** 'world': positions are world coordinates. 'screen': positions are canvas pixels from the TOP-LEFT (z = depth, 0 = nearest) for HUDs. */
  space?: 'world' | 'screen';
  /** World space only: sizes in 'world' units (shrink with distance) or constant 'pixels' (icons, labels; always faces the camera). */
  sizeUnit?: 'world' | 'pixels';
  /** Hide sprites behind geometry. Default true for world sprites, false for screen sprites. */
  depthTest?: boolean;
  blend?: 'alpha' | 'additive' | 'premultiplied';
  sampler?: GPUSamplerDescriptor;
  /** Initial capacity (grows automatically). */
  maxSprites?: number;
  /** Clear after every frame (immediate mode). */
  autoClear?: boolean;
  name?: string;
}

export interface SpriteDesc {
  /** World position (or canvas pixels + depth in screen space). */
  position: Vec3;
  /** Width / height (a number is a square). Default 1. */
  size?: number | readonly [number, number];
  /** Rotation in radians about the view axis (billboards) or the sprite's normal (fixed). */
  rotation?: number;
  color?: Color;
  /** Texture rectangle [u0, v0, u1, v1], v = 0 at the image top (default: the whole texture). */
  uv?: readonly [number, number, number, number];
  /** Which point of the sprite sits at `position`, 0..1 from the bottom-left (default centre [0.5, 0.5]). */
  pivot?: readonly [number, number];
  /** 'camera' (default) faces the camera, 'axis-y' turns about the vertical axis only (trees, characters' labels), 'fixed' lies in the plane of `right` / `up`. */
  mode?: 'camera' | 'axis-y' | 'fixed';
  right?: Vec3;
  up?: Vec3;
  /** Extra offset in the sprite plane (same units as `size`); used by text layout. */
  offset?: readonly [number, number];
}

export interface TextOptions extends TextLayoutOptions {
  position: Vec3;
  color?: Color;
  /** Which point of the text block sits at `position`: [0, 0] top-left, [0.5, 0.5] centre, [1, 1] bottom-right. Default: centre (world), top-left (screen). */
  anchor?: readonly [number, number];
  rotation?: number;
  mode?: 'camera' | 'axis-y' | 'fixed';
  /** For mode 'fixed': the text's reading direction and up direction (default +X / +Y). */
  right?: Vec3;
  up?: Vec3;
}

const SPRITE_FLOATS = 28;   // posRot, size(w, h, pivotX, pivotY), uv, color, right(xyz, mode), up(xyz), offset(x, y)
const MODE: Record<NonNullable<SpriteDesc['mode']>, number> = { camera: 0, 'axis-y': 1, fixed: 2 };

/**
 * Textured quads (three.js `Sprite`) and, through {@link addText}, text rendered from a font atlas. Sprites are retained: `add`
 * returns an id for `set` / `remove`. One system draws ONE texture in one draw call; make one system per texture / font.
 * Sprites and glyphs are alpha blended and drawn after the scene (sorted only by creation order, so overlapping transparent sprites
 * should be added back to front).
 */
export class SpriteSystem implements Overlay {
  autoClear: boolean;
  visible = true;
  readonly space: 'world' | 'screen';
  readonly sizeUnit: 'world' | 'pixels';
  readonly depthTest: boolean;
  texture: TextureRef;
  private blend: 'alpha' | 'additive' | 'premultiplied';
  private store: StorageArray;
  private high = 0;                       // slots in use (including freed holes)
  private alive = 0;
  private free: number[] = [];
  private liveSet = new Set<number>();
  private dirty = false;
  private layout: GPUBindGroupLayout;
  private params: GPUBuffer;
  private sampler: GPUSampler;
  private bindGroup: GPUBindGroup | null = null;
  private bindGen = -1;
  private boundView: GPUTextureView | null = null;
  private pipeline!: GPURenderPipeline;
  private layouts: BindLayouts;

  constructor(private gpu: GPUContext, layouts: BindLayouts, private target: OverlayTarget, o: SpriteSystemOptions) {
    registerEngineShaderChunks(gpu.resources.shaders);
    this.layouts = layouts;
    this.texture = o.texture;
    this.space = o.space ?? 'world';
    this.sizeUnit = o.sizeUnit ?? 'world';
    this.depthTest = o.depthTest ?? this.space === 'world';
    this.blend = o.blend ?? 'alpha';
    this.autoClear = o.autoClear ?? false;
    this.store = new StorageArray(gpu, `${o.name ?? 'sprites'}:sprites`, SPRITE_FLOATS, o.maxSprites ?? 1024);
    const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    this.layout = gpu.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: V, buffer: { type: 'uniform' } },
      { binding: 2, visibility: F, sampler: { type: 'filtering' } },
      { binding: 3, visibility: F, texture: { sampleType: 'float' } },
    ] });
    this.params = gpu.resources.buffers.create(`${o.name ?? 'sprites'}:params`, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    gpu.queue.writeBuffer(this.params, 0, new Float32Array([this.space === 'screen' ? 1 : 0, this.sizeUnit === 'pixels' ? 1 : 0, 0, 0]));
    this.sampler = gpu.resources.samplers.get(o.sampler ?? { magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.retarget();
  }

  /** Number of live sprites. */
  get count(): number { return this.alive; }

  retarget(): void {
    const { device, resources: r } = this.gpu, t = this.target, depthTest = this.depthTest, mode = this.blend;
    const blend: GPUBlendState = mode === 'additive'
      ? { color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } }
      : mode === 'premultiplied'
        ? { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } }
        : { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    this.pipeline = r.pipelines.getRender({
      shader: 'sprites', vertexEntry: 'vs_main', fragmentEntry: 'fs_main', vertexLayout: [], topology: 'triangle-list', cullMode: 'none',
      depth: { format: t.depthFormat, write: false, compare: depthTest ? 'less-equal' : 'always' },
      targets: [{ format: t.colorFormat, blend }], sampleCount: t.sampleCount, layout: `sprites-${depthTest}-${mode}`,
    }, () => {
      const module = r.shaders.get('sprites', SPRITES_SOURCE);
      return device.createRenderPipeline({
        label: `sprites-${depthTest}-${mode}`, layout: device.createPipelineLayout({ bindGroupLayouts: [this.layouts.frame, this.layout] }),
        vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_main', targets: [{ format: t.colorFormat, blend }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: t.depthFormat, depthWriteEnabled: false, depthCompare: depthTest ? 'less-equal' : 'always' },
        multisample: { count: t.sampleCount },
      });
    });
  }

  clear(): void {
    if (this.high !== 0) { this.high = 0; this.alive = 0; this.free.length = 0; this.liveSet.clear(); this.dirty = true; }
  }

  flush(): void {
    if (this.dirty) { this.store.upload(this.high); this.dirty = false; }
  }

  encodeDraw(pass: GPURenderPassEncoder, frameBG: GPUBindGroup): void {
    if (!this.visible || this.high === 0 || !this.texture.view) return;
    if (!this.bindGroup || this.bindGen !== this.store.generation || this.boundView !== this.texture.view) {
      this.bindGroup = this.gpu.device.createBindGroup({ label: 'sprites', layout: this.layout, entries: [
        { binding: 0, resource: { buffer: this.store.buffer } }, { binding: 1, resource: { buffer: this.params } },
        { binding: 2, resource: this.sampler }, { binding: 3, resource: this.texture.view },
      ] });
      this.bindGen = this.store.generation;
      this.boundView = this.texture.view;
      this.dirty = true;
      this.flush();
    }
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameBG);
    pass.setBindGroup(1, this.bindGroup);
    pass.draw(6, this.high);
  }

  // ---- sprites ---------------------------------------------------------------------------------------------------------------------

  /** Add a sprite; returns its id. */
  add(d: SpriteDesc): number {
    let id: number;
    if (this.free.length > 0) id = this.free.pop()!;
    else { this.store.ensure(this.high + 1); id = this.high++; }
    this.alive++;
    this.write(id, d);
    return id;
  }

  /** Change some properties of sprite `id` (the rest are kept). */
  set(id: number, d: Partial<SpriteDesc>): void {
    const o = id * SPRITE_FLOATS, f = this.store.data;
    if (!this.liveSet.has(id)) throw new RangeError(`SpriteSystem.set: sprite ${id} does not exist`);
    if (d.position) { f[o] = d.position[0]; f[o + 1] = d.position[1]; f[o + 2] = d.position[2]; }
    if (d.rotation !== undefined) f[o + 3] = d.rotation;
    if (d.size !== undefined) { const s = typeof d.size === 'number' ? [d.size, d.size] as const : d.size; f[o + 4] = s[0]; f[o + 5] = s[1]; }
    if (d.pivot) { f[o + 6] = d.pivot[0]; f[o + 7] = d.pivot[1]; }
    if (d.uv) { f[o + 8] = d.uv[0]; f[o + 9] = d.uv[1]; f[o + 10] = d.uv[2]; f[o + 11] = d.uv[3]; }
    if (d.color) { f[o + 12] = d.color[0]; f[o + 13] = d.color[1]; f[o + 14] = d.color[2]; f[o + 15] = d.color[3] ?? 1; }
    if (d.mode !== undefined) f[o + 19] = MODE[d.mode];
    if (d.right) { f[o + 16] = d.right[0]; f[o + 17] = d.right[1]; f[o + 18] = d.right[2]; }
    if (d.up) { f[o + 20] = d.up[0]; f[o + 21] = d.up[1]; f[o + 22] = d.up[2]; }
    if (d.offset) { f[o + 24] = d.offset[0]; f[o + 25] = d.offset[1]; }
    this.dirty = true;
  }

  /** Remove sprite `id` (its slot is reused by a later `add`). */
  remove(id: number): void {
    if (!this.liveSet.delete(id)) return;
    const o = id * SPRITE_FLOATS;
    this.store.data.fill(0, o, o + SPRITE_FLOATS);          // size 0 / alpha 0: the shader drops it
    this.free.push(id);
    this.alive--;
    this.dirty = true;
  }

  private write(id: number, d: SpriteDesc): void {
    const f = this.store.data, o = id * SPRITE_FLOATS;
    const s = d.size === undefined ? [1, 1] as const : typeof d.size === 'number' ? [d.size, d.size] as const : d.size;
    const p = d.pivot ?? [0.5, 0.5], uv = d.uv ?? [0, 0, 1, 1], c = d.color ?? [1, 1, 1, 1], r = d.right ?? [1, 0, 0], u = d.up ?? [0, 1, 0], off = d.offset ?? [0, 0];
    f.set([d.position[0], d.position[1], d.position[2], d.rotation ?? 0, s[0], s[1], p[0], p[1], uv[0], uv[1], uv[2], uv[3],
      c[0], c[1], c[2], c[3] ?? 1, r[0], r[1], r[2], MODE[d.mode ?? 'camera'], u[0], u[1], u[2], 0, off[0], off[1], 0, 0], o);
    this.liveSet.add(id);
    this.dirty = true;
  }

  // ---- text ------------------------------------------------------------------------------------------------------------------------

  /**
   * Add text rendered with `font` (whose `texture` must be this system's texture). Returns a handle to move, recolour, change or remove
   * it. Glyph size: `size` is the em height in world units (or pixels for 'pixels' / 'screen' systems).
   */
  addText(font: FontMetrics, text: string, o: TextOptions): TextHandle {
    return new TextHandle(this, font, text, o);
  }

  /** @internal Add one glyph sprite of a text. */
  addGlyph(d: SpriteDesc): number { return this.add(d); }
}

/** A string drawn as glyph sprites; created by {@link SpriteSystem.addText}. */
export class TextHandle {
  /** Ids of the glyph sprites. */
  ids: number[] = [];
  /** Size of the laid-out block (same units as `options.size`). */
  width = 0;
  height = 0;
  private removed = false;

  constructor(private system: SpriteSystem, private font: FontMetrics, public text: string, public options: TextOptions) {
    this.build();
  }

  private build(): void {
    const sys = this.system, o = this.options;
    for (const id of this.ids) sys.remove(id);
    this.ids = [];
    const layout = layoutText(this.font, this.text, o);
    this.width = layout.width; this.height = layout.height;
    const anchor = o.anchor ?? (sys.space === 'screen' ? [0, 0] : [0.5, 0.5]);
    const ax = anchor[0] * layout.width, ay = anchor[1] * layout.height;
    const color = o.color ?? [1, 1, 1, 1];
    for (const q of layout.quads) {
      this.ids.push(sys.addGlyph({
        position: o.position, size: [q.width, q.height], pivot: [0, 1], uv: [q.u0, q.v0, q.u1, q.v1], color,
        rotation: o.rotation, mode: o.mode, right: o.right, up: o.up,
        offset: [q.x - ax, -(q.y - ay)],                 // text space is y-down, sprite planes are y-up
      }));
    }
  }

  /** Replace the string (re-lays it out). */
  setText(text: string): this { if (!this.removed && text !== this.text) { this.text = text; this.build(); } return this; }

  /** Change layout options (position, colour, size, alignment ...). */
  update(o: Partial<TextOptions>): this {
    if (this.removed) return this;
    Object.assign(this.options, o);
    this.build();
    return this;
  }

  /** Recolour without re-laying out. */
  setColor(c: Color): this {
    this.options.color = c;
    for (const id of this.ids) this.system.set(id, { color: c });
    return this;
  }

  /** Move the whole text without re-laying out. */
  setPosition(p: Vec3): this {
    this.options.position = p;
    for (const id of this.ids) this.system.set(id, { position: p });
    return this;
  }

  /** Remove the text from the system. */
  remove(): void {
    if (this.removed) return;
    this.removed = true;
    for (const id of this.ids) this.system.remove(id);
    this.ids = [];
  }
}

/** Texture region helper: the uv rectangle of cell (`col`, `row`) in a `cols` x `rows` sprite sheet (row 0 at the top). */
export function spriteSheetUV(col: number, row: number, cols: number, rows: number): [number, number, number, number] {
  return [col / cols, row / rows, (col + 1) / cols, (row + 1) / rows];
}
