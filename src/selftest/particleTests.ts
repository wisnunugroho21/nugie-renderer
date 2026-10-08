import type { GPUContext } from '../gpu/GPUContext';
import { createBindLayouts } from '../gpu/BindLayouts';
import { MeshManager } from '../rendering/MeshManager';
import { createCube } from '../rendering/primitives';
import { Camera } from '../rendering/Camera';
import { ParticleSystem, type ParticlePool, type ParticlePoolConfig } from '../particles/ParticleSystem';
import type { EmitterConfig } from '../particles/EmitterConfig';
import { readTextureRGBA8, type SelfTest } from './harness';

const TARGET = { colorFormat: 'rgba8unorm' as GPUTextureFormat, depthFormat: 'depth24plus' as GPUTextureFormat, sampleCount: 1 };
const f32 = Math.fround;

/** Create the layouts, mesh manager and particle system shared by the particle tests. */
function setup(gpu: GPUContext) {
  const layouts = createBindLayouts(gpu.device);
  const meshes = new MeshManager(gpu.device, gpu.resources.buffers);
  const system = new ParticleSystem(gpu, layouts, meshes, TARGET);
  return { layouts, meshes, system };
}

/** Run `frames` simulation frames (CPU update + GPU compute) with a fixed dt. */
function step(gpu: GPUContext, sys: ParticleSystem, frames: number, dt: number): void {
  for (let f = 0; f < frames; f++) {
    sys.update(dt, f * dt);
    const enc = gpu.device.createCommandEncoder();
    sys.encodeCompute(enc);
    gpu.device.queue.submit([enc.finish()]);
  }
}

/** Create a pool (default 4096 billboard particles) with a single emitter. */
function pool(sys: ParticleSystem, cfg: Partial<ParticlePoolConfig>, emitter: EmitterConfig): ParticlePool {
  const p = sys.createPool({ maxCount: 4096, billboard: {}, ...cfg });
  p.addEmitter(emitter);
  return p;
}

/** Throw unless `a` is within `tol` of `b`. */
const approx = (a: number, b: number, tol: number, what: string) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: ${a} vs ${b} (tol ${tol})`); };

/** GPU particle simulation: kinematics, recycling, capacity, determinism, emitter shapes, indirect args and billboard rendering. */
export function particleTests(gpu: GPUContext): SelfTest[] {
  return [
    {
      name: 'particles: GPU kinematics match the CPU reference (semi-implicit Euler + drag)',
      run: async () => {
        const { system } = setup(gpu);
        const p = pool(system, { maxCount: 4096 }, { shape: 'point', bursts: [{ time: 0, count: 1000 }], velocityMin: [1, 2, 3], velocityMax: [1, 2, 3], acceleration: [0, -10, 0], drag: 0.5, lifetime: [3, 3], loop: false, duration: 0.01 });
        const dt = 1 / 60, F = 21;   // frame 0 spawns, frames 1..20 integrate => 20 steps
        step(gpu, system, F, dt);
        const c = await p.readCounters();
        if (c.alive !== 1000 || c.dead !== 4096 - 1000) throw new Error(`counters ${JSON.stringify(c)}`);
        // CPU reference
        let px = 0, py = 0, pz = 0, vx = 1, vy = 2, vz = 3, age = 0; const h = f32(dt);
        for (let i = 0; i < F - 1; i++) {
          vy = f32(vy + -10 * h); const d = 1 + 0.5 * h; vx = f32(vx / d); vy = f32(vy / d); vz = f32(vz / d);
          px = f32(px + vx * h); py = f32(py + vy * h); pz = f32(pz + vz * h); age = f32(age + h);
        }
        const idx = await p.readAliveIndices(1000), all = await p.readParticles(4096);
        let worst = 0;
        for (let i = 0; i < 1000; i++) {
          const o = idx[i] * 16;
          worst = Math.max(worst, Math.abs(all[o] - px), Math.abs(all[o + 1] - py), Math.abs(all[o + 2] - pz), Math.abs(all[o + 3] - age), Math.abs(all[o + 4] - vx), Math.abs(all[o + 5] - vy), Math.abs(all[o + 6] - vz));
        }
        if (worst > 1e-3) throw new Error(`max deviation ${worst}`);
        return `1000 particles x 20 steps, max deviation ${worst.toExponential(2)}`;
      },
    },
    {
      name: 'particles: expired particles are recycled (alive -> 0, dead stack refilled)',
      run: async () => {
        const { system } = setup(gpu);
        const p = pool(system, { maxCount: 2048 }, { bursts: [{ time: 0, count: 500 }], lifetime: [0.5, 0.5], loop: false, duration: 0.01 });
        step(gpu, system, 61, 1 / 60);
        const c = await p.readCounters();
        if (c.alive !== 0 || c.dead !== 2048 || c.spawned !== 500) throw new Error(JSON.stringify(c));
        return JSON.stringify(c);
      },
    },
    {
      name: 'particles: pool capacity is a hard limit (excess spawns rejected, nothing corrupts)',
      run: async () => {
        const { system } = setup(gpu);
        const p = pool(system, { maxCount: 1000 }, { bursts: [{ time: 0, count: 800 }, { time: 0.1, count: 800 }], lifetime: [10, 10], loop: false, duration: 1 });
        step(gpu, system, 12, 1 / 60);
        const c = await p.readCounters();
        if (c.alive !== 1000 || c.dead !== 0 || c.spawned !== 1000 || c.rejected !== 600) throw new Error(JSON.stringify(c));
        return JSON.stringify(c);
      },
    },
    {
      name: 'particles: alive and dead lists always form a permutation of all indices (no duplicates, no leaks)',
      run: async () => {
        const N = 4096;
        const { system } = setup(gpu);
        const p = pool(system, { maxCount: N }, { rate: 3000, lifetime: [0.2, 0.5], size: [0.1, 0.1] });
        step(gpu, system, 90, 1 / 60);
        const c = await p.readCounters();
        if (c.alive + c.dead !== N) throw new Error(`alive ${c.alive} + dead ${c.dead} != ${N}`);
        const alive = await p.readAliveIndices(c.alive), dead = await p.readDeadIndices(c.dead);
        const seen = new Uint8Array(N);
        for (let i = 0; i < c.alive; i++) { if (seen[alive[i]]++) throw new Error(`duplicate alive index ${alive[i]}`); }
        for (let i = 0; i < c.dead; i++) { if (seen[dead[i]]++) throw new Error(`index ${dead[i]} is both alive and dead / duplicated`); }
        for (let i = 0; i < N; i++) if (seen[i] !== 1) throw new Error(`index ${i} leaked`);
        return `alive ${c.alive} + dead ${c.dead} = ${N}; spawned ${c.spawned}`;
      },
    },
    {
      name: 'particles: simulation is deterministic for a fixed seed',
      run: async () => {
        /** Run the seeded simulation once and read the particle state back. */
        const run = async () => {
          const { system } = setup(gpu);
          const p = pool(system, { maxCount: 2048 }, { shape: 'sphere', radius: 1, rate: 500, lifetime: [0.5, 1.5], velocityMin: [-1, -1, -1], velocityMax: [1, 1, 1], size: [0.05, 0.2], seed: 4242 });
          step(gpu, system, 40, 1 / 60);
          const c = await p.readCounters();
          const idx = await p.readAliveIndices(c.alive), all = await p.readParticles(2048);
          const rows: number[][] = [];
          for (let i = 0; i < c.alive; i++) rows.push(Array.from(all.subarray(idx[i] * 16, idx[i] * 16 + 16)));
          return rows.sort((a, b) => a[3] - b[3] || a[0] - b[0]);
        };
        const a = await run(), b = await run();
        if (a.length !== b.length || a.length === 0) throw new Error(`alive ${a.length} vs ${b.length}`);
        for (let i = 0; i < a.length; i++) for (let k = 0; k < 16; k++) if (a[i][k] !== b[i][k]) throw new Error(`mismatch at ${i}:${k}`);
        return `${a.length} particles identical across runs`;
      },
    },
    {
      name: 'particles: emitter shapes (sphere surface, box, cone) and emitter transform / simulation space',
      run: async () => {
        /** Spawn one burst from `emitter` (optionally with an emitter world matrix) and read the particles back. */
        const read = async (emitter: EmitterConfig, world?: number[]) => {
          const { system } = setup(gpu);
          const p = pool(system, { maxCount: 2048 }, { ...emitter, bursts: [{ time: 0, count: 600 }], lifetime: [5, 5], loop: false, duration: 0.01 });
          if (world) p.setEmitterTransform(0, world);
          step(gpu, system, 1, 1 / 60);
          const idx = await p.readAliveIndices(600), all = await p.readParticles(2048);
          return Array.from(idx.subarray(0, 600)).map((i) => Array.from(all.subarray(i * 16, i * 16 + 16)));
        };
        /** A translation matrix (column-major). */
        const T = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
        // sphere surface, translated by (5,1,-2)
        for (const r of await read({ shape: 'sphere', radius: 2, surfaceOnly: true }, T(5, 1, -2))) approx(Math.hypot(r[0] - 5, r[1] - 1, r[2] + 2), 2, 2e-3, 'sphere surface radius');
        // box half extents (1,2,3)
        for (const r of await read({ shape: 'box', box: [1, 2, 3] })) { if (Math.abs(r[0]) > 1.001 || Math.abs(r[1]) > 2.001 || Math.abs(r[2]) > 3.001) throw new Error('box out of extents'); }
        // cone: velocity direction within the half angle of +Y
        const half = 0.4;
        for (const r of await read({ shape: 'cone', radius: 0, coneAngle: half, radialSpeed: [2, 2] })) {
          const sp = Math.hypot(r[4], r[5], r[6]); approx(sp, 2, 2e-3, 'cone speed');
          if (Math.acos(Math.min(1, r[5] / sp)) > half + 1e-3) throw new Error('cone direction outside half angle');
        }
        // world space bakes the emitter transform; local space keeps local coordinates
        const w = await read({ shape: 'point', space: 'world' }, T(7, 0, 0)), l = await read({ shape: 'point', space: 'local' }, T(7, 0, 0));
        approx(w[0][0], 7, 1e-4, 'world-space position'); approx(l[0][0], 0, 1e-4, 'local-space position');
        return 'sphere surface / box / cone / world+local space OK';
      },
    },
    {
      name: 'particles: indirect args are produced on the GPU (draw count = alive, dispatch = ceil(alive/64))',
      run: async () => {
        const { system } = setup(gpu);
        const p = pool(system, { maxCount: 4096 }, { rate: 2000, lifetime: [1, 1] });
        step(gpu, system, 20, 1 / 60);
        const c = await p.readCounters(), a = await p.readArgs();
        if (a[0] !== 6 || a[1] !== c.alive || a[2] !== 0 || a[3] !== 0) throw new Error(`draw args ${Array.from(a.subarray(0, 4))} vs alive ${c.alive}`);
        if (a[12] !== Math.ceil(c.alive / 64) || a[13] !== 1 || a[14] !== 1) throw new Error(`dispatch args ${Array.from(a.subarray(12, 15))}`);
        return `alive ${c.alive}: draw ${a[1]}, dispatch ${a[12]}`;
      },
    },
    {
      name: 'particles: billboard rendering (4 orientations x alpha/additive) draws something at the screen centre',
      run: async () => {
        const { device } = gpu;
        const frameBuf = gpu.resources.buffers.create('frame', 224, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        const cam = new Camera(); cam.position.set([0, 0, 4]); cam.target.set([0, 0, 0]); cam.aspect = 1; cam.update();
        const fd = new Float32Array(56); fd.set(cam.viewProjection, 0); fd.set(cam.view, 16); fd.set(cam.projection, 32); fd.set(cam.position, 48); fd[52] = 64; fd[53] = 64; fd[54] = cam.near; fd[55] = cam.far;
        device.queue.writeBuffer(frameBuf, 0, fd);
        const { system, layouts } = setup(gpu);
        const frameBG = device.createBindGroup({ layout: layouts.frame, entries: [{ binding: 0, resource: { buffer: frameBuf } }] });
        const color = gpu.resources.textures.create({ size: [64, 64], format: TARGET.colorFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        const depth = gpu.resources.textures.create({ size: [64, 64], format: TARGET.depthFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT });
        const results: string[] = [];
        device.pushErrorScope('validation');
        for (const orientation of ['screen', 'camera', 'worldUp', 'point'] as const) {
          for (const blend of ['alpha', 'additive'] as const) {
            const p = system.createPool({ maxCount: 512, billboard: { orientation, blend } });
            p.addEmitter({ shape: 'point', bursts: [{ time: 0, count: 100 }], lifetime: [5, 5], size: orientation === 'point' ? [24, 24] : [0.8, 0.8], colorStart: [1, 0.6, 0.3, 1], colorEnd: [1, 0.6, 0.3, 1], loop: false, duration: 0.01 });
            step(gpu, system, 2, 1 / 60);
            system.pools.forEach((q) => { if (q !== p) q.emitters.forEach((e) => { e.enabled = false; }); });
            const enc = device.createCommandEncoder();
            const pass = enc.beginRenderPass({
              colorAttachments: [{ view: color.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
              depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
            });
            p.encodeDraw(pass, frameBG); pass.end();
            device.queue.submit([enc.finish()]);
            const px = await readTextureRGBA8(device, color, 0, 64, 64);
            /** Sum of the RGB channels of pixel (x, y). */
            const at = (x: number, y: number) => px[(y * 64 + x) * 4] + px[(y * 64 + x) * 4 + 1] + px[(y * 64 + x) * 4 + 2];
            if (at(32, 32) < 60) throw new Error(`${orientation}/${blend}: centre pixel too dark (${at(32, 32)})`);
            if (at(1, 1) !== 0) throw new Error(`${orientation}/${blend}: corner pixel should be untouched`);
            results.push(`${orientation}/${blend}:${at(32, 32)}`);
          }
        }
        const err = await device.popErrorScope();
        if (err) throw new Error('validation error: ' + err.message);
        return results.join(' ');
      },
    },
    {
      name: 'particles: mesh particles render through ONE indirect indexed draw',
      run: async () => {
        const { device } = gpu;
        const frameBuf = gpu.resources.buffers.create('frame2', 224, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        const cam = new Camera(); cam.position.set([0, 0, 4]); cam.aspect = 1; cam.update();
        const fd = new Float32Array(56); fd.set(cam.viewProjection, 0); fd.set(cam.view, 16); fd.set(cam.projection, 32); fd.set(cam.position, 48);
        device.queue.writeBuffer(frameBuf, 0, fd);
        const { system, layouts, meshes } = setup(gpu);
        const frameBG = device.createBindGroup({ layout: layouts.frame, entries: [{ binding: 0, resource: { buffer: frameBuf } }] });
        const cube = meshes.create('cube', createCube());
        const p = system.createPool({ maxCount: 512, mesh: { meshId: cube } });
        p.addEmitter({ shape: 'sphere', radius: 0.3, bursts: [{ time: 0, count: 80 }], lifetime: [5, 5], size: [0.4, 0.4], angularVelocity: [1, 2], colorStart: [0.4, 0.9, 0.5, 1], colorEnd: [0.4, 0.9, 0.5, 1], loop: false, duration: 0.01 });
        step(gpu, system, 2, 1 / 60);
        const color = gpu.resources.textures.create({ size: [64, 64], format: TARGET.colorFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        const depth = gpu.resources.textures.create({ size: [64, 64], format: TARGET.depthFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT });
        device.pushErrorScope('validation');
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({
          colorAttachments: [{ view: color.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
          depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
        });
        p.encodeDraw(pass, frameBG); pass.end();
        device.queue.submit([enc.finish()]);
        const err = await device.popErrorScope();
        if (err) throw new Error('validation error: ' + err.message);
        const px = await readTextureRGBA8(device, color, 0, 64, 64);
        /** Sum of the RGB channels of pixel (x, y). */
        const at = (x: number, y: number) => px[(y * 64 + x) * 4] + px[(y * 64 + x) * 4 + 1] + px[(y * 64 + x) * 4 + 2];
        if (at(32, 32) < 60) throw new Error(`centre too dark: ${at(32, 32)}`);
        if (at(1, 1) !== 0) throw new Error('corner not black');
        const a = await p.readArgs();
        if (a[4] !== 36 || a[5] !== 80) throw new Error(`indexed args ${Array.from(a.subarray(4, 9))}`);
        return `centre ${at(32, 32)}; drawIndexedIndirect(indexCount ${a[4]}, instances ${a[5]})`;
      },
    },
  ];
}
