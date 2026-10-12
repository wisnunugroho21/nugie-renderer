import type { GPUContext } from '../gpu/GPUContext';
import { TechniqueInstance } from '../rendering/graph/TechniqueInstance';
import { technique, wgsl, bindings } from '../rendering/graph/TechniqueBuilder';
import type { ComputeNode, NodeDecl, Technique } from '../rendering/graph/TechniqueTypes';
import { TrackedRenderPass } from '../rendering/graph/TrackedRenderPass';
import { readBuffer, readTextureRGBA8, type SelfTest } from './harness';

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
    {
      name: 'technique builder: a code-built technique runs on the GPU (imported texture in, threshold out)',
      run: async () => {
        const g = technique('threshold');
        const level = g.float('level', 0.5);
        const src = g.texture('src', { format: 'rgba8unorm', size: [16, 8], visibility: 'imported' });
        const out = g.texture('out', { like: src, visibility: 'exported' });
        g.compute('cut', {
          reads: [src], writes: [out], dispatch: { like: out },
          shader: wgsl`${bindings}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let p = vec2<i32>(id.xy);
  let c = textureLoad(${src}, p, 0);
  textureStore(${out}, p, select(vec4<f32>(0.0), c, c.r > ${level}));
}`,
        });
        const device = gpu.device;
        const input = device.createTexture({ size: [16, 8], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        const bytes = new Uint8Array(16 * 8 * 4);
        for (let i = 0; i < 16 * 8; i++) bytes.set([(i * 2) & 255, 40, 200, 255], i * 4);
        device.queue.writeTexture({ texture: input }, bytes, { bytesPerRow: 64 }, [16, 8]);
        const fx = g.instantiate(gpu, { imports: { src: input } });
        const expected = (threshold: number) => Uint8Array.from(bytes, (v, i) => (bytes[i - (i & 3)] / 255 > threshold ? v : 0));   // a pixel passes when its red channel does
        const first = await run(gpu, fx, 'out');
        fx.setVariable('level', 0.75);
        const second = await run(gpu, fx, 'out');
        const d1 = maxDiff(first.pixels, expected(0.5)), d2 = maxDiff(second.pixels, expected(0.75));
        input.destroy(); fx.dispose();
        if (d1 !== 0 || d2 !== 0) throw new Error(`differences ${d1} / ${d2}`);
        return 'threshold 0.5 then 0.75 (variable updated between runs): exact match';
      },
    },
    {
      name: 'technique: toggling a conditional node keeps the exported texture; a resize replaces it and notifies the host',
      run: async () => {
        const g = technique('toggle');
        const mode = g.int('mode', 0), size = g.uint('size', 16);
        const src = g.texture('src', { format: 'rgba8unorm', size: [size, size] });
        const out = g.texture('out', { format: 'rgba8unorm', like: src, visibility: 'exported' });
        const fill = (name: string, dst: typeof out, when: ReturnType<typeof mode.eq>) => g.compute(name, {
          writes: [dst], dispatch: { like: dst }, workgroupSize: [8, 8], when,
          shader: wgsl`${bindings}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3<u32>) { textureStore(${dst}, vec2<i32>(id.xy), vec4<f32>(${name === 'a' ? '1.0, 0.0, 0.0' : '0.0, 0.0, 1.0'}, 1.0)); }`,
        });
        fill('a', out, mode.eq(0));
        // mode 1: render the source (filled blue by 'b') through a copy, so the exported texture is written in a different way
        fill('b', src, mode.eq(1));
        g.copy('copy', src, out, { when: mode.eq(1) });
        const fx = g.instantiate(gpu);
        const first = fx.resource('out');
        const replaced: string[][] = [];
        fx.onResourcesReplaced((names) => replaced.push(names));
        const red = await run(gpu, fx, 'out');
        fx.setVariable('mode', 1);
        const blue = await run(gpu, fx, 'out');
        const same = fx.resource('out') === first;
        fx.setVariable('mode', 0);
        await run(gpu, fx, 'out');
        fx.setVariable('size', 32);
        const big = await run(gpu, fx, 'out');
        const pixel = (p: Uint8Array) => `${p[0]},${p[1]},${p[2]}`;
        fx.dispose();
        if (pixel(red.pixels) !== '255,0,0' || pixel(blue.pixels) !== '0,0,255') throw new Error(`colours ${pixel(red.pixels)} / ${pixel(blue.pixels)}`);
        if (!same) throw new Error('the exported texture was replaced by a condition toggle');
        if (big.w !== 32) throw new Error(`resize gave ${big.w}`);
        if (replaced.length !== 1 || !replaced[0].includes('out')) throw new Error(`replacement notifications: ${JSON.stringify(replaced)}`);
        return 'texture kept across 3 condition toggles; resize 16 -> 32 replaced it and notified once';
      },
    },
    {
      name: 'technique draw: a compute-generated vertex buffer feeds an MSAA target that is resolved (edges are anti-aliased)',
      run: async () => {
        const g = technique('msaa-triangle');
        const verts = g.buffer('verts', { element: 'f32', stride: 20, count: 3 });
        const msaa = g.texture('msaa', { format: 'rgba8unorm', size: [16, 16], samples: 4 });
        const out = g.texture('out', { like: msaa, visibility: 'exported' });
        g.compute('gen', {
          writes: [verts], dispatch: { threads: [3] }, workgroupSize: [3],
          shader: wgsl`${bindings}
@compute @workgroup_size(3) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  // lower-left triangle: (-1,-1) (1,-1) (-1,1), all red
  let i = id.x;
  let x = select(-1.0, 1.0, i == 1u);
  let y = select(-1.0, 1.0, i == 2u);
  let o = i * 5u;
  ${verts}[o] = x; ${verts}[o + 1u] = y; ${verts}[o + 2u] = 1.0; ${verts}[o + 3u] = 0.0; ${verts}[o + 4u] = 0.0;
}`,
        });
        g.draw('tri', {
          vertexBuffers: [{ resource: verts, attributes: [{ location: 0, format: 'float32x2', offset: 0 }, { location: 1, format: 'float32x3', offset: 8 }] }],
          colorTargets: [{ resource: msaa, resolve: out, storeOp: 'discard' }],
          shader: wgsl`
struct VOut { @builtin(position) p: vec4<f32>, @location(0) c: vec3<f32> };
@vertex fn vs_main(@location(0) pos: vec2<f32>, @location(1) col: vec3<f32>) -> VOut { return VOut(vec4<f32>(pos, 0.0, 1.0), col); }
@fragment fn fs_main(v: VOut) -> @location(0) vec4<f32> { return vec4<f32>(v.c, 1.0); }`,
        });
        const fx = g.instantiate(gpu);
        const { pixels, w } = await run(gpu, fx, 'out');
        const at = (x: number, y: number) => Array.from(pixels.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
        const partial = Array.from({ length: 16 * 16 }, (_, i) => pixels[i * 4 + 3]).filter((a) => a > 0 && a < 255).length;
        fx.dispose();
        const inside = at(2, 13).join(','), outside = at(13, 2).join(',');
        if (inside !== '255,0,0,255') throw new Error(`inside pixel ${inside}`);
        if (outside !== '0,0,0,0') throw new Error(`outside pixel ${outside}`);
        if (partial < 8) throw new Error(`only ${partial} anti-aliased edge pixels; the target was not multisampled`);
        return `vertex buffer written by compute, ${partial} anti-aliased edge pixels after the 4x resolve`;
      },
    },
    {
      name: 'technique draw: instance-stepped vertex buffer from the host; a stored MSAA target is read per sample by compute',
      run: async () => {
        const { device } = gpu;
        const g = technique('msaa-instances');
        const inst = g.buffer('inst', { element: 'f32', stride: 20, count: 2, visibility: 'imported' });
        const msaa = g.texture('msaa', { format: 'rgba8unorm', size: [16, 16], samples: 4 });
        const out = g.texture('out', { format: 'rgba8unorm', size: [16, 16], visibility: 'exported' });
        g.draw('quads', {
          vertices: 3,
          vertexBuffers: [{ resource: inst, stepMode: 'instance', attributes: [{ location: 0, format: 'float32x2', offset: 0 }, { location: 1, format: 'float32x3', offset: 8 }] }],
          colorTargets: [msaa],
          shader: wgsl`
struct VOut { @builtin(position) p: vec4<f32>, @location(0) c: vec3<f32> };
@vertex fn vs_main(@builtin(vertex_index) vi: u32, @location(0) offset: vec2<f32>, @location(1) col: vec3<f32>) -> VOut {
  var local = array<vec2<f32>, 3>(vec2<f32>(-0.4, -0.4), vec2<f32>(0.4, -0.4), vec2<f32>(-0.4, 0.4));
  return VOut(vec4<f32>(local[vi] + offset, 0.0, 1.0), col);
}
@fragment fn fs_main(v: VOut) -> @location(0) vec4<f32> { return vec4<f32>(v.c, 1.0); }`,
        });
        g.compute('average', {
          reads: [msaa], writes: [out], dispatch: { like: out }, workgroupSize: [8, 8],
          shader: wgsl`${bindings}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let p = vec2<i32>(id.xy);
  var sum = vec4<f32>(0.0);
  for (var s = 0; s < 4; s++) { sum += textureLoad(${msaa}, p, s); }
  textureStore(${out}, p, sum / 4.0);
}`,
        });
        const buffer = device.createBuffer({ size: 40, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        // instance 0: red at (-0.5,-0.5); instance 1: green at (0.5, 0.5)
        device.queue.writeBuffer(buffer, 0, new Float32Array([-0.5, -0.5, 1, 0, 0, 0.5, 0.5, 0, 1, 0]));
        const fx = g.instantiate(gpu, { imports: { inst: buffer } });
        const { pixels, w } = await run(gpu, fx, 'out');
        const at = (x: number, y: number) => Array.from(pixels.slice((y * w + x) * 4, (y * w + x) * 4 + 3)).join(',');
        fx.dispose(); buffer.destroy();
        const red = at(2, 13), green = at(10, 5), none = at(13, 13);
        if (red !== '255,0,0' || green !== '0,255,0' || none !== '0,0,0') throw new Error(`instances: red ${red}, green ${green}, empty ${none}`);
        return '2 instances from a per-instance buffer; 4 samples per pixel read with texture_multisampled_2d';
      },
    },
    {
      name: 'technique draw: validation errors for host resources (vertex usage, sample count)',
      run: async () => {
        const { device } = gpu;
        const g = technique('imports');
        const inst = g.buffer('verts', { element: 'f32', stride: 8, count: 3, visibility: 'imported' });
        const target = g.texture('target', { format: 'rgba8unorm', size: [8, 8], samples: 4, visibility: 'imported' });
        const resolved = g.texture('resolved', { like: target, visibility: 'imported' });
        g.draw('d', { shader: '@vertex fn vs_main(@location(0) p: vec2<f32>) -> @builtin(position) vec4<f32> { return vec4<f32>(p, 0.0, 1.0); } @fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }',
          vertexBuffers: [{ resource: inst, attributes: [{ location: 0, format: 'float32x2', offset: 0 }] }], colorTargets: [{ resource: target, resolve: resolved }] });
        const fx = g.instantiate(gpu);
        const noVertex = device.createBuffer({ size: 24, usage: GPUBufferUsage.COPY_DST });
        const single = device.createTexture({ size: [8, 8], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
        let vertexError = '', sampleError = '';
        try { fx.setImport('verts', noVertex); } catch (e) { vertexError = String(e); }
        try { fx.setImport('target', single); } catch (e) { sampleError = String(e); }
        fx.dispose(); noVertex.destroy(); single.destroy();
        if (!/lacks usage flags/.test(vertexError) || !/expected 4 sample/.test(sampleError)) throw new Error(`${vertexError} | ${sampleError}`);
        return 'a buffer without VERTEX usage and a single-sample texture for an MSAA import are both rejected';
      },
    },
    {
      name: 'technique draw: an indexed draw from a host uint16 index buffer with a byte offset',
      run: async () => {
        const { device } = gpu;
        const g = technique('indexed');
        const verts = g.buffer('verts', { element: 'f32', stride: 8, count: 4 });
        const idx = g.buffer('idx', { element: 'u32', count: 4, visibility: 'imported' });
        const out = g.texture('out', { format: 'rgba8unorm', size: [16, 16], visibility: 'exported' });
        g.compute('gen', {
          writes: [verts], dispatch: { threads: [4] }, workgroupSize: [4],
          shader: wgsl`${bindings}
@compute @workgroup_size(4) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  // left-half quad: (-1,-1) (0,-1) (0,1) (-1,1)
  let i = id.x;
  ${verts}[i * 2u] = select(-1.0, 0.0, i == 1u || i == 2u);
  ${verts}[i * 2u + 1u] = select(-1.0, 1.0, i >= 2u);
}`,
        });
        g.draw('quad', {
          vertexBuffers: [{ resource: verts, attributes: [{ location: 0, format: 'float32x2', offset: 0 }] }],
          indexBuffer: { resource: idx, format: 'uint16', offset: 4 }, colorTargets: [out],
          shader: '@vertex fn vs_main(@location(0) p: vec2<f32>) -> @builtin(position) vec4<f32> { return vec4<f32>(p, 0.0, 1.0); } @fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }',
        });
        // two leading indices (3, 3) are skipped by the offset; without it the quad would be degenerate / wrong
        const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(buffer, 0, new Uint16Array([3, 3, 0, 1, 2, 0, 2, 3]));
        const fx = g.instantiate(gpu, { imports: { idx: buffer } });
        const { pixels, w } = await run(gpu, fx, 'out');
        const at = (x: number, y: number) => Array.from(pixels.slice((y * w + x) * 4, (y * w + x) * 4 + 4)).join(',');
        fx.dispose(); buffer.destroy();
        if (at(2, 8) !== '255,0,0,255' || at(13, 8) !== '0,0,0,0') throw new Error(`left ${at(2, 8)}, right ${at(13, 8)}`);
        return 'quad drawn from 6 uint16 indices starting at byte 4';
      },
    },
    {
      name: 'technique draw: baseVertex, indexed indirect (arguments from compute) and non-indexed indirect',
      run: async () => {
        const { device } = gpu;
        const shader = '@vertex fn vs_main(@location(0) p: vec2<f32>) -> @builtin(position) vec4<f32> { return vec4<f32>(p, 0.0, 1.0); } @fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }';
        // 8 vertices: 0-3 are the right-half quad (decoy), 4-7 the left-half quad
        const quad = (x0: number, x1: number) => [x0, -1, x1, -1, x1, 1, x0, 1];
        const vertexData = new Float32Array([...quad(0, 1), ...quad(-1, 0)]);
        const mk = (usage: number, data: Float32Array | Uint16Array | Uint32Array) => { const b = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength); return b; };
        const verts = mk(GPUBufferUsage.VERTEX, vertexData), indices = mk(GPUBufferUsage.INDEX, new Uint16Array([0, 1, 2, 0, 2, 3]));
        const pixelsOf = async (g: ReturnType<typeof technique>, imports: Record<string, GPUBuffer>) => {
          const fx = g.instantiate(gpu, { imports });
          const { pixels, w } = await run(gpu, fx, 'out');
          fx.dispose();
          return (x: number, y: number) => Array.from(pixels.slice((y * w + x) * 4, (y * w + x) * 4 + 4)).join(',');
        };
        const expectLeft = (at: (x: number, y: number) => string, what: string) => {
          if (at(2, 8) !== '255,0,0,255' || at(13, 8) !== '0,0,0,0') throw new Error(`${what}: left ${at(2, 8)}, right ${at(13, 8)}`);
        };
        const base = () => {
          const g = technique('ib');
          const v = g.buffer('verts', { element: 'f32', stride: 8, count: 8, visibility: 'imported' }), i = g.buffer('idx', { element: 'u32', count: 3, visibility: 'imported' });
          const out = g.texture('out', { format: 'rgba8unorm', size: [16, 16], visibility: 'exported' });
          return { g, v, i, out };
        };
        const attributes = [{ location: 0, format: 'float32x2' as const, offset: 0 }];

        // 1. baseVertex 4 moves the indices 0..3 onto vertices 4..7
        const a = base();
        a.g.draw('d', { shader, vertexBuffers: [{ resource: a.v, attributes }], indexBuffer: { resource: a.i, format: 'uint16' }, indices: 6, baseVertex: 4, colorTargets: [a.out] });
        expectLeft(await pixelsOf(a.g, { verts, idx: indices }), 'baseVertex');

        // 2. indexed indirect: a compute node writes (indexCount 6, instances 1, firstIndex 0, baseVertex 4, firstInstance 0)
        const b = base();
        const args = b.g.buffer('args', { element: 'u32', count: 5 });
        b.g.compute('args', {
          writes: [args], dispatch: { threads: [1] }, workgroupSize: [1],
          shader: wgsl`${bindings}
@compute @workgroup_size(1) fn main() { ${args}[0] = 6u; ${args}[1] = 1u; ${args}[2] = 0u; ${args}[3] = 4u; ${args}[4] = 0u; }`,
        });
        b.g.draw('d', { shader, vertexBuffers: [{ resource: b.v, attributes }], indexBuffer: { resource: b.i, format: 'uint16' }, indirect: { resource: args }, colorTargets: [b.out] });
        expectLeft(await pixelsOf(b.g, { verts, idx: indices }), 'indexed indirect');

        // 3. non-indexed indirect, from the host, starting at byte 8 of the buffer: 3 procedural vertices covering the whole target
        const c = technique('direct');
        const argBuf = c.buffer('args', { element: 'u32', count: 6, visibility: 'imported' });
        const out = c.texture('out', { format: 'rgba8unorm', size: [16, 16], visibility: 'exported' });
        c.draw('d', { indirect: { resource: argBuf, offset: 8 }, colorTargets: [out],
          shader: '@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> { let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0; return vec4<f32>(p, 0.0, 1.0); } @fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }' });
        const argData = mk(GPUBufferUsage.INDIRECT, new Uint32Array([9, 9, 3, 1, 0, 0]));
        const full = await pixelsOf(c, { args: argData });
        if (full(8, 8) !== '0,255,0,255' || full(1, 14) !== '0,255,0,255') throw new Error(`indirect: ${full(8, 8)} / ${full(1, 14)}`);
        verts.destroy(); indices.destroy(); argData.destroy();
        return 'baseVertex 4 and indexed indirect select the left quad; a non-indexed indirect draw at byte offset 8 fills the target';
      },
    },
    {
      name: 'technique: bindings in three @groups, a uniform buffer picked by a dynamic offset (one run per view)',
      run: async () => {
        const { device } = gpu;
        const g = technique('views');
        const slot = g.uint('slot');
        const views = g.importedBuffer('views', 'ViewData', 256);
        const scale = g.importedBuffer('scale', 'f32');
        const out = g.importedBuffer('out', 'vec4<f32>');
        g.compute('mix', {
          workgroupSize: [1], dispatch: { threads: [1] },
          // group 0: the output (and the variables); group 1: this view's data, a 256-byte slot chosen by the dynamic offset; group 2: a shared scale
          reads: [{ resource: views, name: 'view', uniform: true, dynamicOffset: true, group: 1 }, { resource: scale, group: 2 }], writes: [out],
          shader: wgsl`
struct ViewData { color: vec4<f32> };
@compute @workgroup_size(1) fn main() { ${out}[${slot}] = view.color * scale[0]; }`,
        });
        const viewBuffer = device.createBuffer({ size: 768, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const data = new Float32Array(192);
        for (let i = 0; i < 3; i++) data.set([i + 1, 10 * (i + 1), 0.5, 1], i * 64);      // slot i starts at byte 256 * i
        device.queue.writeBuffer(viewBuffer, 0, data);
        const scaleBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(scaleBuffer, 0, new Float32Array([2, 0, 0, 0]));
        const outBuffer = device.createBuffer({ size: 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        const fx = g.instantiate(gpu, { imports: { views: viewBuffer, scale: scaleBuffer, out: outBuffer } });
        for (let view = 0; view < 3; view++) {
          fx.setVariable('slot', view);                       // uniforms are written when the technique executes: submit between runs
          fx.setDynamicOffset('mix', 'view', view * 256);
          const enc = device.createCommandEncoder();
          fx.execute(enc);
          device.queue.submit([enc.finish()]);
        }
        const result = new Float32Array(await readBuffer(device, outBuffer, 48));
        let misaligned = '';
        try { fx.setDynamicOffset('mix', 'view', 100); } catch (e) { misaligned = String(e); }
        fx.dispose(); viewBuffer.destroy(); scaleBuffer.destroy(); outBuffer.destroy();
        const expected = [2, 20, 1, 2, 4, 40, 1, 2, 6, 60, 1, 2];
        if (expected.some((v, i) => result[i] !== v)) throw new Error(`result ${Array.from(result).join(',')} (expected ${expected.join(',')})`);
        if (!/multiple of/.test(misaligned)) throw new Error(`a misaligned offset was accepted: ${misaligned}`);
        return '3 views read from one uniform buffer at offsets 0 / 256 / 512, with a third group of shared data';
      },
    },
    {
      name: 'technique render node: host pipelines and per-draw bind groups with dynamic offsets, redundant state skipped',
      run: async () => {
        const { device } = gpu;
        const module = device.createShaderModule({ code: `
struct V { @builtin(position) p: vec4<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> V {
  var q = array<vec2<f32>, 6>(vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0));
  return V(vec4<f32>(q[vi].x - 1.0 + f32(ii), q[vi].y, 0.0, 1.0));      // instance 0: left half, instance 1: right half
}
struct C { color: vec4<f32> };
@group(0) @binding(0) var<uniform> c: C;
@fragment fn plain() -> @location(0) vec4<f32> { return c.color; }
@fragment fn inverted() -> @location(0) vec4<f32> { return vec4<f32>(vec3<f32>(1.0) - c.color.rgb, 1.0); }` });
        const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } }] });
        const pipeline = (entry: string) => device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
          vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: entry, targets: [{ format: 'rgba8unorm' }] },
        });
        const plain = pipeline('plain'), inverted = pipeline('inverted');
        const colors = device.createBuffer({ size: 768, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(colors, 0, new Float32Array([1, 0, 0, 1]));            // slot 0: red
        device.queue.writeBuffer(colors, 256, new Float32Array([0, 1, 0, 1]));          // slot 1: green
        const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: colors, size: 16 } }] });

        const g = technique('render-node');
        const out = g.texture('out', { format: 'rgba8unorm', size: [16, 16], visibility: 'exported' });
        let stats = '';
        g.renderPass('draws', {
          colorTargets: [out],
          record: (pass) => {
            pass.setPipeline(plain); pass.setBindGroup(0, bindGroup, [0]);   pass.draw(6, 1, 0, 0);     // left half, red
            pass.setPipeline(plain); pass.setBindGroup(0, bindGroup, [256]); pass.draw(6, 1, 0, 1);     // right half, green: same pipeline (skipped), other offset
            pass.setPipeline(inverted);                                                                // a third draw over the left half with the other pipeline
            pass.setBindGroup(0, bindGroup, [0]); pass.draw(6, 1, 0, 0);
            stats = `${pass.drawCalls} draws, pipeline ${pass.switches.pipeline}/${pass.skipped.pipeline} (set/skipped), bind group ${pass.switches.bindGroup}`;
          },
        });
        const fx = g.instantiate(gpu);
        const { pixels, w } = await run(gpu, fx, 'out');
        const at = (x: number, y: number) => Array.from(pixels.slice((y * w + x) * 4, (y * w + x) * 4 + 3)).join(',');
        fx.dispose(); colors.destroy();
        // the inverted red (0,255,255) replaced the left half; the right half is still the green drawn with the second offset
        if (at(3, 8) !== '0,255,255' || at(12, 8) !== '0,255,0') throw new Error(`left ${at(3, 8)}, right ${at(12, 8)} (${stats})`);
        if (stats !== '3 draws, pipeline 2/1 (set/skipped), bind group 3') throw new Error(`unexpected state tracking: ${stats}`);
        return stats;
      },
    },
    {
      name: 'technique render node: ordered segments share one tracker; a replayed render bundle invalidates it',
      run: async () => {
        const { device } = gpu;
        const module = device.createShaderModule({ code: `
struct V { @builtin(position) p: vec4<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> V {
  var q = array<vec2<f32>, 6>(vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0));
  return V(vec4<f32>(q[vi].x - 1.0 + f32(ii), q[vi].y, 0.0, 1.0));      // instance 0: left half, instance 1: right half
}
struct C { color: vec4<f32> };
@group(0) @binding(0) var<uniform> c: C;
@fragment fn fs() -> @location(0) vec4<f32> { return c.color; }` });
        const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
        const pipeline = device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
          vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
        });
        const make = (rgba: number[]) => {
          const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
          device.queue.writeBuffer(buffer, 0, new Float32Array(rgba));
          return { buffer, group: device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer } }] }) };
        };
        const red = make([1, 0, 0, 1]), blue = make([0, 0, 1, 1]);
        const bundleEncoder = device.createRenderBundleEncoder({ colorFormats: ['rgba8unorm'] });
        const inBundle = new TrackedRenderPass(bundleEncoder);
        inBundle.setPipeline(pipeline); inBundle.setBindGroup(0, red.group); inBundle.draw(6, 1, 0, 0);     // left half, red, recorded once
        const bundle = bundleEncoder.finish();

        const g = technique('segments');
        const out = g.texture('out', { format: 'rgba8unorm', size: [16, 16], visibility: 'exported' });
        const log: string[] = [];
        let stats = '';
        g.renderPass('scene', { colorTargets: [out] });
        g.passSegment('scene', 'replay-bundle', { record: (pass) => { log.push('bundle'); pass.executeBundles([bundle]); } });
        g.passSegment('scene', 'blue-right', { record: (pass) => {
          log.push('blue');
          pass.setPipeline(pipeline); pass.setBindGroup(0, blue.group);                           // must reach the GPU: the bundle left the pass with nothing bound
          pass.draw(6, 1, 0, 1);
          pass.setPipeline(pipeline);                                                             // now really redundant
          stats = `pipeline ${pass.switches.pipeline}/${pass.skipped.pipeline} (set/skipped), bind group ${pass.switches.bindGroup}`;
        } });
        device.pushErrorScope('validation');
        const fx = g.instantiate(gpu);
        const { pixels, w } = await run(gpu, fx, 'out');
        const error = await device.popErrorScope();
        const at = (x: number, y: number) => Array.from(pixels.slice((y * w + x) * 4, (y * w + x) * 4 + 3)).join(',');
        fx.dispose(); red.buffer.destroy(); blue.buffer.destroy();
        if (error) throw new Error(`validation error: ${error.message}`);
        if (log.join() !== 'bundle,blue') throw new Error(`segment order ${log.join()}`);
        if (at(3, 8) !== '255,0,0' || at(12, 8) !== '0,0,255') throw new Error(`left ${at(3, 8)}, right ${at(12, 8)}`);
        if (stats !== 'pipeline 1/1 (set/skipped), bind group 1') throw new Error(`unexpected tracking after the bundle: ${stats}`);
        return `bundle then segment: ${stats}`;
      },
    },
    {
      name: 'technique copy / clear nodes: buffer ranges with a variable size, a clear, a mip into a texture region, texture to buffer with padded rows',
      run: async () => {
        const { device } = gpu;
        // buffers: src = 0..15; dst starts as all ones; zero it, copy src[4..11] (a variable number of bytes) to dst[2..], then clear dst[10..11]
        const src = device.createBuffer({ size: 64, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        const dst = device.createBuffer({ size: 64, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(src, 0, new Uint32Array(Array.from({ length: 16 }, (_, i) => i)));
        device.queue.writeBuffer(dst, 0, new Uint32Array(16).fill(0xffffffff));
        const g = technique('copies');
        const bytes = g.uint('bytes', 32);
        const s = g.importedBuffer('src', 'u32'), d = g.importedBuffer('dst', 'u32');
        g.clear('zero', d);
        g.copy('range', s, d, { from: { offset: 16 }, to: { offset: 8 }, size: [bytes] });
        g.clear('tail', d, { offset: 40, size: 8 });
        const fx = g.instantiate(gpu, { imports: { src, dst } });
        const run1 = () => { const enc = device.createCommandEncoder(); fx.execute(enc); device.queue.submit([enc.finish()]); };
        run1();
        const first = Array.from(new Uint32Array(await readBuffer(device, dst, 64)));
        fx.setVariable('bytes', 16);
        run1();
        const second = Array.from(new Uint32Array(await readBuffer(device, dst, 64)));
        fx.dispose();
        const want1 = [0, 0, 4, 5, 6, 7, 8, 9, 10, 11, 0, 0, 0, 0, 0, 0], want2 = [0, 0, 4, 5, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        if (first.join() !== want1.join()) throw new Error(`buffer copy: ${first.join(',')}`);
        if (second.join() !== want2.join()) throw new Error(`after the size variable changed to 16 bytes: ${second.join(',')}`);

        // textures: mip 1 (4x4, one colour) of a goes to the 4x4 region at (2,2) of b; b is then read into a buffer with 256-byte rows
        const usage = GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
        const a = device.createTexture({ size: [8, 8], format: 'rgba8unorm', mipLevelCount: 2, usage });
        const b = device.createTexture({ size: [8, 8], format: 'rgba8unorm', usage });
        const level = (n: number, rgba: number[]) => { const px = new Uint8Array(n * n * 4); for (let i = 0; i < n * n; i++) px.set(rgba, i * 4); return px; };
        device.queue.writeTexture({ texture: a, mipLevel: 0 }, level(8, [200, 0, 0, 255]), { bytesPerRow: 32 }, [8, 8]);
        device.queue.writeTexture({ texture: a, mipLevel: 1 }, level(4, [10, 20, 30, 255]), { bytesPerRow: 16 }, [4, 4]);
        device.queue.writeTexture({ texture: b }, level(8, [0, 0, 0, 0]), { bytesPerRow: 32 }, [8, 8]);
        const out = device.createBuffer({ size: 2048, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        const t = technique('texture-copies');
        const ta = t.texture('a', { format: 'rgba8unorm', size: [8, 8], mips: 2, visibility: 'imported' }), tb = t.texture('b', { format: 'rgba8unorm', size: [8, 8], visibility: 'imported' });
        const to = t.importedBuffer('out', 'u32');
        t.copy('mip-to-region', ta, tb, { from: { mip: 1 }, to: { origin: [2, 2] }, size: [4, 4] });
        t.copy('read-back', tb, to, { size: [8, 8] });
        const tx = t.instantiate(gpu, { imports: { a, b, out } });
        const enc = device.createCommandEncoder(); tx.execute(enc); device.queue.submit([enc.finish()]);
        const bytesOut = new Uint8Array(await readBuffer(device, out, 2048));
        tx.dispose(); a.destroy(); b.destroy(); out.destroy(); src.destroy(); dst.destroy();
        const px = (x: number, y: number) => Array.from(bytesOut.subarray(y * 256 + x * 4, y * 256 + x * 4 + 4)).join(',');
        const inside = [2, 3, 5].every((x) => [2, 4, 5].every((y) => px(x, y) === '10,20,30,255')), outside = [0, 1, 6, 7].every((x) => px(x, 3) === '0,0,0,0' && px(3, x) === '0,0,0,0');
        if (!inside || !outside) throw new Error(`region copy: inside ${px(3, 3)}, outside ${px(0, 3)} / ${px(7, 7)}`);
        return 'buffer range + variable size + clear, mip 1 into a 4x4 region, 8x8 texels read with 256-byte rows';
      },
    },
  ];
}
