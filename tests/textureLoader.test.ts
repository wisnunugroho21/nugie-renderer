import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextureLoader } from '../src/assets/TextureLoader';
import type { GPUContext } from '../src/gpu/GPUContext';

vi.mock('../src/gpu/MipmapGenerator', () => ({ MipmapGenerator: class { generate() {} } }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup() {
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 });
  const texture = { createView: () => ({}) };
  const gpu = {
    device: {}, queue: { copyExternalImageToTexture: vi.fn() },
    resources: { textures: { create: vi.fn(() => texture), destroy: vi.fn() } },
  };
  const bitmap = { width: 1, height: 1, close: vi.fn() };
  const decode = vi.fn().mockResolvedValue(bitmap);
  vi.stubGlobal('createImageBitmap', decode);
  return { gpu, bitmap, decode, loader: new TextureLoader(gpu as unknown as GPUContext) };
}

describe('TextureLoader lifecycle', () => {
  it('shares in-flight requests but allows retry after a transient fetch failure', async () => {
    const s = setup();
    const resolve = vi.fn().mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValue(new Uint8Array([1]));
    const loader = new TextureLoader(s.gpu as unknown as GPUContext, resolve);
    const image = { name: 'image', mimeType: 'image/png', uri: 'image.png' };
    const failed = loader.load('image', image, true);
    expect(loader.load('image', image, true)).toBe(failed);
    await expect(failed).rejects.toThrow('fetch failed');
    const retried = loader.load('image', image, true);
    expect(loader.load('image', image, true)).toBe(retried);
    await expect(retried).resolves.toHaveProperty('view');
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(s.decode).toHaveBeenCalledOnce();
    expect(s.bitmap.close).toHaveBeenCalledOnce();
  });
  it('closes the bitmap and destroys an allocated texture when upload fails', () => {
    const s = setup();
    s.gpu.queue.copyExternalImageToTexture.mockImplementation(() => { throw new Error('upload failed'); });
    expect(() => s.loader.upload('image', s.bitmap as unknown as ImageBitmap, true)).toThrow('upload failed');
    expect(s.bitmap.close).toHaveBeenCalledOnce();
    expect(s.gpu.resources.textures.destroy).toHaveBeenCalledOnce();
    expect(s.loader.uploads).toBe(0);
  });
});

it('closes a decoded bitmap even when texture allocation fails', () => {
  const s = setup();
  s.gpu.resources.textures.create.mockImplementation(() => { throw new Error('allocation failed'); });
  expect(() => s.loader.upload('image', s.bitmap as unknown as ImageBitmap, false)).toThrow('allocation failed');
  expect(s.bitmap.close).toHaveBeenCalledOnce();
  expect(s.gpu.resources.textures.destroy).not.toHaveBeenCalled();
});
