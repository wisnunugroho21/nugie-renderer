import { GPUContext } from '../gpu/GPUContext';
import { Renderer } from '../rendering/Renderer';
import { RenderWorld } from '../rendering/RenderWorld';
import { RenderExtractor } from '../rendering/RenderExtractor';
import { World } from '../ecs/World';
import { TransformSystem } from '../ecs/systems/TransformSystem';
import { BoundsSystem } from '../ecs/systems/BoundsSystem';
import { entityIndex } from '../ecs/Entity';
import { createPlane, createUVSphere } from '../rendering/primitives';
import { LightType } from '../ecs/components/LightStore';
import { RenderFlags } from '../ecs/components/MeshRendererStore';

export interface PassBenchRow { config: string; passes: [string, number][]; totalMs: number; }

/**
 * Benchmark B: GPU time per pass (timestamp queries) for a feature-complete frame: cascaded sun + spot shadows, 512 clustered point
 * lights, IBL, volumetric fog, and a 3000-sphere field. Each row switches one feature off to show what it costs.
 */
export async function runPassBench(canvas: HTMLCanvasElement, frames = 40): Promise<PassBenchRow[]> {
  const gpu = await GPUContext.create(canvas);
  const renderer = new Renderer(gpu);
  if (!renderer.profiler.supported) return [];
  const sphere = renderer.meshes.create('sphere', createUVSphere(32, 16)), plane = renderer.meshes.create('plane', createPlane());
  const mat = renderer.materials.createPBR({ baseColor: [0.8, 0.75, 0.7, 1], roughness: 0.5, metallic: 0 });
  const world = new World();
  const ts = new TransformSystem(world.transforms), bs = new BoundsSystem(world.transforms, world.bounds), ex = new RenderExtractor(world, ts), rw = new RenderWorld();
  let seed = 3;
  /** Deterministic pseudo-random number in [0, 1) (LCG). */
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const flags = RenderFlags.CastShadow | RenderFlags.ReceiveShadow;
  const g = entityIndex(world.create());
  world.transforms.add(g, 0, 0, 0); world.transforms.setScale(g, 80, 1, 80);
  world.meshRenderers.add(g, plane, mat, flags); world.bounds.add(g, -0.5, 0, -0.5, 0.5, 0, 0.5);
  for (let i = 0; i < 3000; i++) {
    const e = entityIndex(world.create());
    world.transforms.add(e, (rnd() - 0.5) * 70, 0.6, (rnd() - 0.5) * 70);
    world.meshRenderers.add(e, sphere, mat, flags); world.bounds.add(e, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5);
  }
  const sun = entityIndex(world.create());
  world.transforms.add(sun); world.transforms.setRotation(sun, -0.5, 0.2, 0.1, 0.84);
  world.lights.add(sun, LightType.Directional, 1, 0.95, 0.85, 2.5); world.lights.castShadow[sun] = 1;
  for (let i = 0; i < 512; i++) {
    const e = entityIndex(world.create());
    world.transforms.add(e, (rnd() - 0.5) * 70, 1.5, (rnd() - 0.5) * 70);
    world.lights.add(e, LightType.Point, rnd(), rnd(), rnd(), 20, 6);
  }
  const cam = entityIndex(world.create());
  world.transforms.add(cam, 0, 12, 40); world.transforms.setRotation(cam, -0.2, 0, 0, Math.sqrt(1 - 0.04));
  world.cameras.add(cam, Math.PI / 3, 0.1, 300);
  ts.update(); bs.update(ts.updated); ex.extract(rw, canvas.width / canvas.height);
  renderer.setEnvironment(renderer.ibl.fromSky(), 0.6);
  renderer.enableFog({ density: 0.01 });

  const rows: PassBenchRow[] = [];
  const configs: [string, () => void][] = [
    ['everything on', () => { renderer.shadows.enabled = true; renderer.fog!.enabled = true; renderer.clusteredShading = true; renderer.depthPrepass = false; }],
    ['no fog', () => { renderer.fog!.enabled = false; }],
    ['no shadows', () => { renderer.fog!.enabled = true; renderer.shadows.enabled = false; }],
    ['no shadows, no fog', () => { renderer.fog!.enabled = false; }],
    ['everything + depth prepass', () => { renderer.shadows.enabled = true; renderer.fog!.enabled = true; renderer.depthPrepass = true; }],
  ];
  for (const [config, apply] of configs) {
    apply();
    for (let i = 0; i < 10; i++) renderer.render(rw);
    await gpu.queue.onSubmittedWorkDone();
    renderer.profiler.smoothed.clear();
    for (let f = 0; f < frames; f++) { renderer.render(rw); await gpu.queue.onSubmittedWorkDone(); await new Promise((r) => setTimeout(r, 4)); }
    const passes = [...renderer.profiler.smoothed].sort((a, b) => b[1] - a[1]);
    rows.push({ config, passes, totalMs: passes.reduce((s, p) => s + p[1], 0) });
  }
  return rows;
}
