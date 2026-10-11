import type { GPUContext } from '../gpu/GPUContext';
import { TechniqueInstance } from '../rendering/graph/TechniqueInstance';
import type { ComputeNode, NodeDecl, Technique } from '../rendering/graph/TechniqueTypes';
import { readTextureRGBA8, type SelfTest } from './harness';

const f = Math.fround;

/** `out = in * gain + bias` on one r32float texture per step (sampled in, storage out). */
const step = (name: string, src: string, dst: string): ComputeNode => ({
  type: 'compute', name, entryPoint: 'main', workgroupSize: [8, 8],
  shader: { code: `/*$(Bindings)*/
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = /*$(Size:${dst})*/;
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2<i32>(id.xy);
  textureStore(${dst}, p, vec4<f32>(textureLoad(${src}, p, 0).x * /*$(Variable:gain)*/ + /*$(Variable:bias)*/, 0.0, 0.0, 0.0));
}` },
  bindings: [{ resource: src, access: 'read' }, { resource: dst, access: 'write' }], dispatch: { like: dst },
});

const GEN: ComputeNode = {
  type: 'compute', name: 'gen', workgroupSize: [8, 8],
  shader: { code: `/*$(Bindings)*/
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = /*$(Size:t1)*/;
  if (id.x >= size.x || id.y >= size.y) { return; }
  textureStore(t1, vec2<i32>(id.xy), vec4<f32>(f32(id.x) / f32(size.x) + f32(id.y) * 0.001, 0.0, 0.0, 0.0));
}` },
  bindings: [{ resource: 't1', access: 'write' }], dispatch: { like: 't1' },
};

/** Convert the last r32float texture to the exported rgba8 image with a tint variable. */
const toImage = (src: string): ComputeNode => ({
  type: 'compute', name: 'to-image', workgroupSize: [8, 8],
  shader: { code: `/*$(Bindings)*/
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = /*$(Size:result)*/;
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2<i32>(id.xy);
  let v = textureLoad(${src}, p, 0).x;
  let c = /*$(Variable:tint)*/;
  textureStore(result, p, vec4<f32>(clamp(v, 0.0, 1.0) * c.x, c.y, c.z, 1.0));
}` },
  bindings: [{ resource: src, access: 'read' }, { resource: 'result', access: 'write' }], dispatch: { like: 'result' },
});

const VARIABLES: Technique['variables'] = [
  { name: 'width', type: 'uint', value: 100, visibility: 'host' }, { name: 'height', type: 'uint', value: 60, visibility: 'host' },
  { name: 'gain', type: 'float', value: 0.9 }, { name: 'bias', type: 'float', value: 0.01 }, { name: 'tint', type: 'float4', value: [1, 0.25, 0.5, 1] },
];
const r32 = (name: string, extra: Partial<Extract<NonNullable<Technique['resources']>[number], { kind: 'texture' }>> = {}) => ({ kind: 'texture' as const, name, format: 'r32float' as const, ...extra });

/** A chain of four transient r32float textures: gen -> t1 -> t2 -> t3 -> t4 -> result. */
function chain(): Technique {
  return {
    name: 'chain', variables: VARIABLES,
    resources: [
      r32('t1', { size: [{ variable: 'width' }, { variable: 'height' }] }), r32('t2', { like: 't1' }), r32('t3', { like: 't1' }), r32('t4', { like: 't1' }),
      { kind: 'texture', name: 'result', format: 'rgba8unorm', like: 't1', visibility: 'exported' },
    ],
    nodes: [GEN, step('s1', 't1', 't2'), step('s2', 't2', 't3'), step('s3', 't3', 't4'), toImage('t4')],
  };
}

/** Expected result image for `w` x `h`, `steps` applications of `v * gain + bias`. */
function expectChain(w: number, h: number, steps: number, gain: number, bias: number, tint: number[], loopBias?: (i: number) => number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = f(f(x / w) + f(y * 0.001));
    for (let i = 0; i < steps; i++) v = f(f(v * f(gain)) + f(loopBias ? loopBias(i) : bias));
    const o = (y * w + x) * 4;
    out[o] = Math.round(Math.min(1, Math.max(0, v)) * tint[0] * 255); out[o + 1] = Math.round(tint[1] * 255); out[o + 2] = Math.round(tint[2] * 255); out[o + 3] = 255;
  }
  return out;
}

function maxDiff(a: Uint8Array, b: Uint8Array): number { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; }

/** Run `instance` once and read back an exported texture. */
async function run(gpu: GPUContext, instance: TechniqueInstance, resource: string): Promise<{ pixels: Uint8Array; w: number; h: number }> {
  const enc = gpu.device.createCommandEncoder();
  instance.execute(enc);
  gpu.device.queue.submit([enc.finish()]);
  const tex = instance.resource(resource) as GPUTexture;
  return { pixels: await readTextureRGBA8(gpu.device, tex, 0, tex.width, tex.height), w: tex.width, h: tex.height };
}

/** GPU tests for the Gigi-style technique runtime. */
export function techniqueTests(gpu: GPUContext): SelfTest[] {
  return [
    {
      name: 'technique: compute chain with aliased transient textures matches the CPU reference',
      run: async () => {
        const t = TechniqueInstance.create(gpu, chain());
        const plan = t.plan;
        const { pixels, w, h } = await run(gpu, t, 'result');
        const diff = maxDiff(pixels, expectChain(100, 60, 3, 0.9, 0.01, [1, 0.25, 0.5]));
        if (w !== 100 || h !== 60) throw new Error(`result is ${w}x${h}`);
        if (diff > 1) throw new Error(`max difference ${diff} levels`);
        if (plan.resources.get('t1')!.slot !== plan.resources.get('t3')!.slot || plan.resources.get('t2')!.slot !== plan.resources.get('t4')!.slot) throw new Error('t1/t3 and t2/t4 should share memory');
        const saved = plan.stats.bytes - plan.stats.bytesAliased;
        t.dispose();
        return `max diff ${diff}; ${plan.stats.slots} allocations for ${plan.resources.size} resources, ${saved} bytes saved by aliasing`;
      },
    },
    {
      name: 'technique: variables update uniforms; size variables recompile and keep working',
      run: async () => {
        const t = TechniqueInstance.create(gpu, chain());
        await run(gpu, t, 'result');
        t.setVariable('gain', 0.5); t.setVariable('tint', [0.5, 1, 0, 1]);
        const compiles = () => t.compileCount as number;
        if (compiles() !== 1) throw new Error('gain / tint must not recompile');
        const a = await run(gpu, t, 'result');
        const d1 = maxDiff(a.pixels, expectChain(100, 60, 3, 0.5, 0.01, [0.5, 1, 0]));
        const before = t.resource('t1');
        t.setVariable('width', 50);
        const b = await run(gpu, t, 'result');
        const d2 = maxDiff(b.pixels, expectChain(50, 60, 3, 0.5, 0.01, [0.5, 1, 0]));
        if (compiles() !== 2) throw new Error(`expected one recompile, got ${compiles() - 1}`);
        if (b.w !== 50) throw new Error(`result is ${b.w} wide after the resize`);
        if (d1 > 1 || d2 > 1) throw new Error(`max difference ${d1} / ${d2} levels`);
        if (t.resource('t1') === before) throw new Error('the resized texture should be a new allocation');
        t.dispose();
        return `uniform update diff ${d1}, resize 100 -> 50 diff ${d2}, ${compiles()} compiles`;
      },
    },
    {
      name: 'technique: a looped sub-graph (read-write storage, loopIndex) matches the CPU reference',
      run: async () => {
        const accumulate: Technique = {
          name: 'accumulate', variables: [{ name: 'gain', type: 'float', value: 1 }, { name: 'loopIndex', type: 'uint', value: 0, visibility: 'internal' }],
          resources: [r32('field', { visibility: 'imported' })],
          nodes: [{
            type: 'compute', name: 'update', workgroupSize: [8, 8], bindings: [{ resource: 'field', access: 'readwrite' }], dispatch: { like: 'field' },
            shader: { code: `/*$(Bindings)*/
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = /*$(Size:field)*/;
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2<i32>(id.xy);
  textureStore(field, p, vec4<f32>(textureLoad(field, p).x * /*$(Variable:gain)*/ + f32(/*$(Variable:loopIndex)*/) * 0.01, 0.0, 0.0, 0.0));
}` },
          }],
        };
        const tech: Technique = {
          name: 'looped', variables: VARIABLES,
          resources: [r32('t1', { size: [{ variable: 'width' }, { variable: 'height' }] }), { kind: 'texture', name: 'result', format: 'rgba8unorm', like: 't1', visibility: 'exported' }],
          nodes: [GEN, { type: 'subgraph', name: 'acc', technique: accumulate, inputs: { field: 't1' }, variables: { gain: { bind: 'gain' } }, loop: 4 }, toImage('t1')],
        };
        const t = TechniqueInstance.create(gpu, tech);
        const names = t.plan.steps.map((s) => s.node.path).join(',');
        const { pixels } = await run(gpu, t, 'result');
        const diff = maxDiff(pixels, expectChain(100, 60, 4, 0.9, 0, [1, 0.25, 0.5], (i) => i * 0.01));
        t.dispose();
        if (diff > 1) throw new Error(`max difference ${diff} levels (order: ${names})`);
        return `4 unrolled iterations, max diff ${diff}`;
      },
    },
    {
      name: 'technique: a draw node renders into an imported texture; variables and imports are checked',
      run: async () => {
        const { device } = gpu;
        const tint: NodeDecl = {
          type: 'draw', name: 'fill', bindings: [], colorTargets: [{ resource: 'screen' }], vertexCount: 3,
          shader: { code: `
@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  return vec4<f32>(p, 0.0, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4<f32> { return /*$(Variable:tint)*/; }` },
        };
        const tech: Technique = { name: 'fill', variables: [{ name: 'tint', type: 'float4', value: [1, 0, 0, 1] }], resources: [{ kind: 'texture', name: 'screen', format: 'rgba8unorm', visibility: 'imported', size: [16, 16] }], nodes: [tint] };
        const t = TechniqueInstance.create(gpu, tech);
        const bad = device.createTexture({ size: [16, 16], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
        let usageError = '', formatError = '', missingError = '';
        try { t.setImport('screen', bad); } catch (e) { usageError = String(e); }
        const wrongFormat = device.createTexture({ size: [16, 16], format: 'bgra8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
        try { t.setImport('screen', wrongFormat); } catch (e) { formatError = String(e); }
        try { t.execute(device.createCommandEncoder()); } catch (e) { missingError = String(e); }
        if (!/lacks usage/.test(usageError) || !/expected rgba8unorm/.test(formatError) || !/not been attached/.test(missingError)) throw new Error(`import checks: ${usageError} | ${formatError} | ${missingError}`);
        const screen = device.createTexture({ size: [16, 16], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        t.setImport('screen', screen);
        const read = async () => { const enc = device.createCommandEncoder(); t.execute(enc); device.queue.submit([enc.finish()]); return readTextureRGBA8(device, screen, 0, 16, 16); };
        const red = await read();
        t.setVariable('tint', [0, 0.5, 1, 1]);
        const blue = await read();
        const at = (p: Uint8Array) => [p[8 * 64 + 8 * 4], p[8 * 64 + 8 * 4 + 1], p[8 * 64 + 8 * 4 + 2]].join(',');
        if (at(red) !== '255,0,0' || at(blue) !== '0,128,255') throw new Error(`pixels ${at(red)} then ${at(blue)}`);
        if (t.compileCount !== 1) throw new Error('a non-structural variable must not recompile');
        screen.destroy(); bad.destroy(); wrongFormat.destroy(); t.dispose();
        return `rendered ${at(red)} then ${at(blue)} after a variable change, imports validated, no recompile`;
      },
    },
  ];
}
