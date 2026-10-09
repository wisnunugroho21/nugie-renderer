import { GPUContext } from '../gpu/GPUContext';
import { Renderer } from '../rendering/Renderer';
import { RenderWorld } from '../rendering/RenderWorld';
import { RenderExtractor } from '../rendering/RenderExtractor';
import { World } from '../ecs/World';
import { TransformSystem } from '../ecs/systems/TransformSystem';
import { BoundsSystem } from '../ecs/systems/BoundsSystem';
import { entityIndex } from '../ecs/Entity';
import { createCube, createUVSphere } from '../rendering/primitives';
import { LightType } from '../ecs/components/LightStore';

export interface CullBenchRow { scene: string; mode: string; gpuMs: number; cpuMs: number; drawn: number; /** summed GPU pass timestamps (0 if unsupported) */ passMs: number }

/**
 * Benchmark G: GPU-driven visibility. A dense sphere field (hidden behind a wall when `occluded`), rendered with CPU-side culling
 * disabled so every object reaches the renderer: 'off' (no GPU culling), 'frustum' (GPU frustum cull + indirect) and 'hiz2' (two-phase Hi-Z).
 */
export async function runCullBench(canvas: HTMLCanvasElement, count: number, frames = 30): Promise<CullBenchRow[]> {
  const gpu = await GPUContext.create(canvas);
  const rows: CullBenchRow[] = [];
  for (const occluded of [false, true]) {
    const renderer = new Renderer(gpu);
    const sphere = renderer.meshes.create('sphere', createUVSphere(48, 24)), cube = renderer.meshes.create('cube', createCube());
    const mats = [0, 1, 2, 3].map((i) => renderer.materials.createPBR({ baseColor: [0.9 - i * 0.2, 0.5, 0.3 + i * 0.15, 1], roughness: 0.5 }));
    const world = new World();
    const ts = new TransformSystem(world.transforms), bs = new BoundsSystem(world.transforms, world.bounds), ex = new RenderExtractor(world, ts), rw = new RenderWorld();
    if (occluded) {
      const w = entityIndex(world.create());
      world.transforms.add(w, 0, 0, 10); world.transforms.setScale(w, 80, 60, 2);
      world.meshRenderers.add(w, cube, mats[0]); world.bounds.add(w, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5);
    }
    const side = Math.ceil(Math.cbrt(count));
    for (let i = 0; i < count; i++) {
      const e = entityIndex(world.create());
      world.transforms.add(e, ((i % side) - side / 2) * 2.5, (Math.floor(i / side) % side - side / 2) * 2.5, 16 + Math.floor(i / (side * side)) * 2.5);
      world.meshRenderers.add(e, sphere, mats[i % 4]); world.bounds.add(e, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5);
    }
    const cam = entityIndex(world.create());
    world.transforms.add(cam, 0, 0, -30);
    world.transforms.setRotation(cam, 0, 1, 0, 0);   // look toward +Z
    world.cameras.add(cam, Math.PI / 3, 0.1, 300);
    const sun = entityIndex(world.create());
    world.transforms.add(sun); world.lights.add(sun, LightType.Directional, 1, 1, 1, 2);
    ts.update(); bs.update(ts.updated); ex.extract(rw, canvas.width / canvas.height);
    (window as unknown as { __cull: unknown }).__cull = { renderer, rw, gpu, canvas };
    for (const mode of ['off', 'frustum', 'hiz2'] as const) {
      renderer.gpuCulling = mode;
      for (let i = 0; i < 8; i++) renderer.render(rw);
      await gpu.queue.onSubmittedWorkDone();
      let gpuMs = 0, cpuMs = 0, passMs = 0;
      for (let f = 0; f < frames; f++) {
        const t0 = performance.now();
        renderer.render(rw);
        await gpu.queue.onSubmittedWorkDone();
        gpuMs += performance.now() - t0; cpuMs += renderer.stats.cpu.total;
        await new Promise((r) => setTimeout(r, 5));
        for (const v of renderer.profiler.results.values()) passMs += v;
      }
      rows.push({ scene: occluded ? `${count} spheres behind a wall` : `${count} spheres, mostly visible/frustum`, mode, gpuMs: gpuMs / frames, cpuMs: cpuMs / frames, drawn: renderer.stats.drawCalls, passMs: passMs / frames });
    }
  }
  return rows;
}
