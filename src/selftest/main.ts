import { GPUContext } from '../gpu/GPUContext';
import { createBindLayouts } from '../gpu/BindLayouts';
import { MeshManager } from '../rendering/MeshManager';
import { JointMatrixBuffer } from '../rendering/JointMatrixBuffer';
import { MorphWeightBuffer } from '../rendering/MorphWeightBuffer';
import { RenderWorld } from '../rendering/RenderWorld';
import { MipmapGenerator } from '../gpu/MipmapGenerator';
import { registerEngineShaderChunks } from '../shaders';
import { STANDARD_VERTEX_FLOATS as F } from '../rendering/VertexLayouts';
import { Mat4 } from '../math/Mat4';
import { Quat } from '../math/Quat';
import { deformVertexRef, type RefMorph } from '../animation/reference';
import { packActiveMorphWeights } from '../rendering/MorphPacking';
import { Rng, readBuffer, readTextureRGBA8, type SelfTest } from './harness';
import { particleTests } from './particleTests';
import { lightingTests } from './lightingTests';
import { iblTests } from './iblTests';
import { clusterTests } from './clusterTests';
import { hizTests } from './hizTests';
import { fogTests } from './fogTests';
import { ribbonTests } from './ribbonTests';

const out = document.getElementById('out')!;

const DEFORM_TEST_WGSL = /* wgsl */ `
//#include common_types
//#include common_bind_object
//#include common_funcs

@group(0) @binding(0) var<storage, read> vin: array<vec4<f32>>;          // 3 vec4 per vertex: position, normal, tangent
@group(0) @binding(1) var<storage, read_write> vout: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: vec4<u32>;                    // x = vertex count

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.x) { return; }
  let inst = instances[0];
  // The real draw passes vertex_index which INCLUDES baseVertex; emulate exactly that.
  let d = deformVertex(inst, inst.vertexBase + i, vin[i * 3u].xyz, vin[i * 3u + 1u].xyz, vin[i * 3u + 2u].xyz);
  vout[i * 3u] = vec4<f32>(d.position, 0.0);
  vout[i * 3u + 1u] = vec4<f32>(d.normal, 0.0);
  vout[i * 3u + 2u] = vec4<f32>(d.tangent, 0.0);
}
`;

async function setup() {
  const gpu = await GPUContext.create(document.getElementById('canvas') as HTMLCanvasElement);
  return { gpu, device: gpu.device };
}

/** WGSL deformVertex() vs the CPU reference for static / morph / skin / skin+morph. */
function deformParityTest(gpu: GPUContext, variant: { skin: boolean; morph: boolean }): () => Promise<string> {
  return async () => {
    const { device, resources: res } = gpu;
    registerEngineShaderChunks(res.shaders);
    const layouts = createBindLayouts(device);
    const meshes = new MeshManager(device, res.buffers);
    const joints = new JointMatrixBuffer(device, res.buffers);
    const morphW = new MorphWeightBuffer(device, res.buffers);
    const rng = new Rng(1234 + (variant.skin ? 1 : 0) + (variant.morph ? 2 : 0));

    // --- random mesh
    const N = 1500, J = 7, T = 3;
    const verts = new Float32Array(N * F), base: { position: number[]; normal: number[]; tangent: number[] }[] = [];
    for (let i = 0; i < N; i++) {
      const p = [rng.range(-2, 2), rng.range(-2, 2), rng.range(-2, 2)], n = rng.unit3(), t = rng.unit3();
      verts.set([...p, ...n, 0, 0, ...t, 1], i * F);
      base.push({ position: p, normal: n, tangent: t });
    }
    const joints0 = new Uint16Array(N * 4), weights0 = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      let sum = 0; const w = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) { joints0[i * 4 + k] = Math.floor(rng.range(0, J)); w[k] = rng.next() < 0.25 ? 0 : rng.next(); sum += w[k]; }
      if (sum === 0) { w[0] = 1; sum = 1; }
      for (let k = 0; k < 4; k++) weights0[i * 4 + k] = w[k] / sum;
    }
    const targets: RefMorph[] = Array.from({ length: T }, (_, k) => {
      const mk = (scale: number) => Float32Array.from({ length: N * 3 }, () => rng.range(-scale, scale));
      return { position: mk(0.4), normal: k === 1 ? undefined : mk(0.2), tangent: k === 2 ? mk(0.2) : undefined };
    });
    const meshId = meshes.create('parity', { vertices: verts, indices: Uint32Array.from([0, 1, 2]) }, {
      joints0: variant.skin ? joints0 : undefined, weights0: variant.skin ? weights0 : undefined,
      morphTargets: variant.morph ? targets : undefined,
    });
    const mesh = meshes.get(meshId);

    // --- random joint matrices + morph weights
    const jointOffset = joints.allocate(J);
    for (let j = 0; j < J; j++) {
      const q = Quat.normalize(Quat.create(), [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)]);
      const s = rng.range(0.6, 1.4);
      Mat4.compose(joints.cpu, rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1), q[0], q[1], q[2], q[3], s, s, s, (jointOffset + j) * 16);
    }
    joints.markDirty(jointOffset, J); joints.flush();
    const weights = [rng.range(0, 1), 0, rng.range(-0.5, 1)];
    const rw = new RenderWorld();
    const activeCount = packActiveMorphWeights(weights, 0, T, rw.morph.pool, 0);   // same packing the engine uses
    rw.morph.changedRanges.push(0, activeCount * 2);
    morphW.sync(rw);

    // --- instance record
    const inst = new Uint32Array(12);
    inst[0] = 0; inst[1] = 0; inst[2] = jointOffset; inst[3] = variant.skin ? J : 0; inst[4] = 0; inst[5] = variant.morph ? activeCount : 0;
    inst[7] = mesh.baseVertex; inst[8] = mesh.vertexCount; inst[9] = mesh.skinBase; inst[10] = mesh.morphBase; inst[11] = mesh.deformMask;
    const instBuf = res.buffers.createWithData('inst', inst, GPUBufferUsage.STORAGE);
    const dummy = res.buffers.create('dummy-transforms', 64, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);

    // --- IO
    const vin = new Float32Array(N * 12);
    base.forEach((b, i) => vin.set([...b.position, 0, ...b.normal, 0, ...b.tangent, 0], i * 12));
    const vinBuf = res.buffers.createWithData('vin', vin, GPUBufferUsage.STORAGE);
    const voutBuf = res.buffers.create('vout', N * 48, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const params = res.buffers.createWithData('params', new Uint32Array([N, 0, 0, 0]), GPUBufferUsage.UNIFORM);
    const ioLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ] });
    const empty = device.createBindGroupLayout({ entries: [] });
    const module = res.shaders.get('deform-parity', DEFORM_TEST_WGSL, { HAS_SKINNING: variant.skin, HAS_MORPH_TARGETS: variant.morph });
    const pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [ioLayout, empty, empty, layouts.object] }),
      compute: { module, entryPoint: 'main' },
    });
    const bgIO = device.createBindGroup({ layout: ioLayout, entries: [
      { binding: 0, resource: { buffer: vinBuf } }, { binding: 1, resource: { buffer: voutBuf } }, { binding: 2, resource: { buffer: params } }] });
    const bgObj = device.createBindGroup({ layout: layouts.object, entries: [
      { binding: 0, resource: { buffer: dummy } }, { binding: 1, resource: { buffer: instBuf } }, { binding: 2, resource: { buffer: joints.buffer } },
      { binding: 3, resource: { buffer: morphW.buffer } }, { binding: 4, resource: { buffer: meshes.skin.buffer } },
      { binding: 5, resource: { buffer: meshes.morphPosition.buffer } }, { binding: 6, resource: { buffer: meshes.morphNormal.buffer } },
      { binding: 7, resource: { buffer: meshes.morphTangent.buffer } }] });
    const emptyBG = device.createBindGroup({ layout: empty, entries: [] });
    device.pushErrorScope('validation');
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bgIO); pass.setBindGroup(1, emptyBG); pass.setBindGroup(2, emptyBG); pass.setBindGroup(3, bgObj);
    pass.dispatchWorkgroups(Math.ceil(N / 64));
    pass.end();
    device.queue.submit([enc.finish()]);
    const err = await device.popErrorScope();
    if (err) throw new Error('validation error: ' + err.message);

    const got = new Float32Array(await readBuffer(device, voutBuf, N * 48));
    // --- compare with CPU reference
    let maxErr = 0;
    for (let i = 0; i < N; i++) {
      const ref = deformVertexRef(i, base[i],
        variant.morph ? { targets, weights } : null,
        variant.skin ? { joints: joints0, weights: weights0, matrices: joints.cpu, jointOffset } : null);
      for (let c = 0; c < 3; c++) {
        maxErr = Math.max(maxErr, Math.abs(got[i * 12 + c] - ref.position[c]), Math.abs(got[i * 12 + 4 + c] - ref.normal[c]), Math.abs(got[i * 12 + 8 + c] - ref.tangent[c]));
      }
    }
    if (!(maxErr < 2e-3)) throw new Error(`max |GPU - CPU| = ${maxErr.toExponential(2)} (limit 2e-3)`);
    return `max error ${maxErr.toExponential(2)} over ${N} vertices`;
  };
}

async function vertexIndexTest(gpu: GPUContext): Promise<string> {
  const { device } = gpu;
  const module = device.createShaderModule({ code: `
    @group(0) @binding(0) var<storage, read_write> outBuf: array<u32>;
    struct VSOut { @builtin(position) p: vec4<f32>, @location(0) @interpolate(flat) vid: u32 };
    @vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) pos: vec2<f32>) -> VSOut { var o: VSOut; o.p = vec4<f32>(pos, 0.0, 1.0); o.vid = vi; return o; }
    @fragment fn fs(in: VSOut) -> @location(0) vec4<f32> { outBuf[0] = in.vid; return vec4<f32>(1.0); }` });
  const verts = new Float32Array(16); verts.set([-1, -1, 3, -1, -1, 3], 10);
  const vb = device.createBuffer({ size: 64, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(vb, 0, verts);
  const ib = device.createBuffer({ size: 16, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(ib, 0, new Uint32Array([0, 1, 2, 0]));
  const ob = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'storage' } }] });
  const pipe = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  const tex = device.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipe); pass.setBindGroup(0, device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ob } }] }));
  pass.setVertexBuffer(0, vb); pass.setIndexBuffer(ib, 'uint32'); pass.drawIndexed(3, 1, 0, 5, 0); pass.end();
  device.queue.submit([enc.finish()]);
  const id = new Uint32Array(await readBuffer(device, ob, 16))[0];
  if (id !== 5) throw new Error(`vertex_index = ${id}, expected 5 (index 0 + baseVertex 5): shaders must NOT subtract baseVertex differently`);
  return 'vertex_index includes baseVertex (engine assumption holds on this device)';
}

async function mipmapTest(gpu: GPUContext, srgb: boolean): Promise<string> {
  const { device, resources: res } = gpu;
  const format: GPUTextureFormat = srgb ? 'rgba8unorm-srgb' : 'rgba8unorm';
  const tex = res.textures.create({ size: [2, 2], format, mipLevelCount: 2, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const px = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255]); // black white / white black
  device.queue.writeTexture({ texture: tex }, px, { bytesPerRow: 8 }, [2, 2]);
  new MipmapGenerator(device, res).generate(tex, format, 2);
  const m1 = await readTextureRGBA8(device, tex, 1, 1, 1);
  // average of black & white: 50% in LINEAR light => sRGB-encoded ~188; for linear (data) textures 128
  const expected = srgb ? 188 : 128;
  if (Math.abs(m1[0] - expected) > 3) throw new Error(`mip1 = ${m1[0]}, expected ~${expected}`);
  return `mip1 = ${m1[0]} (${srgb ? 'filtered in linear light then re-encoded' : 'plain average'})`;
}

(async () => {
  const results: { name: string; ok: boolean; msg: string }[] = [];
  try {
    const { gpu } = await setup();
    const tests: SelfTest[] = [
      { name: 'vertex_index includes baseVertex', run: () => vertexIndexTest(gpu) },
      { name: 'deformVertex parity: static', run: deformParityTest(gpu, { skin: false, morph: false }) },
      { name: 'deformVertex parity: morph only', run: deformParityTest(gpu, { skin: false, morph: true }) },
      { name: 'deformVertex parity: skin only', run: deformParityTest(gpu, { skin: true, morph: false }) },
      { name: 'deformVertex parity: morph -> skin', run: deformParityTest(gpu, { skin: true, morph: true }) },
      { name: 'mip generation: sRGB filtered in linear space', run: () => mipmapTest(gpu, true) },
      { name: 'mip generation: linear data textures', run: () => mipmapTest(gpu, false) },
      ...lightingTests(gpu),
      ...iblTests(gpu),
      ...clusterTests(gpu),
      ...hizTests(gpu),
      ...fogTests(gpu),
      ...particleTests(gpu),
      ...ribbonTests(gpu),
    ];
    for (const t of tests) {
      try { const m = await t.run(); results.push({ name: t.name, ok: true, msg: String(m ?? '') }); }
      catch (e) { results.push({ name: t.name, ok: false, msg: String(e) }); }
    }
    if (gpu.errors.length) results.push({ name: 'no uncaptured GPU errors', ok: false, msg: gpu.errors.join(' | ') });
    else results.push({ name: 'no uncaptured GPU errors', ok: true, msg: '' });
  } catch (e) {
    results.push({ name: 'setup', ok: false, msg: String(e) });
  }
  const pass = results.filter((r) => r.ok).length;
  out.innerHTML = results.map((r) => `<div class="${r.ok ? '' : 'fail'}">${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.msg ? ' - ' + r.msg : ''}</div>`).join('') + `<div>${pass}/${results.length} passed</div>`;
  (window as unknown as { __selftest: unknown }).__selftest = results;
  document.title = `DONE ${pass}/${results.length}`;
})();
