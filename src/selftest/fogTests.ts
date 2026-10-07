import type { GPUContext } from '../gpu/GPUContext';
import { createBindLayouts } from '../gpu/BindLayouts';
import { SceneResources } from '../rendering/lighting/SceneResources';
import { LightData } from '../rendering/lighting/LightData';
import { VolumetricFog } from '../rendering/lighting/VolumetricFog';
import { LightType } from '../ecs/components/LightStore';
import { halfToFloat } from '../assets/RGBE';
import { readBuffer, type SelfTest } from './harness';

async function readVolume(gpu: GPUContext, tex: GPUTexture): Promise<{ w: number; h: number; d: number; px: Float32Array }> {
  const w = tex.width, h = tex.height, d = tex.depthOrArrayLayers, bpr = Math.ceil(w * 8 / 256) * 256;
  const buf = gpu.resources.buffers.create('fog-readback', bpr * h * d, GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
  const enc = gpu.device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: h }, [w, h, d]);
  gpu.device.queue.submit([enc.finish()]);
  const raw = new Uint16Array(await readBuffer(gpu.device, buf, bpr * h * d));
  const px = new Float32Array(w * h * d * 4);
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) px[((z * h + y) * w) * 4 + x] = halfToFloat(raw[(z * h + y) * (bpr / 2) + x]);
  return { w, h, d, px };
}

/** Builds a minimal scene + fog volume and fills it with the compute pass. */
async function bakeFog(gpu: GPUContext, opts: { density: number; g: number; ambient: [number, number, number]; light?: { dir: number[]; color: number[]; intensity: number } }) {
  const { device, resources: r } = gpu;
  const layouts = createBindLayouts(device);
  const scene = new SceneResources(gpu, layouts);
  const lights = new LightData();
  if (opts.light) lights.add({ type: LightType.Directional, position: [0, 0, 0], direction: opts.light.dir, color: opts.light.color, intensity: opts.light.intensity, range: 0, innerCone: 0, outerCone: 0 });
  lights.finalize();
  scene.syncLights(lights);
  const fog = new VolumetricFog(gpu, layouts, scene);
  fog.settings = { density: opts.density, heightFalloff: 0, anisotropy: opts.g, ambient: opts.ambient, maxDistance: 50 };
  fog.resize(512, 512);   // 64 x 64 columns
  fog.applySettings();
  scene.writeUniform({ lightCount: lights.count, globalCount: lights.globalCount, clusterNear: 0.1, clusterFar: 50, ambientSky: [0, 0, 0], ambientGround: [0, 0, 0] });
  const frameBuf = r.buffers.create('fog-test-frame', 224, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const frameBG = device.createBindGroup({ layout: layouts.frame, entries: [{ binding: 0, resource: { buffer: frameBuf } }] });
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const enc = device.createCommandEncoder();
  fog.encode(enc, frameBG, identity, 1, 1, 0.1);
  device.queue.submit([enc.finish()]);
  return { vol: await readVolume(gpu, fog.volume!), fog };
}

function hg(g: number, c: number): number { return (1 - g * g) / (4 * Math.PI * Math.pow(Math.max(1 + g * g - 2 * g * c, 1e-4), 1.5)); }

export function fogTests(gpu: GPUContext): SelfTest[] {
  const near = 0.1, far = 50, tile = 8;
  /** Expected (S, T) at froxel (x, y, k) for homogeneous fog. */
  const expected = (x: number, y: number, k: number, density: number, g: number, ambient: number[], light?: { dir: number[]; color: number[]; intensity: number }) => {
    const nx = 2 * ((x + 0.5) * tile) / 512 - 1, ny = 1 - 2 * ((y + 0.5) * tile) / 512;
    const ratio = far / near, z1 = near * Math.pow(ratio, (k + 1) / 48);
    const rayLen = Math.hypot(nx, ny, 1);   // |viewPos| / zc with proj scale 1
    const T = Math.exp(-density * (z1 - near) * rayLen);
    const s = [...ambient];
    if (light) {
      const dl = Math.hypot(...light.dir), L = light.dir.map((v) => -v / dl), vd = [nx / rayLen, ny / rayLen, -1 / rayLen];
      const ph = hg(g, L[0] * vd[0] + L[1] * vd[1] + L[2] * vd[2]);
      for (let c = 0; c < 3; c++) s[c] += light.color[c] * light.intensity * ph;
    }
    return { T, S: s.map((v) => v * (1 - T)) };
  };
  const check = (vol: { w: number; h: number; px: Float32Array }, density: number, g: number, ambient: number[], light?: { dir: number[]; color: number[]; intensity: number }): { worst: number; samples: number } => {
    let worst = 0, samples = 0;
    for (const [x, y] of [[32, 32], [5, 50], [60, 8], [20, 40]]) for (const k of [0, 5, 20, 35, 47]) {
      const e = expected(x, y, k, density, g, ambient, light), o = ((k * vol.h + y) * vol.w + x) * 4;
      worst = Math.max(worst, Math.abs(vol.px[o + 3] - e.T));
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(vol.px[o + c] - e.S[c]) / Math.max(1, e.S[c] * 20));
      samples++;
    }
    return { worst, samples };
  };
  return [
    {
      name: 'fog: homogeneous fog with ambient light matches the analytic transmittance and in-scattering',
      run: async () => {
        const { vol } = await bakeFog(gpu, { density: 0.05, g: 0, ambient: [0.4, 0.5, 0.6] });
        const r = check(vol, 0.05, 0, [0.4, 0.5, 0.6]);
        if (!(r.worst < 6e-3)) throw new Error(`worst error ${r.worst}`);
        return `${r.samples} froxels, worst error ${r.worst.toExponential(2)}`;
      },
    },
    {
      name: 'fog: directional light adds Henyey-Greenstein in-scattering (forward / backward anisotropy)',
      run: async () => {
        const light = { dir: [0.2, -0.7, -0.6], color: [1, 0.9, 0.8], intensity: 8 };
        let worstAll = 0;
        for (const g of [0, 0.6, -0.4]) {
          const { vol } = await bakeFog(gpu, { density: 0.03, g, ambient: [0.05, 0.05, 0.05], light });
          const r = check(vol, 0.03, g, [0.05, 0.05, 0.05], light);
          worstAll = Math.max(worstAll, r.worst);
          if (!(r.worst < 8e-3)) throw new Error(`g=${g}: worst error ${r.worst}`);
        }
        return `g = 0 / 0.6 / -0.4 all within ${worstAll.toExponential(2)}`;
      },
    },
  ];
}
