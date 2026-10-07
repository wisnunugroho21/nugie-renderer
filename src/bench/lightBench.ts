import { GPUContext } from '../gpu/GPUContext';
import { Renderer } from '../rendering/Renderer';
import { RenderWorld } from '../rendering/RenderWorld';
import { RenderExtractor } from '../rendering/RenderExtractor';
import { World } from '../ecs/World';
import { TransformSystem } from '../ecs/systems/TransformSystem';
import { entityIndex } from '../ecs/Entity';
import { createPlane, createUVSphere } from '../rendering/primitives';
import { LightType } from '../ecs/components/LightStore';

export interface LightBenchRow { lights: number; mode: string; gpuMs: number; cpuMs: number; clusters: number; }

/**
 * Benchmark C: fragment-bound lighting. A lit floor plus a field of spheres, N point lights (range 5) scattered over a 60 x 60 area.
 * `gpuMs` = average submit -> onSubmittedWorkDone latency per frame (the GPU is the bottleneck; CPU cost is tiny and constant).
 */
export async function runLightBench(canvas: HTMLCanvasElement, counts: number[] /* ascending */, frames = 30, spheres = 400, prepassToo = false): Promise<LightBenchRow[]> {
  const gpu = await GPUContext.create(canvas);
  const renderer = new Renderer(gpu);
  const sphere = renderer.meshes.create('sphere', createUVSphere(24, 12));
  const plane = renderer.meshes.create('plane', createPlane());
  const mat = renderer.materials.createPBR({ baseColor: [0.8, 0.8, 0.8, 1], roughness: 0.45, metallic: 0 });
  const world = new World();
  const ts = new TransformSystem(world.transforms), ex = new RenderExtractor(world, ts), rw = new RenderWorld();
  let seed = 7;
  /** Deterministic pseudo-random number in [0, 1) (LCG). */
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const g = entityIndex(world.create());
  world.transforms.add(g, 0, 0, 0); world.transforms.setScale(g, 70, 1, 70);
  world.meshRenderers.add(g, plane, mat);
  world.bounds.add(g, -0.5, 0, -0.5, 0.5, 0, 0.5);
  for (let i = 0; i < spheres; i++) {
    const e = entityIndex(world.create());
    world.transforms.add(e, (rnd() - 0.5) * 56, 0.8, (rnd() - 0.5) * 56);
    world.meshRenderers.add(e, sphere, mat);
    world.bounds.add(e, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5);
  }
  const cam = entityIndex(world.create());
  world.transforms.add(cam, 0, 14, 34);
  world.transforms.setRotation(cam, -0.2, 0, 0, Math.sqrt(1 - 0.04));
  world.cameras.add(cam, Math.PI / 3, 0.1, 200);
  const sun = entityIndex(world.create());
  world.transforms.add(sun); world.lights.add(sun, LightType.Directional, 1, 1, 1, 0.3);
  const lightEntities: number[] = [];

  const rows: LightBenchRow[] = [];
  for (const n of counts) {
    while (lightEntities.length < n) {
      const e = entityIndex(world.create());
      world.transforms.add(e, (rnd() - 0.5) * 60, 1 + rnd() * 2, (rnd() - 0.5) * 60);
      world.lights.add(e, LightType.Point, 0.4 + rnd() * 0.6, 0.4 + rnd() * 0.6, 0.4 + rnd() * 0.6, 8, 5);
      lightEntities.push(e);
    }
    ts.update(); ex.extract(rw, canvas.width / canvas.height);
    for (const [clustered, prepass] of (prepassToo ? [[true, false], [true, true]] : [[false, false], [true, false]]) as [boolean, boolean][]) {
      renderer.clusteredShading = clustered; renderer.depthPrepass = prepass;
      for (let i = 0; i < 8; i++) renderer.render(rw);
      await gpu.queue.onSubmittedWorkDone();
      let gpuMs = 0, cpuMs = 0;
      for (let f = 0; f < frames; f++) {
        const t0 = performance.now();
        renderer.render(rw);
        await gpu.queue.onSubmittedWorkDone();
        gpuMs += performance.now() - t0; cpuMs += renderer.stats.cpu.total;
      }
      rows.push({ lights: n, mode: (clustered ? 'clustered' : 'naive loop') + (prepass ? '+prepass' : ''), gpuMs: gpuMs / frames, cpuMs: cpuMs / frames, clusters: renderer.stats.lighting.clusters });
    }
  }
  return rows;
}
