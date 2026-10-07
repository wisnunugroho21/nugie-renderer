import { GPUContext } from '../gpu/GPUContext';
import { Renderer, type BatchingMode } from '../rendering/Renderer';
import { RenderWorld } from '../rendering/RenderWorld';
import { RenderExtractor } from '../rendering/RenderExtractor';
import { World } from '../ecs/World';
import { TransformSystem } from '../ecs/systems/TransformSystem';
import { BoundsSystem } from '../ecs/systems/BoundsSystem';
import { entityIndex } from '../ecs/Entity';
import { createCube, createUVSphere } from '../rendering/primitives';
import { runLightBench } from './lightBench';
import { runCullBench } from './cullBench';
import { runPassBench } from './passBench';
import { runAnimBench, formatAnimRows, type AnimBenchConfig, type AnimBenchRow } from './animBench';

interface Row { mode: string; draws: number; pipelineSw: number; materialSw: number; meshSw: number; cpuTotalMs: number; cpuEncodeMs: number; cpuSortMs: number; cpuBatchMs: number; submitToDoneMs: number; }

const out = document.getElementById('out')!;
/** Append a line to the page's output element. */
const log = (s: string) => { out.textContent += '\n' + s; };

/** Benchmark A: draw `count` objects (`materials` x `meshes` variants) under each batching mode and measure CPU phases and submit-to-done latency. */
async function benchmarkA(count: number, materials: number, meshes: number, frames: number): Promise<Row[]> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const gpu = await GPUContext.create(canvas);
  const renderer = new Renderer(gpu);
  const cube = renderer.meshes.create('cube', createCube());
  const sphere = renderer.meshes.create('sphere', createUVSphere(8, 6));
  const meshIds = [cube, sphere].slice(0, meshes);
  const matIds = Array.from({ length: materials }, (_, i) => renderer.materials.createPBR({ roughness: i / Math.max(1, materials - 1) }));

  const world = new World();
  const ts = new TransformSystem(world.transforms), bs = new BoundsSystem(world.transforms, world.bounds);
  const ex = new RenderExtractor(world, ts), rw = new RenderWorld();
  const side = Math.ceil(Math.cbrt(count));
  let seed = 12345;
  /** Deterministic pseudo-random number in [0, 1) (LCG). */
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < count; i++) {
    const e = entityIndex(world.create());
    world.transforms.add(e, (i % side) * 1.2, (Math.floor(i / side) % side) * 1.2, Math.floor(i / (side * side)) * 1.2);
    world.transforms.setScale(e, 0.5, 0.5, 0.5);
    world.meshRenderers.add(e, meshIds[Math.floor(rnd() * meshIds.length)], matIds[Math.floor(rnd() * matIds.length)]);
    world.bounds.add(e, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5);
  }
  const cam = entityIndex(world.create());
  world.transforms.add(cam, side * 0.6, side * 0.6, side * 3);
  world.cameras.add(cam, Math.PI / 3, 0.1, 1000);
  ts.update(); bs.update(ts.updated); ex.extract(rw, canvas.width / canvas.height);

  const rows: Row[] = [];
  for (const mode of ['unsorted', 'sorted', 'instanced'] as BatchingMode[]) {
    renderer.batching = mode;
    for (let i = 0; i < 10; i++) renderer.render(rw);               // warm-up (pipeline creation etc.)
    await gpu.queue.onSubmittedWorkDone();
    let total = 0, enc = 0, sort = 0, batch = 0, done = 0;
    for (let f = 0; f < frames; f++) {
      const t0 = performance.now();
      renderer.render(rw);
      await gpu.queue.onSubmittedWorkDone();
      done += performance.now() - t0;
      total += renderer.stats.cpu.total; enc += renderer.stats.cpu.encoding; sort += renderer.stats.cpu.sorting; batch += renderer.stats.cpu.batching;
    }
    const s = renderer.stats;
    rows.push({
      mode, draws: s.drawCalls, pipelineSw: s.pipelineSwitches, materialSw: s.materialSwitches, meshSw: s.meshSwitches,
      cpuTotalMs: total / frames, cpuEncodeMs: enc / frames, cpuSortMs: sort / frames, cpuBatchMs: batch / frames, submitToDoneMs: done / frames,
    });
  }
  return rows;
}

/** Format Benchmark A rows as a text table with the CPU speed-up versus the unsorted baseline. */
function table(rows: Row[]): string {
  const base = rows[0];
  /** Format a number with 3 decimals, right-aligned to 8 characters. */
  const f = (n: number) => n.toFixed(3).padStart(8);
  let s = 'mode        draws  pipeSw  matSw  meshSw  cpuTotal  encode    sort   batch  submit→done  (cpu speedup vs unsorted)\n';
  for (const r of rows) {
    s += `${r.mode.padEnd(10)} ${String(r.draws).padStart(6)} ${String(r.pipelineSw).padStart(7)} ${String(r.materialSw).padStart(6)} ${String(r.meshSw).padStart(7)} ` +
      `${f(r.cpuTotalMs)}${f(r.cpuEncodeMs)}${f(r.cpuSortMs)}${f(r.cpuBatchMs)}${f(r.submitToDoneMs)}      ${(base.cpuTotalMs / r.cpuTotalMs).toFixed(2)}x\n`;
  }
  return s;
}

/** Run all animation benchmark groups (skinning crowds, morph targets, skin + morph) on one GPU context. */
async function animSuite(): Promise<Record<string, AnimBenchRow[]>> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const gpu = await GPUContext.create(canvas);
  const base = { radial: 64, rings: 256, frames: 40 };
  const suites: Record<string, AnimBenchConfig[]> = {
    'D: skinned crowd (3 joints, 16.7k verts each)': [1, 100, 500, 1000].map((count) => ({
      ...base, name: `skin x${count}`, count, skinned: true, animateJoints: true, morphTargets: 0, activeTargets: 0,
    })),
    'E: morphing, vertex-bound (200 instances, 16 targets, 16.7k verts)': [0, 1, 4, 8, 16].map((k) => ({
      ...base, name: `morph ${k} active`, count: 200, skinned: false, animateJoints: false, morphTargets: 16, activeTargets: k, distanceScale: 12,
    })),
    'F: skin + morph, vertex-bound (200 instances, 8 targets)': [0, 4, 8].map((k) => ({
      ...base, name: `skin+morph ${k} active`, count: 200, skinned: true, animateJoints: true, morphTargets: 8, activeTargets: k, distanceScale: 12,
    })),
    'D2: skinned crowd, vertex-bound': [100, 500, 1000].map((count) => ({
      ...base, name: `skin x${count} (far)`, count, skinned: true, animateJoints: true, morphTargets: 0, activeTargets: 0, distanceScale: 12,
    })),
    'baseline: static (no skin, no morph), vertex-bound': [200].map((count) => ({
      ...base, name: `static x${count} (far)`, count, skinned: false, animateJoints: false, morphTargets: 0, activeTargets: 0, distanceScale: 12,
    })),
  };
  const results: Record<string, AnimBenchRow[]> = {};
  for (const [name, cfgs] of Object.entries(suites)) {
    log(`\n== ${name} ==`);
    const rows: AnimBenchRow[] = [];
    for (const c of cfgs) { rows.push(await runAnimBench(gpu, canvas, c)); log(formatAnimRows([rows[rows.length - 1]]).split('\n')[1]); }
    results[name] = rows;
  }
  return results;
}

/** Publish results for automated readers (`window.__benchResults`) and flag the page title as finished. */
function finish(results: unknown): void {
  (window as unknown as { __benchResults: unknown }).__benchResults = results;
  document.title = 'DONE';
}

/** Benchmark A (default suite): draw-submission strategies on 10k objects. */
async function runDrawSubmissionSuite(): Promise<void> {
  const results: Record<string, Row[]> = {};
  const cfgs: [string, number, number, number][] = [
    ['A1: 10,000 cubes, 1 material, 1 mesh', 10000, 1, 1],
    ['A2: 10,000 objects, 8 materials, 2 meshes', 10000, 8, 2],
  ];
  for (const [name, n, m, k] of cfgs) {
    log(`\n== ${name} ==`);
    results[name] = await benchmarkA(n, m, k, 60);
    log(table(results[name]));
  }
  finish(results);
}

/** Benchmark suites selectable with `?suite=<name>`; each logs its table and publishes its rows. */
const SUITES: Record<string, (canvas: HTMLCanvasElement, params: URLSearchParams) => Promise<void>> = {
  /** Benchmark C: clustered vs naive light loop for growing light counts. */
  async lights(canvas, params) {
    const dense = params.get('dense') === '1';
    const rows = await runLightBench(canvas, dense ? [256, 1024] : [16, 64, 256, 1024, 4096], 30, dense ? 6000 : 400, dense);
    log('== C: fragment-bound lighting (point lights, range 5, 60x60 floor + 400 spheres) ==');
    log('lights  mode          gpu ms (submit->done)  cpu ms  clusters');
    for (const r of rows) log(`${String(r.lights).padStart(6)}  ${r.mode.padEnd(12)}  ${r.gpuMs.toFixed(2).padStart(10)}  ${r.cpuMs.toFixed(2).padStart(10)}  ${r.clusters}`);
    finish(rows);
  },
  /** Benchmark B: GPU time per pass with every feature enabled (timestamp queries). */
  async passes(canvas) {
    const rows = await runPassBench(canvas);
    log('== B: GPU time per pass (timestamp queries; sun + spot shadows, 512 clustered lights, IBL, fog, 3000 spheres) ==');
    for (const r of rows) log(r.config.padEnd(30) + ' total ' + r.totalMs.toFixed(2).padStart(6) + ' ms   ' + r.passes.map(([k, v]) => k + ' ' + v.toFixed(2)).join('  '));
    finish(rows);
  },
  /** Benchmark G: CPU vs GPU-driven frustum / Hi-Z culling on a heavily occluded scene. */
  async cull(canvas, params) {
    const rows = await runCullBench(canvas, Number(params.get('n') ?? 20000));
    log('== G: GPU-driven visibility (CPU culling disabled; GPU latency = submit->done) ==');
    for (const r of rows) log(`${r.scene.padEnd(40)} ${r.mode.padEnd(8)} gpu ${r.gpuMs.toFixed(2).padStart(8)} ms  cpu ${r.cpuMs.toFixed(2).padStart(6)} ms  draws ${r.drawn}  GPU passes ${r.passMs.toFixed(2)} ms`);
    finish(rows);
  },
  /** Benchmarks D-F: skinning and morphing. */
  async anim() { finish(await animSuite()); },
};

(async () => {
  try {
    const params = new URLSearchParams(location.search);
    const suite = SUITES[params.get('suite') ?? ''];
    if (suite) await suite(document.getElementById('canvas') as HTMLCanvasElement, params);
    else await runDrawSubmissionSuite();
  } catch (e) {
    log('ERROR: ' + String(e));
    document.title = 'FAILED';
  }
})();
