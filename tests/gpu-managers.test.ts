import { beforeAll, describe, expect, it } from 'vitest';
import { GPUResources } from '../src/gpu/GPUResources';
import { pipelineKeyString, type PipelineKey } from '../src/gpu/PipelineCache';
import { ShaderManager } from '../src/gpu/ShaderManager';
import { estimateTextureBytes, mipLevelCount } from '../src/gpu/TextureManager';

beforeAll(() => {
  (globalThis as any).GPUBufferUsage = { COPY_DST: 8, VERTEX: 32, UNIFORM: 64, STORAGE: 128 };
});

function fakeDevice() {
  const calls = { buffer: 0, texture: 0, sampler: 0, shader: 0, destroyed: 0 };
  const device = {
    queue: { writeBuffer() {} },
    createBuffer: (d: any) => { calls.buffer++; return { size: d.size, destroy() { calls.destroyed++; } }; },
    createTexture: (d: any) => { calls.texture++; return { destroy() { calls.destroyed++; }, d }; },
    createSampler: () => { calls.sampler++; return {}; },
    createShaderModule: () => { calls.shader++; return {}; },
  } as unknown as GPUDevice;
  return { device, calls };
}

const baseKey: PipelineKey = {
  shader: 'pbr#HAS_SKINNING=0',
  vertexLayout: [{ stride: 32, attributes: [{ location: 0, offset: 0, format: 'float32x3' }] }],
  topology: 'triangle-list', cullMode: 'back',
  depth: { format: 'depth24plus', write: true, compare: 'less' },
  targets: [{ format: 'bgra8unorm' }], sampleCount: 1,
};

describe('PipelineCache', () => {
  it('creates once per key, hits afterwards', () => {
    const r = new GPUResources(fakeDevice().device);
    let made = 0;
    const mk = () => { made++; return {} as GPURenderPipeline; };
    const a = r.pipelines.getRender(baseKey, mk);
    const b = r.pipelines.getRender({ ...baseKey }, mk);
    expect(a).toBe(b);
    expect(made).toBe(1);
    expect(r.stats.pipelineHits).toBe(1);
    expect(r.stats.pipelineMisses).toBe(1);
  });
  it('every key field changes the key', () => {
    const k0 = pipelineKeyString(baseKey);
    const variants: PipelineKey[] = [
      { ...baseKey, shader: 'x' },
      { ...baseKey, topology: 'line-list' },
      { ...baseKey, cullMode: 'none' },
      { ...baseKey, depth: null },
      { ...baseKey, depth: { ...baseKey.depth!, compare: 'greater' } },
      { ...baseKey, targets: [{ format: 'rgba16float' }] },
      { ...baseKey, targets: [{ format: 'bgra8unorm', blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } }] },
      { ...baseKey, sampleCount: 4 },
      { ...baseKey, vertexLayout: [{ stride: 16, attributes: [{ location: 0, offset: 0, format: 'float32x3' }] }] },
    ];
    for (const v of variants) expect(pipelineKeyString(v)).not.toBe(k0);
  });
  it('async warm-up primes the cache without counting as a freeze violation and never double-creates', async () => {
    const r = new GPUResources(fakeDevice().device);
    r.pipelines.freeze();
    let made = 0;
    await r.pipelines.primeRender(baseKey, async () => { made++; return {} as GPURenderPipeline; });
    await r.pipelines.primeRender({ ...baseKey }, async () => { made++; return {} as GPURenderPipeline; });   // already cached: not created
    expect(made).toBe(1);
    expect(r.stats.pipelineCreationsAfterFreeze).toBe(0);
    const hit = r.pipelines.getRender(baseKey, () => { throw new Error('should be cached'); });
    expect(hit).toBeDefined();
    expect(r.stats.pipelineCreations).toBe(1);
  });
  it('counts creations after freeze', () => {
    const r = new GPUResources(fakeDevice().device);
    r.pipelines.getRender(baseKey, () => ({} as GPURenderPipeline));
    r.pipelines.freeze();
    r.pipelines.getRender(baseKey, () => ({} as GPURenderPipeline));
    expect(r.stats.pipelineCreationsAfterFreeze).toBe(0);
    r.pipelines.getRender({ ...baseKey, cullMode: 'front' }, () => ({} as GPURenderPipeline));
    expect(r.stats.pipelineCreationsAfterFreeze).toBe(1);
  });
});

describe('ShaderManager', () => {
  it('caches by id + defines', () => {
    const { device, calls } = fakeDevice();
    const r = new GPUResources(device);
    r.shaders.get('s', 'fn main(){}', { A: true });
    r.shaders.get('s', 'fn main(){}', { A: true });
    r.shaders.get('s', 'fn main(){}', { A: false });
    expect(calls.shader).toBe(2);
    expect(r.stats.shaderHits).toBe(1);
    expect(r.stats.shaderModules).toBe(2);
  });
  it('define order does not matter', () => {
    expect(ShaderManager.key('s', { A: 1, B: 0 })).toBe(ShaderManager.key('s', { B: 0, A: 1 }));
  });
  it('assembles defines and includes', () => {
    const sm = new ShaderManager({} as GPUDevice, new GPUResources(fakeDevice().device).stats);
    sm.registerChunk('common', 'fn helper() {}\n//#include inner');
    sm.registerChunk('inner', 'fn inner() {}');
    const out = sm.assemble('//#include common\nfn main() {}', { HAS_SKINNING: true, N: 4 });
    expect(out).toContain('const HAS_SKINNING: bool = true;');
    expect(out).toContain('const N: u32 = 4u;');
    expect(out).toContain('fn inner() {}');
    expect(() => sm.assemble('//#include nope', {})).toThrow();
  });
});

describe('Buffers / textures / samplers', () => {
  it('tracks buffer bytes and destroy', () => {
    const { device, calls } = fakeDevice();
    const r = new GPUResources(device);
    const b = r.buffers.create('b', 10, 64); // aligned to 12
    expect(r.stats.bufferBytes).toBe(12);
    r.buffers.destroy(b);
    expect(r.stats.bufferBytes).toBe(0);
    expect(calls.destroyed).toBe(1);
  });
  it('sampler cache dedupes', () => {
    const { device, calls } = fakeDevice();
    const r = new GPUResources(device);
    r.samplers.get({ magFilter: 'linear' });
    r.samplers.get({ magFilter: 'linear' });
    r.samplers.get({ magFilter: 'nearest' });
    expect(calls.sampler).toBe(2);
    expect(r.stats.samplerHits).toBe(1);
  });
  it('texture dedupe by key', () => {
    const { device, calls } = fakeDevice();
    const r = new GPUResources(device);
    const mk = () => r.textures.create({ size: [4, 4], format: 'rgba8unorm', usage: 0 });
    expect(r.textures.getOrCreate('a', mk)).toBe(r.textures.getOrCreate('a', mk));
    expect(calls.texture).toBe(1);
    expect(r.stats.textureBytes).toBe(64);
  });
  it('mip math', () => {
    expect(mipLevelCount(256, 128)).toBe(9);
    expect(estimateTextureBytes(4, 4, 1, 'rgba8unorm', 3)).toBe(64 + 16 + 4);
  });
});

it('accounts for MSAA samples and shrinking 3D mip depth in texture memory statistics', () => {
  const resources = new GPUResources(fakeDevice().device);
  const texture = resources.textures.create({ size: [8, 4], format: 'rgba8unorm', usage: 16, sampleCount: 4 });
  expect(resources.stats.textureBytes).toBe(8 * 4 * 4 * 4);
  resources.textures.destroy(texture);
  expect(resources.stats.textureBytes).toBe(0);
  expect(estimateTextureBytes(4, 4, 4, 'rgba8unorm', 3, '3d')).toBe((64 + 8 + 1) * 4);
  expect(estimateTextureBytes(4, 4, 4, 'rgba8unorm', 3)).toBe((16 + 4 + 1) * 4 * 4);
});

it('shares concurrent pipeline warmups and retries after a rejected factory', async () => {
  const resources = new GPUResources(fakeDevice().device);
  let made = 0;
  let finish!: (pipeline: GPURenderPipeline) => void;
  const create = () => { made++; return new Promise<GPURenderPipeline>((resolve) => { finish = resolve; }); };
  const first = resources.pipelines.primeRender(baseKey, create);
  const second = resources.pipelines.primeRender(baseKey, create);
  await Promise.resolve();
  expect(made).toBe(1);
  finish({} as GPURenderPipeline);
  await Promise.all([first, second]);
  expect(resources.stats.pipelineCreations).toBe(1);
  const other = { ...baseKey, cullMode: 'front' as const };
  await expect(resources.pipelines.primeRender(other, async () => { throw new Error('compile failed'); })).rejects.toThrow('compile failed');
  await resources.pipelines.primeRender(other, async () => ({} as GPURenderPipeline));
  expect(resources.stats.pipelineCreations).toBe(2);
});
