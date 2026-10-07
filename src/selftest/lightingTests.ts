import type { GPUContext } from '../gpu/GPUContext';
import { LightData, LIGHT_FLOATS } from '../rendering/lighting/LightData';
import { LightType } from '../ecs/components/LightStore';
import { Rng, readBuffer, type SelfTest } from './harness';
import { brdfRef } from './iblTests';
import { LTC_SIZE, LTC_TABLE } from '../rendering/lighting/ltcTable';

const WGSL = /* wgsl */ `
//#include common_types
//#include lighting
@group(0) @binding(0) var<storage, read> cases: array<f32>;
@group(0) @binding(1) var<storage, read_write> outv: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= arrayLength(&outv) / 8u) { return; }
  let b = i * 28u;
  var light: Light;
  light.positionRange = vec4<f32>(cases[b], cases[b+1u], cases[b+2u], cases[b+3u]);
  light.colorIntensity = vec4<f32>(cases[b+4u], cases[b+5u], cases[b+6u], cases[b+7u]);
  light.directionType = vec4<f32>(cases[b+8u], cases[b+9u], cases[b+10u], cases[b+11u]);
  light.spot = vec4<f32>(cases[b+12u], cases[b+13u], cases[b+14u], cases[b+15u]);
  let P = vec3<f32>(cases[b+24u], cases[b+25u], cases[b+26u]);
  var L = vec3<f32>(0.0);
  let r = lightRadiance(light, P, &L);
  let o = i * 8u;
  outv[o] = r.x; outv[o+1u] = r.y; outv[o+2u] = r.z; outv[o+3u] = 0.0;
  outv[o+4u] = L.x; outv[o+5u] = L.y; outv[o+6u] = L.z; outv[o+7u] = 0.0;
}`;

/** TS reference of lightRadiance (mirrors lighting.wgsl, float64). */
function reference(f: Float32Array, o: number, P: number[]): { rad: number[]; L: number[] } {
  const kind = Math.round(f[o + 11]);
  const k = f[o + 7], col = [f[o + 4] * k, f[o + 5] * k, f[o + 6] * k];
  if (kind === 0) return { rad: col, L: [-f[o + 8], -f[o + 9], -f[o + 10]] };
  const t = [f[o] - P[0], f[o + 1] - P[1], f[o + 2] - P[2]];
  const d2 = t[0] * t[0] + t[1] * t[1] + t[2] * t[2], d = Math.sqrt(d2), range = f[o + 3];
  const L = t.map((v) => v / Math.sqrt(Math.max(d2, 1e-8)));
  let w = 1;
  if (range > 0) { const x = d / range; const q = Math.min(Math.max(1 - x ** 4, 0), 1); w = q * q; }
  let a = w / Math.max(d2, 1e-4);
  if (kind === 2) {
    const cd = -(L[0] * f[o + 8] + L[1] * f[o + 9] + L[2] * f[o + 10]);
    const s = Math.min(Math.max((cd - f[o + 12]) * f[o + 13], 0), 1);
    a *= s * s;
  }
  return { rad: col.map((c) => c * a), L };
}

const AREA_WGSL = /* wgsl */ `
//#include common_types
//#include lighting
@group(0) @binding(0) var<storage, read> cases: array<f32>;
@group(0) @binding(1) var<storage, read_write> outv: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= arrayLength(&outv) / 4u) { return; }
  let b = i * 40u;
  var light: Light;
  light.positionRange = vec4<f32>(cases[b], cases[b+1u], cases[b+2u], cases[b+3u]);
  light.colorIntensity = vec4<f32>(cases[b+4u], cases[b+5u], cases[b+6u], cases[b+7u]);
  light.directionType = vec4<f32>(cases[b+8u], cases[b+9u], cases[b+10u], cases[b+11u]);
  light.spot = vec4<f32>(cases[b+12u], cases[b+13u], cases[b+14u], cases[b+15u]);
  light.right = vec4<f32>(cases[b+16u], cases[b+17u], cases[b+18u], cases[b+19u]);
  light.up = vec4<f32>(cases[b+20u], cases[b+21u], cases[b+22u], cases[b+23u]);
  let P = vec3<f32>(cases[b+24u], cases[b+25u], cases[b+26u]);
  let N = vec3<f32>(cases[b+28u], cases[b+29u], cases[b+30u]);
  let V = vec3<f32>(cases[b+32u], cases[b+33u], cases[b+34u]);
  let ltc = vec3<f32>(cases[b+36u], cases[b+37u], cases[b+38u]);
  let o = i * 4u;
  outv[o] = areaFormFactor(light, P, N);
  outv[o+1u] = areaSpecularFraction(light, N, V, P, ltc);
}`;

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

/** Brute-force quadrature over the rectangle: diffuse form factor E/(PI L) and GGX specular (float64). */
function areaReference(c: AreaCase): { ff: number; spec: number } {
  const n = 160, N = unit(c.N), V = unit(c.V), ln = unit(c.dir), r = unit(c.right), u = unit(c.up);
  const area = 4 * c.hw * c.hh, dA = area / (n * n), a = c.rough * c.rough;
  let ff = 0, spec = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = ((i + 0.5) / n * 2 - 1) * c.hw, y = ((j + 0.5) / n * 2 - 1) * c.hh;
    const q = [c.pos[0] + r[0] * x + u[0] * y, c.pos[1] + r[1] * x + u[1] * y, c.pos[2] + r[2] * x + u[2] * y];
    const d = sub(q, c.P), d2 = dot3(d, d), L = unit(d);
    const cosL = c.twoSided ? Math.abs(dot3(L, ln)) : Math.max(-dot3(L, ln), 0), NoL = Math.max(dot3(N, L), 0);
    if (NoL <= 0 || cosL <= 0) continue;
    const w = NoL * cosL / d2 * dA;
    ff += w / Math.PI;
    const H = unit([V[0] + L[0], V[1] + L[1], V[2] + L[2]]), NoH = Math.max(dot3(N, H), 0), VoH = Math.max(dot3(V, H), 0), NoV = Math.max(dot3(N, V), 1e-4);
    const a2 = a * a, dd = NoH * NoH * (a2 - 1) + 1, D = a2 / (Math.PI * dd * dd);
    const gv = NoL * Math.sqrt(NoV * NoV * (1 - a2) + a2), gl = NoV * Math.sqrt(NoL * NoL * (1 - a2) + a2), Vis = 0.5 / Math.max(gv + gl, 1e-5);
    const F = c.f0 + (1 - c.f0) * Math.pow(1 - VoH, 5);
    spec += D * Vis * F * w;   // w already contains NoL
  }
  return { ff, spec };
}

interface AreaCase { pos: number[]; dir: number[]; right: number[]; up: number[]; hw: number; hh: number; twoSided: boolean; P: number[]; N: number[]; V: number[]; rough: number; f0: number; label: string }

export function lightingTests(gpu: GPUContext): SelfTest[] {
  return [{
    name: 'lighting: area lights - diffuse form factor (exact) and LTC specular vs brute-force quadrature',
    run: async () => {
      const { device, resources: res } = gpu;
      const cases: AreaCase[] = [];
      const V0 = [0.5, 0.7, 0.5];
      const mk = (label: string, o: Partial<AreaCase>): void => { cases.push({ pos: [0, 3, 0], dir: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1], hw: 1, hh: 1, twoSided: false, P: [0, 0, 0], N: [0, 1, 0], V: V0, rough: 0.5, f0: 1, label, ...o }); };
      mk('overhead 2x2 r.5', {});
      mk('overhead r.3', { rough: 0.3 });
      mk('overhead r.8', { rough: 0.8 });
      mk('off-axis', { P: [2, 0, -1] });
      mk('large close (horizon clip)', { pos: [0, 0.6, 0], hw: 3, hh: 3, rough: 0.6 });
      mk('wall light', { pos: [3, 1.5, 0], dir: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0], hw: 1.5, hh: 1, rough: 0.5, V: [-0.3, 0.8, 0.4] });
      {
        const d = unit([-0.3, -1, -0.3]), r = unit([1, 0, -0.3 * d[0] / d[2] * 0 + (-(d[0]) / d[2])]);   // r = unit(1,0,-dx/dz) is orthogonal to d
        const u = unit([d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]]);
        mk('tilted light', { pos: [1, 3, 1], dir: d, right: r, up: u, rough: 0.5 });
      }
      mk('behind the light (one-sided)', { P: [0, 6, 0], N: [0, -1, 0], V: [0.5, -0.7, 0.5] });
      mk('two-sided from behind', { P: [0, 6, 0], N: [0, -1, 0], V: [0.5, -0.7, 0.5], twoSided: true });
      mk('far small light', { pos: [0, 8, 0], hw: 0.3, hh: 0.3, rough: 0.4 });
      // CPU bilinear lookup of the LTC table (same addressing as ltcLookup in ibl_eval.wgsl)
      const ltcAt = (rough: number, NoV: number): number[] => {
        const fx = rough * (LTC_SIZE - 1), fy = Math.sqrt(1 - NoV) * (LTC_SIZE - 1), x0 = Math.min(Math.floor(fx), LTC_SIZE - 2), y0 = Math.min(Math.floor(fy), LTC_SIZE - 2), tx = fx - x0, ty = fy - y0;
        const g = (x: number, y: number, k: number) => LTC_TABLE[(y * LTC_SIZE + x) * 3 + k];
        return [0, 1, 2].map((k) => (g(x0, y0, k) * (1 - tx) + g(x0 + 1, y0, k) * tx) * (1 - ty) + (g(x0, y0 + 1, k) * (1 - tx) + g(x0 + 1, y0 + 1, k) * tx) * ty);
      };
      const n = cases.length, input = new Float32Array(n * 40);
      cases.forEach((c, i) => {
        const o = i * 40, ld = new LightData();
        ld.add({ type: LightType.Area, position: c.pos, direction: c.dir, color: [1, 1, 1], intensity: 1, range: 0, innerCone: 0, outerCone: 0, right: unit(c.right), up: unit(c.up), halfWidth: c.hw, halfHeight: c.hh, twoSided: c.twoSided });
        input.set(ld.data.subarray(0, LIGHT_FLOATS), o);
        input.set(c.P, o + 24); input.set(unit(c.N), o + 28); input.set(unit(c.V), o + 32); input.set(ltcAt(c.rough, Math.max(dot3(unit(c.N), unit(c.V)), 1e-3)), o + 36);
      });
      const S = GPUBufferUsage.STORAGE;
      const inBuf = res.buffers.create('area-in', input.byteLength, S | GPUBufferUsage.COPY_DST);
      const outBuf = res.buffers.create('area-out', n * 16, S | GPUBufferUsage.COPY_SRC);
      device.queue.writeBuffer(inBuf, 0, input);
      const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: res.shaders.get('area-parity', AREA_WGSL), entryPoint: 'main' } });
      const bg = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inBuf } }, { binding: 1, resource: { buffer: outBuf } }] });
      const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(1); pass.end();
      device.queue.submit([enc.finish()]);
      const out = new Float32Array(await readBuffer(device, outBuf, n * 16));
      let worstFF = 0, lo = Infinity, hi = 0;
      const lines: string[] = [];
      cases.forEach((c, i) => {
        const ref = areaReference(c);
        const ab = brdfRef(Math.max(dot3(unit(c.N), unit(c.V)), 1e-3), c.rough), sp = out[i * 4 + 1] * (c.f0 * ab[0] + ab[1]), ff = out[i * 4];
        worstFF = Math.max(worstFF, Math.abs(ff - ref.ff));
        const ratio = ref.spec > 2e-3 ? sp / ref.spec : NaN;
        if (ref.spec > 2e-3) { lo = Math.min(lo, ratio); hi = Math.max(hi, ratio); }
        else if (Math.abs(sp - ref.spec) > 4e-3) throw new Error(`${c.label}: spec ${sp} vs ${ref.spec}`);
        lines.push(`${c.label}: ff ${ff.toFixed(4)}/${ref.ff.toFixed(4)} spec ${sp.toFixed(3)}/${ref.spec.toFixed(3)}`);
      });
      if (!(worstFF < 3e-3)) throw new Error(`form factor deviates by ${worstFF}: ${lines.join(' | ')}`);
      if (!(lo > 0.7 && hi < 1.45)) throw new Error(`specular ratio range ${lo.toFixed(2)}..${hi.toFixed(2)}: ${lines.join(' | ')}`);
      return `form factor max err ${worstFF.toExponential(2)}; specular / reference ratio ${lo.toFixed(2)}..${hi.toFixed(2)} over ${n} configs`;
    },
  }, {
    name: 'lighting: GPU attenuation / cone / direction match TS reference',
    run: async () => {
      const { device, resources: res } = gpu;
      const rng = new Rng(77);
      const N = 512, ld = new LightData(), P: number[][] = [];
      const norm = (v: number[]) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
      for (let i = 0; i < N; i++) {
        const type = [LightType.Directional, LightType.Point, LightType.Spot][i % 3];
        const range = i % 4 === 0 ? 0 : 2 + rng.next() * 18;
        ld.add({
          type, position: [rng.next() * 10 - 5, rng.next() * 10 - 5, rng.next() * 10 - 5],
          direction: norm([rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5]),
          color: [rng.next(), rng.next(), rng.next()], intensity: 0.5 + rng.next() * 20, range,
          innerCone: 0.1 + rng.next() * 0.3, outerCone: 0.45 + rng.next() * 0.6,
        });
        P.push([rng.next() * 12 - 6, rng.next() * 12 - 6, rng.next() * 12 - 6]);
      }
      // note: no finalize() => original (unsorted) order is kept for per-case comparison
      const input = new Float32Array(N * 28);
      for (let i = 0; i < N; i++) { input.set(ld.data.subarray(i * LIGHT_FLOATS, (i + 1) * LIGHT_FLOATS), i * 28); input.set(P[i], i * 28 + 24); }
      const S = GPUBufferUsage.STORAGE;
      const inBuf = res.buffers.create('lt-in', input.byteLength, S | GPUBufferUsage.COPY_DST);
      const outBuf = res.buffers.create('lt-out', N * 32, S | GPUBufferUsage.COPY_SRC);
      device.queue.writeBuffer(inBuf, 0, input);
      const module = res.shaders.get('lighting-parity', WGSL);
      const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
      const bg = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inBuf } }, { binding: 1, resource: { buffer: outBuf } }] });
      const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(Math.ceil(N / 64)); pass.end();
      device.queue.submit([enc.finish()]);
      const out = new Float32Array(await readBuffer(device, outBuf, N * 32));
      let worst = 0;
      for (let i = 0; i < N; i++) {
        const ref = reference(input, i * 28, P[i]);
        for (let c = 0; c < 3; c++) {
          worst = Math.max(worst, Math.abs(out[i * 8 + c] - ref.rad[c]) / Math.max(1e-3, Math.abs(ref.rad[c]), 1));
          worst = Math.max(worst, Math.abs(out[i * 8 + 4 + c] - ref.L[c]));
        }
      }
      if (!(worst < 2e-4)) throw new Error(`worst error ${worst}`);
      return `worst err ${worst.toExponential(2)} over ${N} cases`;
    },
  }];
}
