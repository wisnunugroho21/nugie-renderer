/**
 * Texture streaming policy (pure logic, no GPU): decides which mip levels of each streamed texture should be resident.
 *
 * Every texture is described by its size and mip count. `resident` is the first (finest) mip level that is in GPU memory:
 * 0 = fully resident, mipCount-1 = only the smallest mip. Each frame the renderer reports how many pixels a texture can cover on
 * screen (`touch`); `plan` turns that into a list of level changes that respects a memory budget and an upload budget.
 */
export interface StreamEntry {
  id: number;
  width: number;
  height: number;
  mipCount: number;
  bytesPerTexel: number;
  /** Finest resident mip level. */
  resident: number;
  /** Largest on-screen pixel extent reported this frame (0 = not visible). */
  pixels: number;
  lastTouchFrame: number;
  /** Frames the entry has wanted a coarser level than it has (for downgrade hysteresis). */
  wantsCoarserFor: number;
}

export interface StreamConfig {
  /** GPU bytes available to streamed textures. */
  budgetBytes: number;
  /** Maximum bytes of NEW mip data uploaded per frame. */
  uploadBytesPerFrame: number;
  /** The coarsest level untouched textures fall back to (kept resident so nothing ever pops to black). */
  floorLevel: number;
  /** Frames a texture must want a coarser level before it is downgraded (when not over budget). */
  downgradeDelay: number;
  /** Extra mip bias: positive = lower quality / less memory. */
  bias: number;
}

export const DEFAULT_STREAM_CONFIG: StreamConfig = { budgetBytes: 256 * 1024 * 1024, uploadBytesPerFrame: 8 * 1024 * 1024, floorLevel: 4, downgradeDelay: 30, bias: 0 };

export interface StreamChange { id: number; from: number; to: number; }

export function mipBytes(e: Pick<StreamEntry, 'width' | 'height' | 'bytesPerTexel'>, level: number): number {
  return Math.max(1, e.width >> level) * Math.max(1, e.height >> level) * e.bytesPerTexel;
}

/** Bytes needed to keep levels [base, mipCount) resident. */
export function residentBytes(e: Pick<StreamEntry, 'width' | 'height' | 'bytesPerTexel' | 'mipCount'>, base: number): number {
  let b = 0;
  for (let l = base; l < e.mipCount; l++) b += mipBytes(e, l);
  return b;
}

/** Finest mip level worth having when the texture spans `pixels` screen pixels (mip chosen so a texel ~ a pixel). */
export function desiredLevel(e: Pick<StreamEntry, 'width' | 'height' | 'mipCount'>, pixels: number, bias: number, floorLevel: number): number {
  if (pixels <= 0) return Math.min(floorLevel, e.mipCount - 1);
  const extent = Math.max(e.width, e.height);
  const level = Math.floor(Math.log2(Math.max(extent / pixels, 1)) + bias);
  return Math.min(Math.max(level, 0), e.mipCount - 1);
}

export class StreamPolicy {
  readonly entries: StreamEntry[] = [];
  frame = 0;

  constructor(public config: StreamConfig = { ...DEFAULT_STREAM_CONFIG }) {}

  /** Register a texture; it starts at `initialLevel` (default: the floor level, i.e. cheap and always available). */
  add(width: number, height: number, mipCount: number, bytesPerTexel = 4, initialLevel?: number): StreamEntry {
    const e: StreamEntry = {
      id: this.entries.length, width, height, mipCount, bytesPerTexel,
      resident: Math.min(initialLevel ?? this.config.floorLevel, mipCount - 1), pixels: 0, lastTouchFrame: -1, wantsCoarserFor: 0,
    };
    this.entries.push(e);
    return e;
  }

  beginFrame(): void { this.frame++; for (const e of this.entries) e.pixels = 0; }

  touch(id: number, pixels: number): void {
    const e = this.entries[id];
    if (pixels > e.pixels) e.pixels = pixels;
    e.lastTouchFrame = this.frame;
  }

  get totalResidentBytes(): number { return this.entries.reduce((s, e) => s + residentBytes(e, e.resident), 0); }

  /**
   * Compute level changes for this frame. Downgrades are free and unlimited; upgrades are processed in priority order (largest
   * on-screen footprint first) one level at a time within the upload budget; the memory budget is enforced by lowering the least
   * important textures first.
   */
  plan(): StreamChange[] {
    const c = this.config, es = this.entries;
    const target = es.map((e) => desiredLevel(e, e.pixels, c.bias, c.floorLevel));
    // 1. enforce the memory budget on the desired state: coarsen the least important (smallest footprint) textures first
    const byImportance = es.map((_, i) => i).sort((a, b) => es[a].pixels - es[b].pixels);
    let projected = 0;
    for (let i = 0; i < es.length; i++) projected += residentBytes(es[i], target[i]);
    for (const i of byImportance) {
      if (projected <= c.budgetBytes) break;
      while (target[i] < es[i].mipCount - 1 && projected > c.budgetBytes) { projected -= mipBytes(es[i], target[i]); target[i]++; }
    }

    const changes: StreamChange[] = [];
    // 2. downgrades (delayed unless over budget)
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (target[i] > e.resident) {
        e.wantsCoarserFor++;
        const overBudget = this.totalResidentBytes > c.budgetBytes;
        if (overBudget || e.wantsCoarserFor >= c.downgradeDelay) { changes.push({ id: e.id, from: e.resident, to: target[i] }); e.resident = target[i]; e.wantsCoarserFor = 0; }
      } else e.wantsCoarserFor = 0;
    }
    // 3. upgrades, most important first, within the upload budget and the memory budget
    let uploaded = 0, resident = this.totalResidentBytes;
    const order = es.map((_, i) => i).filter((i) => target[i] < es[i].resident).sort((a, b) => es[b].pixels - es[a].pixels);
    for (const i of order) {
      const e = es[i];
      const from = e.resident;
      let to = from;
      // upgrade as many levels as the remaining upload budget allows (at least one when anything is left)
      while (to > target[i]) {
        const cost = mipBytes(e, to - 1);
        if (uploaded + cost > c.uploadBytesPerFrame && !(uploaded === 0 && to === from)) break;
        if (resident + cost > c.budgetBytes) break;
        uploaded += cost; resident += cost; to--;
      }
      if (to !== from) { changes.push({ id: e.id, from, to }); e.resident = to; }
      if (uploaded >= c.uploadBytesPerFrame) break;
    }
    return changes;
  }
}
