import { describe, expect, it, vi } from 'vitest';
import { StreamingDriver } from '../src/streaming/StreamingDriver';
import { RenderWorld } from '../src/rendering/RenderWorld';
import type { TextureStreamer, StreamedTexture } from '../src/streaming/TextureStreamer';
import type { MaterialManager } from '../src/rendering/materials/MaterialManager';

function setup() {
  const texture = {} as StreamedTexture;
  const material = { textures: [texture] };
  const materials = { get: () => material, textureChanged: vi.fn() } as unknown as MaterialManager;
  const streamer = { textures: [texture], onViewChanged: null, beginFrame: vi.fn(), touch: vi.fn(), update: vi.fn() };
  const driver = new StreamingDriver(materials);
  driver.attach(streamer as unknown as TextureStreamer);
  const world = new RenderWorld();
  world.ensureCapacity(2); world.count = 2;
  world.boundsSphere.set([0, 0, -10, 1, 0, 0, -10, 2]);
  return { driver, streamer, world, texture, material, materials };
}

describe('StreamingDriver', () => {
  it('handles the null slots returned by disabled culling and combines material coverage', () => {
    const s = setup();
    s.driver.update(s.world, { slots: null, count: 2 }, 2, 100);
    expect(s.streamer.touch).toHaveBeenCalledExactlyOnceWith(s.texture, expect.any(Number));
    expect(s.streamer.update).toHaveBeenCalledOnce();
  });
  it('follows texture replacement and registration after the first visible frame', () => {
    const s = setup();
    s.driver.update(s.world, null, 2, 100);
    const replacement = {} as StreamedTexture;
    s.material.textures[0] = replacement;
    s.driver.update(s.world, null, 2, 100);
    expect(s.streamer.touch).toHaveBeenCalledTimes(1);
    s.streamer.textures.push(replacement);
    s.driver.update(s.world, null, 2, 100);
    expect(s.streamer.touch).toHaveBeenLastCalledWith(replacement, expect.any(Number));
  });
  it('detaches the old view-change callback without clearing a replacement callback', () => {
    const s = setup();
    const callback = s.streamer.onViewChanged as unknown as (t: StreamedTexture) => void;
    callback(s.texture);
    expect(s.materials.textureChanged).toHaveBeenCalledWith(s.texture);
    s.driver.attach(null);
    expect(s.streamer.onViewChanged).toBeNull();
    s.driver.attach(s.streamer as unknown as TextureStreamer);
    const replacement = vi.fn();
    (s.streamer as unknown as TextureStreamer).onViewChanged = replacement;
    s.driver.attach(null);
    expect(s.streamer.onViewChanged).toBe(replacement);
  });
});
