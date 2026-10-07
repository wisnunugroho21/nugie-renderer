import type { GPUContext } from '../gpu/GPUContext';
import { createBindLayouts } from '../gpu/BindLayouts';
import { Mat4 } from '../math/Mat4';
import { ClusterGrid } from '../rendering/lighting/ClusterGrid';
import { SceneResources } from '../rendering/lighting/SceneResources';
import { LightData } from '../rendering/lighting/LightData';
import { LightType } from '../ecs/components/LightStore';
import { Rng, readBuffer, type SelfTest } from './harness';

interface Setup { grid: ClusterGrid; lights: LightData; view: ArrayLike<number>; proj: ArrayLike<number>; w: number; h: number; near: number; far: number }

function setup(gpu: GPUContext, nLights: number, max: number, seed: number): Setup {
  const rng = new Rng(seed), w = 640, h = 360, near = 0.1, far = 100;
  const scene = new SceneResources(gpu, createBindLayouts(gpu.device));
  const lights = new LightData();
  for (let i = 0; i < nLights; i++) {
    const spot = i % 4 === 3, d = rng.unit3();
    lights.add({
      type: spot ? LightType.Spot : LightType.Point, position: [rng.range(-15, 15), rng.range(-2, 6), rng.range(-40, 3)], direction: d,
      color: [1, 1, 1], intensity: 5, range: rng.range(1, 8), innerCone: 0.1, outerCone: rng.range(0.15, 1.1),
    });
  }
  // a few global lights up front: they must never appear in cluster lists
  lights.add({ type: LightType.Directional, position: [0, 0, 0], direction: [0, -1, 0], color: [1, 1, 1], intensity: 1, range: 0, innerCone: 0, outerCone: 0 });
  lights.add({ type: LightType.Point, position: [0, 1, -5], direction: [0, 0, -1], color: [1, 1, 1], intensity: 1, range: 0, innerCone: 0, outerCone: 0 });
  lights.finalize();
  scene.syncLights(lights);
  const grid = new ClusterGrid(gpu, scene, { tileSize: 64, slices: 12, maxLightsPerCluster: max });
  grid.resize(w, h);
  const view = Mat4.lookAt(Mat4.create(), 1, 2, 4, -2, 0.5, -10), proj = Mat4.perspective(Mat4.create(), Math.PI / 3, w / h, near, far);
  const enc = gpu.device.createCommandEncoder();
  grid.encode(enc, view, proj[0], proj[5], near, far, lights);
  gpu.device.queue.submit([enc.finish()]);
  return { grid, lights, view, proj, w, h, near, far };
}

/** CPU reference: which lights' bounding spheres touch cluster `c` (radius scaled by `grow` for tolerance checks). */
function cpuMembers(s: Setup, c: number, grow: number): number[] {
  const [dx, dy, dz] = s.grid.dims, tx = c % dx, ty = Math.floor(c / dx) % dy, tz = Math.floor(c / (dx * dy));
  const ratio = s.far / s.near, zN = -s.near * Math.pow(ratio, tz / dz), zF = -s.near * Math.pow(ratio, (tz + 1) / dz), tile = s.grid.config.tileSize;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < 8; k++) {
    const px = (tx + (k & 1)) * tile, py = (ty + ((k >> 1) & 1)) * tile, z = (k & 4) ? zF : zN;
    const p = [(2 * px / s.w - 1) / s.proj[0] * -z, (1 - 2 * py / s.h) / s.proj[5] * -z, z];
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
  }
  const out: number[] = [], f = s.lights.data, v = s.view;
  const tp = (x: number, y: number, z: number, w: number) => [0, 1, 2].map((r) => v[r] * x + v[4 + r] * y + v[8 + r] * z + v[12 + r] * w);
  for (let i = s.lights.globalCount; i < s.lights.count; i++) {
    const o = i * 24;
    let ctr = tp(f[o], f[o + 1], f[o + 2], 1), rad = f[o + 3];
    if (Math.round(f[o + 11]) === 2) {
      const cosO = Math.min(Math.max(f[o + 12], 0), 1), ax = tp(f[o + 8], f[o + 9], f[o + 10], 0);
      const along = cosO < 0.7071 ? rad * cosO : rad / (2 * cosO), r2 = cosO < 0.7071 ? rad * Math.sqrt(1 - cosO * cosO) : rad / (2 * cosO);
      ctr = ctr.map((x, a) => x + ax[a] * along); rad = r2;
    }
    rad *= grow;
    let d2 = 0;
    for (let a = 0; a < 3; a++) { const d = Math.max(lo[a] - ctr[a], 0) + Math.max(ctr[a] - hi[a], 0); d2 += d * d; }
    if (d2 <= rad * rad) out.push(i);
  }
  return out;
}

export function clusterTests(gpu: GPUContext): SelfTest[] {
  return [
    {
      name: 'clusters: GPU light assignment matches the CPU reference (conservative, global lights excluded)',
      run: async () => {
        const s = setup(gpu, 400, 256, 21), n = s.grid.clusterCount, b = s.grid.buffers;
        const grid = new Uint32Array(await readBuffer(gpu.device, b.grid, n * 8));
        const idx = new Uint32Array(await readBuffer(gpu.device, b.indices, n * 256 * 4));
        const ovf = new Uint32Array(await readBuffer(gpu.device, b.overflow, 4))[0];
        if (ovf !== 0) throw new Error(`unexpected overflow ${ovf}`);
        let total = 0, nonEmpty = 0, mism = 0;
        for (let c = 0; c < n; c++) {
          const off = grid[c * 2], cnt = grid[c * 2 + 1];
          const got = Array.from(idx.subarray(off, off + cnt));
          const inner = cpuMembers(s, c, 0.999), outer = cpuMembers(s, c, 1.001);
          const gotSet = new Set(got);
          if (!inner.every((i) => gotSet.has(i)) || !got.every((i) => outer.includes(i))) mism++;
          if (got.some((i) => i < s.lights.globalCount)) throw new Error(`cluster ${c} lists a global light`);
          if (got.some((v, k) => k > 0 && v <= got[k - 1])) throw new Error(`cluster ${c}: indices not strictly ascending`);
          total += cnt; if (cnt) nonEmpty++;
        }
        if (mism) throw new Error(`${mism} clusters differ from the CPU reference`);
        if (nonEmpty < n / 10) throw new Error(`suspiciously empty grid (${nonEmpty}/${n} clusters have lights)`);
        return `${n} clusters (${s.grid.dims.join('x')}), ${total} assignments, ${nonEmpty} non-empty, 0 mismatches`;
      },
    },
    {
      name: 'clusters: full lists drop extra lights and count them in the overflow counter',
      run: async () => {
        const s = setup(gpu, 400, 4, 22), n = s.grid.clusterCount, b = s.grid.buffers;
        const grid = new Uint32Array(await readBuffer(gpu.device, b.grid, n * 8));
        const ovf = new Uint32Array(await readBuffer(gpu.device, b.overflow, 4))[0];
        let full = 0, over = 0;
        for (let c = 0; c < n; c++) {
          if (grid[c * 2 + 1] > 4) throw new Error(`cluster ${c} exceeds its capacity (${grid[c * 2 + 1]})`);
          if (grid[c * 2 + 1] === 4) { full++; over += cpuMembers(s, c, 1).length - 4; }
        }
        if (full === 0 || ovf === 0) throw new Error(`expected overflow (full clusters ${full}, counter ${ovf})`);
        if (Math.abs(ovf - over) > over * 0.02 + 2) throw new Error(`overflow counter ${ovf} vs CPU ${over}`);
        return `${full} full clusters, overflow counter ${ovf} (CPU ${over})`;
      },
    },
  ];
}
