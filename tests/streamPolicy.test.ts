import { describe, it, expect } from 'vitest';
import { StreamPolicy, desiredLevel, residentBytes, mipBytes } from '../src/streaming/StreamPolicy';

const cfg = (o: Partial<ConstructorParameters<typeof StreamPolicy>[0]> = {}) => ({ budgetBytes: 1e12, uploadBytesPerFrame: 1e12, floorLevel: 4, downgradeDelay: 3, bias: 0, ...o });

describe('stream policy', () => {
  it('desired level follows screen coverage (texel ~ pixel) and falls back to the floor when unseen', () => {
    const e = { width: 2048, height: 2048, mipCount: 12 };
    expect(desiredLevel(e, 2048, 0, 4)).toBe(0);
    expect(desiredLevel(e, 1024, 0, 4)).toBe(1);
    expect(desiredLevel(e, 300, 0, 4)).toBe(2);
    expect(desiredLevel(e, 4096, 0, 4)).toBe(0);
    expect(desiredLevel(e, 0, 0, 4)).toBe(4);
    expect(desiredLevel(e, 1, 0, 4)).toBe(11);
    expect(desiredLevel(e, 1024, 1, 4)).toBe(2);   // bias lowers quality
  });

  it('counts resident bytes of a mip tail', () => {
    const e = { width: 1024, height: 512, mipCount: 11, bytesPerTexel: 4 };
    expect(mipBytes(e, 0)).toBe(1024 * 512 * 4);
    expect(residentBytes(e, 0)).toBeCloseTo((1024 * 512 * 4) * 4 / 3, -3);
    expect(residentBytes(e, 10)).toBe(4);
  });

  it('upgrades a visible texture to full resolution and keeps unseen ones at the floor', () => {
    const p = new StreamPolicy(cfg());
    const a = p.add(1024, 1024, 11), b = p.add(1024, 1024, 11);
    expect(a.resident).toBe(4);
    p.beginFrame(); p.touch(a.id, 1024);
    const ch = p.plan();
    expect(ch).toEqual([{ id: a.id, from: 4, to: 0 }]);
    expect(b.resident).toBe(4);
  });

  it('spreads upgrades over frames with the upload budget, biggest footprint first, always progressing', () => {
    const p = new StreamPolicy(cfg({ uploadBytesPerFrame: 1024 * 1024 * 4 }));   // one 1024x1024 mip per frame
    const big = p.add(1024, 1024, 11), small = p.add(1024, 1024, 11);
    const history: number[] = [];
    for (let f = 0; f < 6; f++) {
      p.beginFrame(); p.touch(big.id, 1024); p.touch(small.id, 256);
      p.plan();
      history.push(big.resident);
    }
    expect(history[0]).toBeLessThan(4);   // progress is made on frame 1
    expect(big.resident).toBe(0);
    expect(small.resident).toBe(2);
    // big (the more important texture) reaches its target no later than small
    const p2 = new StreamPolicy(cfg({ uploadBytesPerFrame: 1024 * 1024 * 4 }));
    const b2 = p2.add(1024, 1024, 11), s2 = p2.add(1024, 1024, 11);
    p2.beginFrame(); p2.touch(b2.id, 1024); p2.touch(s2.id, 1024);
    const first = p2.plan();
    expect(first.length).toBeGreaterThan(0);
    let up = 0; for (const c of first) up += residentBytes(b2, c.to) - residentBytes(b2, c.from);
    expect(up).toBeLessThanOrEqual(1024 * 1024 * 4 * 1.34);   // only about one big level's worth of data per frame
  });

  it('downgrades only after the hysteresis delay (when within budget)', () => {
    const p = new StreamPolicy(cfg({ downgradeDelay: 3 }));
    const a = p.add(1024, 1024, 11, 4, 0);
    const levels: number[] = [];
    for (let f = 0; f < 5; f++) { p.beginFrame(); p.plan(); levels.push(a.resident); }
    expect(levels.slice(0, 2)).toEqual([0, 0]);
    expect(levels[2]).toBe(4);
  });

  it('respects the memory budget: least important textures are coarsened first, never below the last mip', () => {
    const full = residentBytes({ width: 1024, height: 1024, mipCount: 11, bytesPerTexel: 4 }, 0);
    const p = new StreamPolicy(cfg({ budgetBytes: full * 1.04 }));
    const a = p.add(1024, 1024, 11), b = p.add(1024, 1024, 11);
    for (let f = 0; f < 4; f++) { p.beginFrame(); p.touch(a.id, 1024); p.touch(b.id, 200); p.plan(); }
    expect(a.resident).toBe(0);
    expect(b.resident).toBeGreaterThan(2);
    expect(p.totalResidentBytes).toBeLessThanOrEqual(full * 1.04);
    // extreme: budget smaller than anything -> everything at the smallest mip, no crash
    const q = new StreamPolicy(cfg({ budgetBytes: 1 }));
    const c = q.add(1024, 1024, 11, 4, 0);
    q.beginFrame(); q.touch(c.id, 1024); q.plan();
    expect(c.resident).toBe(10);
  });

  it('over budget triggers immediate downgrades', () => {
    const e0 = residentBytes({ width: 1024, height: 1024, mipCount: 11, bytesPerTexel: 4 }, 0);
    const p = new StreamPolicy(cfg({ budgetBytes: e0 * 1.1, downgradeDelay: 1000 }));
    const a = p.add(1024, 1024, 11, 4, 0), b = p.add(1024, 1024, 11, 4, 0);
    p.beginFrame(); p.touch(a.id, 1024); p.touch(b.id, 1024);
    p.plan();
    expect(p.totalResidentBytes).toBeLessThanOrEqual(e0 * 1.1);
  });
});
