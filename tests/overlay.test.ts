import { describe, expect, it } from 'vitest';
import { makeFakeGPU } from './helpers/fakeGPU';
import { layoutText, type FontMetrics, type GlyphInfo } from '../src/rendering/overlay/Font';
import { LineSystem } from '../src/rendering/overlay/LineSystem';
import { PointSystem } from '../src/rendering/overlay/PointSystem';
import { SpriteSystem, spriteSheetUV } from '../src/rendering/overlay/SpriteSystem';
import type { GPUContext } from '../src/gpu/GPUContext';
import type { BindLayouts } from '../src/gpu/BindLayouts';
import type { TextureRef } from '../src/rendering/materials/Material';

/** A monospace test font: every glyph is 10 px wide (advance 10), 16 px tall, on a 16 px line; size 16 px per em. */
function testFont(): FontMetrics {
  const glyphs = new Map<number, GlyphInfo>();
  for (let c = 32; c < 127; c++) {
    glyphs.set(c, { u0: c / 200, v0: 0, u1: (c + 1) / 200, v1: 1, width: 10, height: 16, xOffset: 0, yOffset: 0, advance: 10 });
  }
  return { size: 16, lineHeight: 16, glyphs, fallback: glyphs.get(63) };
}

describe('layoutText', () => {
  const font = testFont();

  it('places glyphs left to right in em units, skipping spaces', () => {
    const l = layoutText(font, 'ab c', { size: 16 });                 // size 16 = 1 px per font px
    expect(l.quads.map((q) => String.fromCodePoint(q.code))).toEqual(['a', 'b', 'c']);
    expect(l.quads.map((q) => q.x)).toEqual([0, 10, 30]);
    expect(l.width).toBe(40);
    expect(l.height).toBe(16);
    expect(l.lines).toBe(1);
    expect(l.quads[0]).toMatchObject({ y: 0, width: 10, height: 16 });
  });

  it('scales with the requested size', () => {
    const a = layoutText(font, 'hello', { size: 16 }), b = layoutText(font, 'hello', { size: 0.5 });
    expect(b.width).toBeCloseTo(a.width * 0.5 / 16, 9);
    expect(b.height).toBeCloseTo(0.5, 9);
  });

  it('handles newlines, line spacing and alignment', () => {
    const l = layoutText(font, 'ab\nabcd\nx', { size: 16, lineSpacing: 1.5 });
    expect(l.lines).toBe(3);
    expect(l.width).toBe(40);
    expect(l.height).toBe(16 * 1.5 * 3);
    const second = l.quads.filter((q) => Math.abs(q.y - 24) < 1e-9);
    expect(second.length).toBe(4);

    const centre = layoutText(font, 'ab\nabcd', { size: 16, align: 'center' });
    expect(centre.quads[0].x).toBe(10);                               // 'ab' (20 wide) centred in 40
    const right = layoutText(font, 'ab\nabcd', { size: 16, align: 'right' });
    expect(right.quads[0].x).toBe(20);
    expect(layoutText(font, 'ab\nabcd', { size: 16 }).quads[0].x).toBe(0);
  });

  it('wraps at word boundaries and keeps over-long words whole', () => {
    const l = layoutText(font, 'aa bb cc', { size: 16, maxWidth: 50 });
    expect(l.lines).toBe(2);                                          // 'aa bb' = 50 fits, 'cc' wraps
    expect(l.quads.filter((q) => q.y === 0).length).toBe(4);
    expect(layoutText(font, 'abcdefghij', { size: 16, maxWidth: 30 }).lines).toBe(1);
    expect(layoutText(font, 'a b c d', { size: 16, maxWidth: 25 }).lines).toBe(4);
  });

  it('uses the fallback glyph for unknown characters and tolerates empty text', () => {
    const l = layoutText(font, '中', { size: 16 });
    expect(l.quads.length).toBe(1);
    expect(l.quads[0].u0).toBeCloseTo(63 / 200, 9);                   // '?'
    const e = layoutText(font, '', { size: 16 });
    expect(e.quads).toEqual([]);
    expect(e.lines).toBe(1);
    expect(layoutText(font, 'a  ', { size: 16, align: 'right' }).width).toBe(10);   // trailing spaces do not count
  });
});

/** Stubs: a GPUContext over the recording fake device, bind layouts, a texture. */
function setup() {
  const g = makeFakeGPU();
  const dev = g.device as unknown as Record<string, unknown>;
  dev.createBindGroupLayout = () => ({});
  dev.createPipelineLayout = () => ({});
  const gpu = { device: g.device, resources: g.res, format: 'bgra8unorm', queue: g.device.queue } as unknown as GPUContext;
  const layouts = { frame: {} } as unknown as BindLayouts;
  const target = { colorFormat: 'rgba16float' as GPUTextureFormat, depthFormat: 'depth24plus' as GPUTextureFormat, sampleCount: 1 };
  const texture: TextureRef = { id: 't', view: {} as GPUTextureView };
  return { gpu, layouts, target, texture, writes: g.writes };
}

describe('LineSystem', () => {
  it('stores segments with width and colours and counts them', () => {
    const { gpu, layouts, target } = setup();
    const ls = new LineSystem(gpu, layouts, target, { width: 3, color: [1, 0, 0, 1] });
    ls.line([0, 0, 0], [1, 2, 3]);
    expect(ls.count).toBe(1);
    ls.gradient([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1, 0.5], 7);
    expect(ls.count).toBe(2);
    ls.clear();
    expect(ls.count).toBe(0);
  });

  it('helpers add the expected number of segments', () => {
    const { gpu, layouts, target } = setup();
    const ls = new LineSystem(gpu, layouts, target);
    const count = (fn: () => void) => { ls.clear(); fn(); return ls.count; };
    expect(count(() => ls.box([0, 0, 0], [1, 1, 1]))).toBe(12);
    expect(count(() => ls.transformedBox(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1]), [0, 0, 0], [1, 1, 1]))).toBe(12);
    expect(count(() => ls.circle([0, 0, 0], [0, 1, 0], 1, undefined, 20))).toBe(20);
    expect(count(() => ls.sphere([0, 0, 0], 1, undefined, 16))).toBe(48);
    expect(count(() => ls.arrow([0, 0, 0], [0, 2, 0]))).toBe(5);
    expect(count(() => ls.arrow([1, 1, 1], [1, 1, 1]))).toBe(1);        // zero length: no head
    expect(count(() => ls.axes([0, 0, 0]))).toBe(3);
    expect(count(() => ls.cross([0, 0, 0]))).toBe(3);
    expect(count(() => ls.grid(10, 10))).toBe(22);
    expect(count(() => ls.polyline([[0, 0, 0], [1, 0, 0], [1, 1, 0]]))).toBe(2);
    expect(count(() => ls.polyline([[0, 0, 0], [1, 0, 0], [1, 1, 0]], undefined, undefined, true))).toBe(3);
    expect(count(() => ls.segments([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]))).toBe(2);
    const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(count(() => ls.frustum(identity))).toBe(12);
  });

  it('a circle lies on its plane at the given radius', () => {
    const { gpu, layouts, target } = setup();
    const ls = new LineSystem(gpu, layouts, target);
    ls.circle([1, 2, 3], [0, 0, 1], 2, undefined, 16);
    const d = (ls as unknown as { store: { data: Float32Array } }).store.data;
    for (let i = 0; i < 16; i++) {
      const o = i * 16;
      expect(d[o + 2]).toBeCloseTo(3, 5);                              // stays in the z = 3 plane
      expect(Math.hypot(d[o] - 1, d[o + 1] - 2)).toBeCloseTo(2, 5);
    }
  });

  it('grows past its initial capacity without losing data', () => {
    const { gpu, layouts, target } = setup();
    const ls = new LineSystem(gpu, layouts, target, { maxSegments: 4 });
    for (let i = 0; i < 100; i++) ls.line([i, 0, 0], [i, 1, 0]);
    expect(ls.count).toBe(100);
    const d = (ls as unknown as { store: { data: Float32Array } }).store.data;
    expect(d[0]).toBe(0); expect(d[99 * 16]).toBe(99);
  });

  it('uploads only when something changed', () => {
    const { gpu, layouts, target, writes } = setup();
    const ls = new LineSystem(gpu, layouts, target, { name: 'ln' });
    ls.line([0, 0, 0], [1, 1, 1]);
    const before = writes.length;
    ls.flush();
    expect(writes.length).toBe(before + 1);
    expect(writes[writes.length - 1].label).toBe('ln:segments');
    ls.flush();
    expect(writes.length).toBe(before + 1);                             // clean: nothing to send
  });
});

describe('PointSystem', () => {
  it('adds, bulk-adds and overwrites points', () => {
    const { gpu, layouts, target } = setup();
    const ps = new PointSystem(gpu, layouts, target, { size: 6, color: [0, 1, 0, 1] });
    expect(ps.add([1, 2, 3])).toBe(0);
    ps.addMany([0, 0, 0, 1, 1, 1, 2, 2, 2], [1, 0, 0, 1], 9);
    expect(ps.count).toBe(4);
    ps.setAt(0, [7, 8, 9], [0, 0, 1], 2);
    const d = (ps as unknown as { store: { data: Float32Array } }).store.data;
    expect(Array.from(d.slice(0, 8))).toEqual([7, 8, 9, 2, 0, 0, 1, 1]);
    expect(Array.from(d.slice(8, 16))).toEqual([0, 0, 0, 9, 1, 0, 0, 1]);
    expect(() => ps.setAt(10, [0, 0, 0])).toThrow(RangeError);
    ps.clear();
    expect(ps.count).toBe(0);
  });
});

describe('SpriteSystem and text', () => {
  it('adds, updates and removes sprites, reusing freed slots', () => {
    const { gpu, layouts, target, texture } = setup();
    const ss = new SpriteSystem(gpu, layouts, target, { texture });
    const a = ss.add({ position: [1, 2, 3], size: 2, color: [1, 0, 0, 1] });
    const b = ss.add({ position: [4, 5, 6] });
    expect([a, b, ss.count]).toEqual([0, 1, 2]);
    ss.set(a, { position: [9, 9, 9], rotation: 0.5, mode: 'axis-y' });
    const d = (ss as unknown as { store: { data: Float32Array } }).store.data;
    expect(Array.from(d.slice(0, 4))).toEqual([9, 9, 9, 0.5]);
    expect(d[19]).toBe(1);                                              // mode axis-y
    ss.remove(a);
    expect(ss.count).toBe(1);
    expect(d[4]).toBe(0);                                               // size 0: the shader skips it
    expect(ss.add({ position: [0, 0, 0] })).toBe(a);                    // slot reused
    expect(() => ss.set(99, {})).toThrow(RangeError);
    ss.remove(99);                                                      // removing a missing id is a no-op
    ss.clear();
    expect(ss.count).toBe(0);
  });

  it('screen-space sprites default to no depth test, world sprites to depth test', () => {
    const { gpu, layouts, target, texture } = setup();
    expect(new SpriteSystem(gpu, layouts, target, { texture, space: 'screen' }).depthTest).toBe(false);
    expect(new SpriteSystem(gpu, layouts, target, { texture }).depthTest).toBe(true);
  });

  it('text becomes one glyph sprite per visible character, anchored and updatable', () => {
    const { gpu, layouts, target, texture } = setup();
    const font = testFont();
    const ss = new SpriteSystem(gpu, layouts, target, { texture });
    const t = ss.addText(font, 'Hi there', { position: [0, 5, 0], size: 16, anchor: [0, 0] });
    expect(ss.count).toBe(7);                                           // the space makes no sprite
    expect(t.width).toBe(80);
    const d = (ss as unknown as { store: { data: Float32Array } }).store.data;
    expect(Array.from(d.slice(24, 26))).toEqual([0, -0]);               // first glyph: offset from the anchor, y up (text y is down)
    expect(d[6]).toBe(0); expect(d[7]).toBe(1);                         // pivot: top-left

    const centred = ss.addText(font, 'ab', { position: [0, 0, 0], size: 16 });   // default world anchor: centre
    const o = (centred.ids[0]) * 28;
    expect(d[o + 24]).toBe(-10);                                         // block 20 wide: first glyph starts 10 left of the centre
    expect(d[o + 25]).toBeCloseTo(8, 9);                                 // block 16 tall: top is 8 above the centre

    t.setText('abc');
    expect(ss.count).toBe(3 + 2);
    t.setColor([1, 0, 0, 1]);
    expect(d[t.ids[0] * 28 + 12]).toBe(1); expect(d[t.ids[0] * 28 + 13]).toBe(0);
    t.setPosition([7, 8, 9]);
    expect(Array.from(d.slice(t.ids[1] * 28, t.ids[1] * 28 + 3))).toEqual([7, 8, 9]);
    t.remove();
    t.remove();
    expect(ss.count).toBe(2);
    t.setText('zzz');                                                  // a removed handle stays removed
    expect(ss.count).toBe(2);
  });

  it('spriteSheetUV addresses cells with row 0 at the top', () => {
    expect(spriteSheetUV(0, 0, 4, 2)).toEqual([0, 0, 0.25, 0.5]);
    expect(spriteSheetUV(3, 1, 4, 2)).toEqual([0.75, 0.5, 1, 1]);
  });
});
