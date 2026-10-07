import { beforeAll, describe, expect, it } from 'vitest';
import { GPUResources } from '../src/gpu/GPUResources';
import { MaterialManager, MaterialError, type PassTarget } from '../src/rendering/materials/MaterialManager';
import { generateParamAccessors, hashString, layoutParams, packParams, validateCustomShader } from '../src/rendering/materials/CustomShader';
import { TextureSlot } from '../src/rendering/materials/Material';
import { featureDefines, MaterialFeature } from '../src/rendering/materials/MaterialFlags';
import type { BindLayouts } from '../src/gpu/BindLayouts';

beforeAll(() => {
  const g = globalThis as any;
  g.GPUBufferUsage = { COPY_DST: 8, COPY_SRC: 4, VERTEX: 32, INDEX: 16, UNIFORM: 64, STORAGE: 128 };
  g.GPUTextureUsage = { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
  g.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
});

function fake(opts: { popError?: boolean } = {}) {
  const writes: { buffer: any; offset: number; bytes: number; data: Uint8Array }[] = [];
  const stats = { pipelines: 0, bindGroups: 0, buffers: 0 };
  const device = {
    queue: {
      writeBuffer: (buffer: any, offset: number, data: ArrayBuffer, dOff: number, size: number) =>
        writes.push({ buffer, offset, bytes: size, data: new Uint8Array(data.slice(dOff, dOff + size)) }),
      writeTexture: () => {},
    },
    createBuffer: (d: any) => { stats.buffers++; return { label: d.label, size: d.size, destroy() {} }; },
    createTexture: () => ({ createView: () => ({}), destroy() {} }),
    createSampler: () => ({}),
    createShaderModule: () => ({}),
    createBindGroup: () => { stats.bindGroups++; return {}; },
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => { stats.pipelines++; return { id: stats.pipelines }; },
    pushErrorScope: () => {},
    popErrorScope: () => Promise.resolve(opts.popError ? { message: 'boom' } : null),
  } as unknown as GPUDevice;
  const res = new GPUResources(device);
  const layouts = { frame: {}, scene: {}, material: {}, object: {}, pipelineLayout: {} } as unknown as BindLayouts;
  const mm = new MaterialManager(device, res, layouts);
  return { mm, res, writes, stats };
}

const TARGET: PassTarget = { colorFormat: 'bgra8unorm', depthFormat: 'depth24plus', sampleCount: 1 };
const f32 = (b: Uint8Array) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);

describe('custom parameter layout', () => {
  it('packs without straddling vec4 boundaries', () => {
    const l = layoutParams([
      { name: 'a', type: 'f32' }, { name: 'b', type: 'vec2' }, { name: 'c', type: 'vec3' }, { name: 'd', type: 'f32' }, { name: 'e', type: 'vec4' },
    ]);
    const o = Object.fromEntries(l.entries.map((e) => [e.name, e.offset]));
    expect(o).toEqual({ a: 0, b: 2, c: 4, d: 7, e: 8 }); // d fills the free w lane of the vec3 slot
    expect(l.vec4Count).toBe(3);
  });
  it('rejects duplicate / invalid names', () => {
    expect(() => layoutParams([{ name: 'a', type: 'f32' }, { name: 'a', type: 'f32' }])).toThrow();
    expect(() => layoutParams([{ name: '1x', type: 'f32' }])).toThrow();
  });
  it('packs values and validates component counts', () => {
    const l = layoutParams([{ name: 't', type: 'vec4' }, { name: 's', type: 'f32' }]);
    const out = new Float32Array(16);
    packParams(l, { t: [1, 2, 3, 4], s: 9 }, out, 4);
    expect(Array.from(out.slice(4, 9))).toEqual([1, 2, 3, 4, 9]);
    expect(() => packParams(l, { t: [1, 2] }, out, 0)).toThrow();
  });
  it('generates accessors with correct swizzles', () => {
    const src = generateParamAccessors(layoutParams([{ name: 'a', type: 'f32' }, { name: 'b', type: 'vec2' }, { name: 'c', type: 'vec3' }]));
    expect(src).toContain('fn param_a(base: u32) -> f32 { return customParams[base + 0u].x; }');
    expect(src).toContain('fn param_b(base: u32) -> vec2<f32> { return customParams[base + 0u].zw; }');
    expect(src).toContain('fn param_c(base: u32) -> vec3<f32> { return customParams[base + 1u].xyz; }');
  });
});

describe('custom shader validation (cannot bypass resource ownership)', () => {
  const ok = '@vertex fn vs_main(in: VertexInput) -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }\n@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }';
  it('accepts a valid shader', () => expect(validateCustomShader(ok, 'vs_main', 'fs_main')).toEqual([]));
  it('rejects @group / @binding declarations', () => {
    expect(validateCustomShader('@group(0) @binding(9) var<uniform> x: vec4<f32>;\n' + ok, 'vs_main', 'fs_main').length).toBe(2);
  });
  it('ignores @group inside comments', () => expect(validateCustomShader('// @group(0)\n/* @binding(1) */\n' + ok, 'vs_main', 'fs_main')).toEqual([]));
  it('reports missing entry points', () => {
    expect(validateCustomShader('fn x() {}', 'vs_main', 'fs_main').length).toBe(2);
    expect(validateCustomShader(ok, 'vs_main', 'fs_main', ['vs_depth']).length).toBe(1);
  });
  it('hash is stable and discriminating', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});

describe('MaterialManager', () => {
  it('PBR and emissive materials share ONE material buffer (+ one param buffer)', () => {
    const { mm, res } = fake();
    for (let i = 0; i < 100; i++) mm.createPBR({ roughness: i / 100 });
    for (let i = 0; i < 100; i++) mm.createPBR({ emissive: [1, 0.5, 0], emissiveStrength: 10 });
    expect(res.stats.buffers).toBe(2);
  });

  it('writes records in the documented 64-byte layout', () => {
    const { mm, writes } = fake();
    const id = mm.createPBR({ baseColor: [0.1, 0.2, 0.3, 0.4], metallic: 0.5, roughness: 0.6, emissive: [1, 2, 3], emissiveStrength: 4, alphaCutoff: 0.25 });
    mm.flush();
    const w = writes.find((x) => x.buffer.label === 'MaterialBuffer')!;
    const f = f32(w.data).slice(id * 16, id * 16 + 16);
    expect(f[0]).toBeCloseTo(0.1); expect(f[3]).toBeCloseTo(0.4);
    expect(Array.from(f.slice(4, 8))).toEqual([1, 2, 3, 4]);
    expect(f[8]).toBeCloseTo(0.5); expect(f[9]).toBeCloseTo(0.6); expect(f[12]).toBeCloseTo(0.25);
    const flags = new Uint32Array(f.buffer, f.byteOffset, 16)[13];
    expect(flags & 4).toBe(4); // Emissive flag
  });

  it('uploads only the dirty record range', () => {
    const { mm, writes } = fake();
    const a = mm.createPBR(); mm.createPBR(); const c = mm.createPBR();
    mm.flush();
    writes.length = 0;
    mm.setPBR(a, { roughness: 0.1 });
    mm.flush();
    expect(writes.length).toBe(1);
    expect(writes[0].bytes).toBe(64);
    expect(writes[0].offset).toBe(a * 64);
    mm.setPBR(c, { roughness: 0.2 });
    mm.setPBR(a, { roughness: 0.3 });
    writes.length = 0;
    mm.flush();
    expect(writes[0].bytes).toBe((c - a + 1) * 64);
    writes.length = 0;
    mm.flush();
    expect(writes.length).toBe(0); // nothing dirty
  });

  it('custom material accepts its own WGSL; invalid shaders throw MaterialError', () => {
    const { mm } = fake();
    const wgsl = '@vertex fn vs_main(in: VertexInput) -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }\n@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(param_tint(0u)); }';
    const id = mm.createCustom({ name: 'glow', wgsl, params: [{ name: 'tint', type: 'vec4' }], values: { tint: [1, 0, 0, 1] } });
    expect(mm.get(id).kind).toBe('custom');
    expect(() => mm.createCustom({ name: 'bad', wgsl: '@group(0) @binding(0) var<uniform> u: f32;' })).toThrow(MaterialError);
  });

  it('custom parameters land in the shared param buffer at paramBase', () => {
    const { mm, writes } = fake();
    const wgsl = '@vertex fn vs_main(in: VertexInput) -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }\n@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }';
    const p = [{ name: 'speed', type: 'f32' as const }, { name: 'color', type: 'vec3' as const }];
    const a = mm.createCustom({ name: 'a', wgsl, params: p, values: { speed: 2, color: [1, 2, 3] } });
    const b = mm.createCustom({ name: 'b', wgsl, params: p, values: { speed: 5, color: [4, 5, 6] } });
    mm.flush();
    const w = writes.find((x) => x.buffer.label === 'CustomMaterialParameterBuffer')!;
    const all = f32(w.data);
    const base = (id: number) => mm.get(id).paramBase * 4;
    expect(all[base(a)]).toBe(2); expect(Array.from(all.slice(base(a) + 4, base(a) + 7))).toEqual([1, 2, 3]);
    expect(all[base(b)]).toBe(5);
    expect(mm.get(a).paramBase).not.toBe(mm.get(b).paramBase);
    // identical source+schema => same shader identity (shared module & pipeline)
    expect(mm.get(a).shaderId).toBe(mm.get(b).shaderId);
    expect(mm.get(a).pipelineSortId).toBe(mm.get(b).pipelineSortId);
  });

  it('identical materials share one pipeline; creation count is stable on re-request', () => {
    const { mm, res, stats } = fake();
    const a = mm.createPBR({ roughness: 0.1 }), b = mm.createPBR({ roughness: 0.9 });
    expect(mm.getPipeline(a, TARGET)).toBe(mm.getPipeline(b, TARGET));
    expect(stats.pipelines).toBe(1);
    for (let i = 0; i < 100; i++) mm.getPipeline(a, TARGET);
    expect(stats.pipelines).toBe(1);
    expect(res.stats.pipelineMisses).toBe(1);
  });

  it('material state changes do not recreate unrelated pipelines', () => {
    const { mm, stats } = fake();
    const a = mm.createPBR(), b = mm.createPBR({ alphaMode: 'BLEND' }), c = mm.createPBR({ doubleSided: true });
    const pa = mm.getPipeline(a, TARGET), pb = mm.getPipeline(b, TARGET), pc = mm.getPipeline(c, TARGET);
    expect(stats.pipelines).toBe(3);
    // value-only change: zero pipeline work
    mm.setPBR(a, { roughness: 0.2, metallic: 0.9, baseColor: [1, 0, 0, 1] });
    expect(mm.getPipeline(a, TARGET)).toBe(pa);
    expect(stats.pipelines).toBe(3);
    // switching A to MASK needs exactly one new pipeline; B and C untouched
    mm.setPBR(a, { alphaMode: 'MASK' });
    const pa2 = mm.getPipeline(a, TARGET);
    expect(pa2).not.toBe(pa);
    expect(stats.pipelines).toBe(4);
    expect(mm.getPipeline(b, TARGET)).toBe(pb);
    expect(mm.getPipeline(c, TARGET)).toBe(pc);
    expect(stats.pipelines).toBe(4);
  });

  it('alpha modes map to queues, blend and depth-write state', () => {
    const { mm } = fake();
    const o = mm.get(mm.createPBR()), m = mm.get(mm.createPBR({ alphaMode: 'MASK' })), t = mm.get(mm.createPBR({ alphaMode: 'BLEND' }));
    expect([o.queue, m.queue, t.queue]).toEqual(['opaque', 'alphaMask', 'transparent']);
    expect(t.state.blend).not.toBeNull();
    expect(t.state.depthWrite).toBe(false);
    expect(o.state.depthWrite).toBe(true);
    expect(m.features & MaterialFeature.AlphaMask).toBeTruthy();
    expect(featureDefines(m.features).ALPHA_MASK).toBe(true);
  });

  it('double sided disables culling', () => {
    const { mm } = fake();
    expect(mm.get(mm.createPBR({ doubleSided: true })).state.cullMode).toBe('none');
    expect(mm.get(mm.createPBR()).state.cullMode).toBe('back');
  });

  it('normal map texture selects the NormalMap variant (separate pipeline)', () => {
    const { mm, stats } = fake();
    const a = mm.createPBR();
    const b = mm.createPBR({ textures: { normal: { id: 'n', view: {} as GPUTextureView } } });
    expect(mm.get(b).features & MaterialFeature.NormalMap).toBeTruthy();
    mm.getPipeline(a, TARGET); mm.getPipeline(b, TARGET);
    expect(stats.pipelines).toBe(2);
  });

  it('bind groups are cached and rebuilt only when textures change', () => {
    const { mm, stats } = fake();
    const a = mm.createPBR();
    const g1 = mm.getBindGroup(a);
    expect(mm.getBindGroup(a)).toBe(g1);
    expect(stats.bindGroups).toBe(1);
    mm.setTexture(a, TextureSlot.BaseColor, { id: 'tex1', view: {} as GPUTextureView });
    const g2 = mm.getBindGroup(a);
    expect(g2).not.toBe(g1);
  });

  it('grows past the initial record capacity without losing data', () => {
    const { mm, writes } = fake();
    const ids: number[] = [];
    for (let i = 0; i < 200; i++) ids.push(mm.createPBR({ roughness: i / 1000 }));
    expect(mm.generation).toBeGreaterThan(0);
    mm.flush();
    const w = writes.filter((x) => x.buffer.label === 'MaterialBuffer').pop()!;
    const all = f32(w.data);
    expect(all[ids[150] * 16 + 9]).toBeCloseTo(0.15);
  });

  it('shader build failure falls back to the error material', async () => {
    const { mm } = fake({ popError: true });
    const wgsl = '@vertex fn vs_main(in: VertexInput) -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }\n@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }';
    const id = mm.createCustom({ name: 'broken', wgsl });
    const original = mm.getPipeline(id, TARGET);
    await Promise.resolve(); await Promise.resolve();
    expect(mm.get(id).failed).toBe(true);
    expect(mm.shaderErrors.length).toBe(1);
    const fallback = mm.getPipeline(id, TARGET);
    expect(fallback).not.toBe(original);
    expect(fallback).toBe(mm.getPipeline(mm.errorMaterial, TARGET));
  });

  it('depth-only targets omit the fragment stage in the key', () => {
    const { mm } = fake();
    const k = mm.pipelineKey(mm.get(mm.defaultMaterial), { colorFormat: null, depthFormat: 'depth24plus', sampleCount: 1 });
    expect(k.fragmentEntry).toBeNull();
    expect(k.targets).toEqual([]);
  });
});
