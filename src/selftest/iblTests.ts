import type { GPUContext } from '../gpu/GPUContext';
import { IBLBaker, type SkyParams } from '../rendering/lighting/IBL';
import { halfToFloat, encodeRGBE, parseRGBE } from '../assets/RGBE';
import { Rng, readBuffer, type SelfTest } from './harness';

/** Read one mip / layer of an rgba16float texture back as float32 RGBA. */
async function readTex16F(gpu: GPUContext, tex: GPUTexture, mip: number, layer: number): Promise<{ w: number; h: number; px: Float32Array }> {
  const w = Math.max(1, tex.width >> mip), h = Math.max(1, tex.height >> mip), bpr = Math.ceil(w * 8 / 256) * 256;
  const buf = gpu.resources.buffers.create('readback-16f', bpr * h, GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
  const enc = gpu.device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex, mipLevel: mip, origin: [0, 0, layer] }, { buffer: buf, bytesPerRow: bpr }, [w, h, 1]);
  gpu.device.queue.submit([enc.finish()]);
  const raw = new Uint16Array(await readBuffer(gpu.device, buf, bpr * h));
  const px = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) px[y * w * 4 + x] = halfToFloat(raw[y * (bpr / 2) + x]);
  return { w, h, px };
}

// TS mirrors of ibl_common.wgsl / ibl_sky.wgsl
function cubeTexelDir(face: number, x: number, y: number, size: number): number[] {
  const u = 2 * (x + 0.5) / size - 1, v = 2 * (y + 0.5) / size - 1;
  const d = [[1, -v, -u], [-1, -v, u], [u, 1, v], [u, -1, -v], [u, -v, 1], [-u, -v, -1]][face];
  const l = Math.hypot(d[0], d[1], d[2]);
  return d.map((c) => c / l);
}
function skyColor(p: SkyParams, d: number[]): number[] {
  const t = d[1] >= 0 ? Math.pow(d[1], 0.5) : Math.pow(-d[1], 0.5);
  const to = d[1] >= 0 ? p.zenith : p.ground;
  const c = [0, 1, 2].map((i) => p.horizon[i] + (to[i] - p.horizon[i]) * t);
  const sl = Math.hypot(...p.sunDirection), s = (d[0] * p.sunDirection[0] + d[1] * p.sunDirection[1] + d[2] * p.sunDirection[2]) / sl;
  return s > Math.cos(p.sunAngularRadius) ? [...p.sunColor] : c;
}

const SAMPLE_WGSL = /* wgsl */ `
@group(0) @binding(0) var cube: texture_cube<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<storage, read> dirs: array<vec4<f32>>;   // xyz = direction, w = lod
@group(0) @binding(3) var<storage, read_write> outv: array<vec4<f32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= arrayLength(&dirs)) { return; }
  let d = dirs[id.x];
  outv[id.x] = textureSampleLevel(cube, smp, d.xyz, d.w);
}`;

/** Sample `cube` at the given directions / lods on the GPU (hardware filtering and face selection). */
async function sampleCube(gpu: GPUContext, cube: GPUTextureView, dirs: Float32Array): Promise<Float32Array> {
  const { device, resources: r } = gpu, n = dirs.length / 4;
  const inB = r.buffers.create('sc-in', dirs.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  const outB = r.buffers.create('sc-out', dirs.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
  device.queue.writeBuffer(inB, 0, dirs);
  const pipe = device.createComputePipeline({ layout: 'auto', compute: { module: r.shaders.get('cube-sample', SAMPLE_WGSL), entryPoint: 'main' } });
  const bg = device.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: cube }, { binding: 1, resource: r.samplers.get({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' }) },
      { binding: 2, resource: { buffer: inB } }, { binding: 3, resource: { buffer: outB } }],
  });
  const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
  pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(Math.ceil(n / 64)); pass.end();
  device.queue.submit([enc.finish()]);
  return new Float32Array(await readBuffer(device, outB, dirs.byteLength));
}

const flatSky = (c: [number, number, number]): SkyParams => ({ zenith: c, horizon: c, ground: c, sunDirection: [0, 1, 0], sunColor: [0, 0, 0], sunAngularRadius: 0 });

// CPU reference of ibl_brdf.wgsl (double precision).
export function brdfRef(NoV: number, rough: number): [number, number] {
  const a = rough * rough, V = [Math.sqrt(1 - NoV * NoV), 0, NoV], N = 256;
  let A = 0, B = 0;
  for (let i = 0; i < N; i++) {
    let bits = i; bits = ((bits << 16) | (bits >>> 16)) >>> 0; bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
    bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0; bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
    bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
    const x1 = i / N, x2 = bits * 2.3283064365386963e-10, phi = 2 * Math.PI * x1;
    const cosT = Math.sqrt((1 - x2) / (1 + (a * a - 1) * x2)), sinT = Math.sqrt(Math.max(1 - cosT * cosT, 0));
    const hx = sinT * Math.cos(phi), hy = sinT * Math.sin(phi);
    const H = [hy, -hx, cosT];   // tangent frame of N = +Z in importanceSampleGGX: T = (0,-1,0), B = (1,0,0)
    const VoHraw = V[0] * H[0] + V[1] * H[1] + V[2] * H[2];
    const L = [2 * VoHraw * H[0] - V[0], 2 * VoHraw * H[1] - V[1], 2 * VoHraw * H[2] - V[2]];
    const NoL = Math.min(Math.max(L[2], 0), 1), NoH = Math.min(Math.max(H[2], 0), 1), VoH = Math.min(Math.max(VoHraw, 0), 1);
    if (NoL > 0) {
      const a2 = a * a, gv = NoL * Math.sqrt(NoV * NoV * (1 - a2) + a2), gl = NoV * Math.sqrt(NoL * NoL * (1 - a2) + a2);
      const G = 4 * NoL * VoH / NoH * (0.5 / Math.max(gv + gl, 1e-5)), Fc = Math.pow(1 - VoH, 5);
      A += (1 - Fc) * G; B += Fc * G;
    }
  }
  return [A / N, B / N];
}

export function iblTests(gpu: GPUContext): SelfTest[] {
  return [
    {
      name: 'ibl: BRDF LUT matches the CPU split-sum integration',
      run: async () => {
        const baker = new IBLBaker(gpu), lut = baker.brdfLut();
        const { px, w, h } = await readTex16F(gpu, lut, 0, 0);
        let worst = 0; const detail: string[] = [];
        for (const [x, y] of [[3, 3], [64, 10], [127, 127], [30, 90], [100, 50], [10, 120], [64, 64], [120, 5]]) {
          const ref = brdfRef((x + 0.5) / w, (y + 0.5) / h);
          const o = (y * w + x) * 4;
          worst = Math.max(worst, Math.abs(px[o] - ref[0]), Math.abs(px[o + 1] - ref[1]));
          detail.push(`(${x},${y}) gpu ${px[o].toFixed(3)},${px[o + 1].toFixed(3)} cpu ${ref[0].toFixed(3)},${ref[1].toFixed(3)}`);
          if (px[o] + px[o + 1] > 1.02) throw new Error(`energy > 1 at (${x},${y}): ${px[o] + px[o + 1]}`);
        }
        if (!(worst < 6e-3)) throw new Error(`worst deviation ${worst}: ${detail.join(' | ')}`);
        return `worst deviation ${worst.toExponential(2)} over 8 samples`;
      },
    },
    {
      name: 'ibl: procedural sky cube matches the TS reference (texel mapping and hardware cube sampling)',
      run: async () => {
        const sky: SkyParams = { zenith: [0.1, 0.3, 0.9], horizon: [0.8, 0.8, 0.7], ground: [0.1, 0.08, 0.05], sunDirection: [0.5, 0.6, 0.2], sunColor: [30, 25, 20], sunAngularRadius: 0.06 };
        const baker = new IBLBaker(gpu), env = baker.fromSky(sky, 128);
        // 1. per-texel write mapping, every face
        let worstTexel = 0;
        for (let f = 0; f < 6; f++) {
          const { px, w } = await readTex16F(gpu, env.source, 0, f);
          for (let k = 0; k < 40; k++) {
            const x = (k * 37 + f * 11) % w, y = (k * 53 + f * 7) % w, d = cubeTexelDir(f, x, y, w), ref = skyColor(sky, d);
            if (Math.abs(d[1]) < 0.02 || d[0] * sky.sunDirection[0] + d[1] * sky.sunDirection[1] + d[2] * sky.sunDirection[2] > 0.97) continue;
            for (let c = 0; c < 3; c++) worstTexel = Math.max(worstTexel, Math.abs(px[(y * w + x) * 4 + c] - ref[c]));
          }
        }
        if (!(worstTexel < 5e-3)) throw new Error(`texel mapping deviates by ${worstTexel}`);
        // 2. sampling by direction must agree (validates the cube convention used by the shaders)
        const rng = new Rng(5), dirs: number[] = [];
        while (dirs.length < 4 * 200) {
          const d = rng.unit3();
          if (Math.abs(d[1]) < 0.12 || d[0] * 0.5 + d[1] * 0.6 + d[2] * 0.2 > 0.8) continue;
          dirs.push(d[0], d[1], d[2], 0);
        }
        const out = await sampleCube(gpu, env.sourceView, new Float32Array(dirs));
        let worstDir = 0;
        for (let i = 0; i < 200; i++) {
          const ref = skyColor(sky, [dirs[i * 4], dirs[i * 4 + 1], dirs[i * 4 + 2]]);
          for (let c = 0; c < 3; c++) worstDir = Math.max(worstDir, Math.abs(out[i * 4 + c] - ref[c]));
        }
        if (!(worstDir < 0.04)) throw new Error(`direction sampling deviates by ${worstDir}`);
        return `texel dev ${worstTexel.toExponential(2)}, direction-sample dev ${worstDir.toExponential(2)}`;
      },
    },
    {
      name: 'ibl: constant environment -> irradiance (E/PI) and every specular mip equal the radiance',
      run: async () => {
        const L: [number, number, number] = [0.5, 0.25, 1];
        const env = new IBLBaker(gpu).fromSky(flatSky(L), 128);
        const dirs: number[] = [], rng = new Rng(9);
        for (let i = 0; i < 64; i++) { const d = rng.unit3(); dirs.push(d[0], d[1], d[2], 0); }
        let worstI = 0, worstS = 0;
        const irr = await sampleCube(gpu, env.irradianceView, new Float32Array(dirs));
        for (let i = 0; i < 64; i++) for (let c = 0; c < 3; c++) worstI = Math.max(worstI, Math.abs(irr[i * 4 + c] - L[c]) / L[c]);
        for (let m = 0; m < env.specularMipCount; m++) {
          const d2 = dirs.map((v, i) => (i % 4 === 3 ? m : v));
          const s = await sampleCube(gpu, env.specularView, new Float32Array(d2));
          for (let i = 0; i < 64; i++) for (let c = 0; c < 3; c++) worstS = Math.max(worstS, Math.abs(s[i * 4 + c] - L[c]) / L[c]);
        }
        if (!(worstI < 0.02)) throw new Error(`irradiance relative error ${worstI}`);
        if (!(worstS < 0.02)) throw new Error(`specular relative error ${worstS}`);
        return `irradiance err ${worstI.toExponential(2)}, specular err ${worstS.toExponential(2)}`;
      },
    },
    {
      name: 'ibl: gradient sky -> upward-facing irradiance is bluer than downward; rough specular is smoother than mirror',
      run: async () => {
        const sky: SkyParams = { zenith: [0.1, 0.3, 1], horizon: [0.6, 0.6, 0.6], ground: [0.2, 0.1, 0.05], sunDirection: [0, 1, 0], sunColor: [0, 0, 0], sunAngularRadius: 0 };
        const env = new IBLBaker(gpu).fromSky(sky, 128);
        const irr = await sampleCube(gpu, env.irradianceView, new Float32Array([0, 1, 0, 0, 0, -1, 0, 0]));
        if (!(irr[2] > irr[6] * 1.5)) throw new Error(`up.b ${irr[2]} vs down.b ${irr[6]}`);
        if (!(irr[0] < irr[4] + 1e-6 || irr[4] < irr[0])) throw new Error('unexpected');
        // sample the horizon band: mirror mip sees a sharp transition, rough mip blurs it
        const around = (m: number) => { const a: number[] = []; for (let i = 0; i < 16; i++) { const y = -0.4 + i * 0.05; a.push(Math.sqrt(1 - y * y), y, 0, m); } return new Float32Array(a); };
        const range = async (m: number) => { const s = await sampleCube(gpu, env.specularView, around(m)); let lo = 9, hi = -9; for (let i = 0; i < 16; i++) { lo = Math.min(lo, s[i * 4 + 2]); hi = Math.max(hi, s[i * 4 + 2]); } return hi - lo; };
        const sharp = await range(0), blurry = await range(5);
        if (!(blurry < sharp * 0.8)) throw new Error(`mip0 range ${sharp}, mip5 range ${blurry}`);
        return `irradiance up.b ${irr[2].toFixed(3)} / down.b ${irr[6].toFixed(3)}; horizon band range ${sharp.toFixed(3)} -> ${blurry.toFixed(3)}`;
      },
    },
    {
      name: 'ibl: equirectangular HDR (RGBE) -> cube has the right orientation',
      run: async () => {
        // red = latitude (0 at +Y .. 1 at -Y), green = longitude fraction, blue = 2 (HDR > 1)
        const W = 128, H = 64, data = new Float32Array(W * H * 3);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 3; data[o] = (y + 0.5) / H; data[o + 1] = (x + 0.5) / W; data[o + 2] = 2; }
        const parsed = parseRGBE(encodeRGBE({ width: W, height: H, data }, true));
        const env = new IBLBaker(gpu).fromEquirect(parsed.width, parsed.height, parsed.data, 64);
        const out = await sampleCube(gpu, env.sourceView, new Float32Array([0, 1, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0]));
        const r = (i: number) => out[i * 4], g = (i: number) => out[i * 4 + 1];
        if (!(r(0) < 0.1 && r(1) > 0.9 && Math.abs(r(2) - 0.5) < 0.05)) throw new Error(`latitude: +Y ${r(0)}, -Y ${r(1)}, +X ${r(2)}`);
        // +X is atan2(0, 1) = 0 -> u = 0.5; +Z is atan2(1, 0) = PI/2 -> u = 0.75; -X wraps to u = 0 or 1
        if (!(Math.abs(g(2) - 0.5) < 0.03 && Math.abs(g(3) - 0.75) < 0.03)) throw new Error(`longitude: +X ${g(2)}, +Z ${g(3)}`);
        if (!(Math.abs(out[2] - 2) < 0.05)) throw new Error(`HDR value lost: ${out[2]}`);
        return `latitude/longitude mapping OK, HDR range preserved (${out[2].toFixed(2)})`;
      },
    },
  ];
}
