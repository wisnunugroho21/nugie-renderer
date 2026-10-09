import type { TextureLoader } from '../../assets/TextureLoader';
import type { TextureRef } from '../materials/Material';

/** One glyph of a font atlas. Sizes are in atlas pixels; the layout divides them by `Font.size` to get em units. */
export interface GlyphInfo {
  /** Atlas rectangle (uv, v = 0 at the top). */
  u0: number; v0: number; u1: number; v1: number;
  /** Rectangle size in pixels (including the padding that keeps neighbours from bleeding in). */
  width: number; height: number;
  /** Offset of the rectangle's top-left from the pen position on the baseline (x right, y DOWN from the line top), in pixels. */
  xOffset: number; yOffset: number;
  /** Horizontal advance in pixels. */
  advance: number;
}

/** What text layout needs from a font, independent of how the atlas was made (so it can be tested without a canvas). */
export interface FontMetrics {
  /** Font size the atlas was rendered at (pixels per em). */
  size: number;
  /** Distance between baselines in pixels. */
  lineHeight: number;
  glyphs: ReadonlyMap<number, GlyphInfo>;
  /** Glyph used for characters the atlas lacks (usually '?'). */
  fallback?: GlyphInfo;
}

/** A positioned glyph in text space: units of `size`, origin at the top-left of the text block, y DOWN. */
export interface GlyphQuad {
  x: number; y: number; width: number; height: number;
  u0: number; v0: number; u1: number; v1: number;
  /** The character's code point. */
  code: number;
}

export interface TextLayoutOptions {
  /** Height of one em in output units (default 1): `size` of 0.2 gives 0.2-unit-tall capital letters, roughly. */
  size?: number;
  align?: 'left' | 'center' | 'right';
  /** Wrap lines wider than this (output units); words longer than a line are kept whole. */
  maxWidth?: number;
  /** Baseline distance as a multiple of the font's own line height (default 1). */
  lineSpacing?: number;
}

export interface TextLayout {
  quads: GlyphQuad[];
  /** Size of the laid-out block (output units). */
  width: number;
  height: number;
  lines: number;
}

/**
 * Lay a string out with a font: glyph quads in text space (origin top-left, y down, units of `size`). Handles `\n`, optional word wrap
 * and left / centre / right alignment. No kerning or complex scripts. Pure function: no GPU or canvas needed.
 */
export function layoutText(font: FontMetrics, text: string, o: TextLayoutOptions = {}): TextLayout {
  const size = o.size ?? 1, k = size / font.size;
  const lineAdvance = font.lineHeight * k * (o.lineSpacing ?? 1);
  const maxWidth = o.maxWidth ?? Infinity;
  const glyphOf = (code: number): GlyphInfo | undefined => font.glyphs.get(code) ?? font.fallback;

  interface Line { glyphs: { code: number; g: GlyphInfo; pen: number }[]; width: number }
  const lines: Line[] = [];
  let cur: Line = { glyphs: [], width: 0 };
  const pushLine = () => { lines.push(cur); cur = { glyphs: [], width: 0 }; };

  for (const para of text.split('\n')) {
    // words (with their trailing space) are the wrap unit
    for (const word of para.match(/\S+\s*|\s+/g) ?? []) {
      const chars = Array.from(word).map((ch) => ch.codePointAt(0)!);
      const visible = Array.from(word.replace(/\s+$/, '')).length;      // trailing spaces may hang past the wrap width
      let wTrim = 0;
      chars.forEach((c, i) => { if (i < visible) wTrim += (glyphOf(c)?.advance ?? 0) * k; });
      if (cur.glyphs.length > 0 && cur.width + wTrim > maxWidth) pushLine();
      for (const c of chars) {
        const g = glyphOf(c);
        if (!g) continue;
        cur.glyphs.push({ code: c, g, pen: cur.width });
        cur.width += g.advance * k;
      }
    }
    pushLine();
  }

  const quads: GlyphQuad[] = [];
  let blockW = 0;
  for (const l of lines) {
    // trailing spaces do not count towards alignment
    let trail = 0;
    for (let i = l.glyphs.length - 1; i >= 0 && l.glyphs[i].code === 32; i--) trail += l.glyphs[i].g.advance * k;
    blockW = Math.max(blockW, l.width - trail);
  }
  lines.forEach((l, li) => {
    let trail = 0;
    for (let i = l.glyphs.length - 1; i >= 0 && l.glyphs[i].code === 32; i--) trail += l.glyphs[i].g.advance * k;
    const lw = l.width - trail;
    const shift = o.align === 'center' ? (blockW - lw) / 2 : o.align === 'right' ? blockW - lw : 0;
    for (const { code, g, pen } of l.glyphs) {
      if (code === 32 || g.width <= 0) continue;
      quads.push({
        x: shift + pen + g.xOffset * k, y: li * lineAdvance + g.yOffset * k, width: g.width * k, height: g.height * k,
        u0: g.u0, v0: g.v0, u1: g.u1, v1: g.v1, code,
      });
    }
  });
  return { quads, width: blockW, height: lines.length * lineAdvance, lines: lines.length };
}

/** A rasterised font: the atlas texture plus metrics. Create with {@link createFont}. */
export interface Font extends FontMetrics {
  texture: TextureRef;
  family: string;
}

export interface FontOptions {
  /** CSS font family, e.g. 'sans-serif', 'monospace', 'Georgia' (must be loaded already for web fonts). */
  family?: string;
  /** CSS weight: 'normal', 'bold', 600 ... */
  weight?: string | number;
  style?: 'normal' | 'italic';
  /** Rasterisation size in pixels per em (default 64): larger is sharper when text is drawn big. */
  size?: number;
  /** Characters to include (default: printable ASCII + Latin-1 supplement). */
  chars?: string;
  /** Pixels of transparent border around each glyph (default 4; mipmapping needs some). */
  padding?: number;
}

/** Printable ASCII and the Latin-1 supplement. */
export const DEFAULT_CHARS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('')
  + Array.from({ length: 96 }, (_, i) => String.fromCharCode(160 + i)).join('');

/**
 * Rasterise a system font into a glyph atlas with the browser's canvas (alpha-only white glyphs on transparent: tint them with the
 * sprite colour) and upload it. Needs a browser (OffscreenCanvas or `document`).
 */
export async function createFont(textures: TextureLoader, o: FontOptions = {}): Promise<Font> {
  const size = Math.max(8, Math.round(o.size ?? 64)), pad = o.padding ?? 4, family = o.family ?? 'sans-serif';
  const chars = Array.from(new Set(Array.from(o.chars ?? DEFAULT_CHARS))).map((c) => c.codePointAt(0)!);
  if (!chars.includes(63)) chars.push(63);
  const css = `${o.style ?? 'normal'} ${o.weight ?? 'normal'} ${size}px ${family}`;

  const make = (w: number, h: number): OffscreenCanvas | HTMLCanvasElement => {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  };
  const probe = make(8, 8).getContext('2d') as CanvasRenderingContext2D;
  probe.font = css; probe.textBaseline = 'alphabetic';
  const ref = probe.measureText('Hg');
  const ascent = Math.ceil(ref.fontBoundingBoxAscent ?? size * 0.9), descent = Math.ceil(ref.fontBoundingBoxDescent ?? size * 0.25);
  const lineHeight = ascent + descent;

  // measure, then shelf-pack into the smallest power-of-two atlas that fits
  interface Cell { code: number; advance: number; left: number; w: number; x: number; y: number }
  const cells: Cell[] = chars.map((code) => {
    const m = probe.measureText(String.fromCodePoint(code));
    const left = Math.floor(m.actualBoundingBoxLeft ?? 0), right = Math.ceil(m.actualBoundingBoxRight ?? m.width);
    return { code, advance: m.width, left, w: Math.max(1, left + right) + 2 * pad, x: 0, y: 0 };
  });
  const rowH = lineHeight + 2 * pad;
  let atlas = 256;
  const pack = (width: number): number => {
    let x = 0, y = 0;
    for (const c of cells) {
      if (x + c.w > width) { x = 0; y += rowH; }
      c.x = x; c.y = y; x += c.w;
    }
    return y + rowH;
  };
  while (pack(atlas) > atlas && atlas < 4096) atlas *= 2;

  const canvas = make(atlas, atlas);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, atlas, atlas);
  ctx.font = css; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#ffffff';
  const glyphs = new Map<number, GlyphInfo>();
  for (const c of cells) {
    ctx.fillText(String.fromCodePoint(c.code), c.x + pad + c.left, c.y + pad + ascent);
    glyphs.set(c.code, {
      u0: c.x / atlas, v0: c.y / atlas, u1: (c.x + c.w) / atlas, v1: (c.y + rowH) / atlas,
      width: c.w, height: rowH, xOffset: -c.left - pad, yOffset: -pad, advance: c.advance,
    });
  }
  const id = `font:${family}:${o.weight ?? 'normal'}:${size}:${atlas}:${chars.length}`;
  const bitmap = await createImageBitmap(canvas as unknown as ImageBitmapSource, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const texture = textures.upload(id, bitmap, false);
  return { size, lineHeight, glyphs, fallback: glyphs.get(63), texture, family };
}
