import { describe, it, expect } from 'vitest';
import { buildMipChain } from '../src/streaming/TextureStreamer';

describe('buildMipChain', () => {
  it('builds the full chain down to 1x1 with the right sizes', () => {
    const chain = buildMipChain(new Uint8Array(8 * 4 * 4).fill(100), 8, 4, false);
    expect(chain.map((m) => [m.width, m.height])).toEqual([[8, 4], [4, 2], [2, 1], [1, 1]]);
  });
  it('averages sRGB colour in linear light (black+white -> 188, not 128) and data directly', () => {
    const px = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);   // 2x2: B W / B W
    expect(buildMipChain(px, 2, 2, true)[1].data[0]).toBeGreaterThanOrEqual(186);
    expect(buildMipChain(px, 2, 2, true)[1].data[0]).toBeLessThanOrEqual(189);
    expect(buildMipChain(px, 2, 2, false)[1].data[0]).toBe(128);
    expect(buildMipChain(px, 2, 2, true)[1].data[3]).toBe(255);   // alpha stays linear
  });
});
