import { describe, it, expect } from 'vitest';
import { RendererStats } from '../src/profiling/RendererStats';

describe('RendererStats.reset', () => {
  it('zeroes the per-frame counters and the timings the renderer measures itself', () => {
    const s = new RendererStats();
    s.drawCalls = 5; s.visible = 3; s.cpu.sorting = 1; s.cpu.total = 2; s.lodCounts[1] = 4;
    s.reset();
    expect(s.drawCalls).toBe(0);
    expect(s.visible).toBe(0);
    expect(s.cpu.sorting).toBe(0);
    expect(s.cpu.total).toBe(0);
    expect(s.lodCounts[1]).toBe(0);
  });

  it('keeps the extraction time, which the caller measures before render() resets the stats', () => {
    const s = new RendererStats();
    s.cpu.extraction = 1.5;
    s.reset();
    expect(s.cpu.extraction).toBe(1.5);
  });
});
