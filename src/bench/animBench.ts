import { GPUContext } from '../gpu/GPUContext';
import { Renderer } from '../rendering/Renderer';
import { RenderWorld } from '../rendering/RenderWorld';
import { RenderExtractor } from '../rendering/RenderExtractor';
import { World } from '../ecs/World';
import { TransformSystem } from '../ecs/systems/TransformSystem';
import { BoundsSystem } from '../ecs/systems/BoundsSystem';
import { AnimationSystem } from '../ecs/systems/AnimationSystem';
import { SkeletonSystem } from '../ecs/systems/SkeletonSystem';
import { entityIndex } from '../ecs/Entity';
import { loadGLTF } from '../assets/gltf/GLTFLoader';
import { instantiateGLTF } from '../assets/gltf/GLTFInstantiator';
import { AnimatedInstance } from '../animation/Animator';
import { Animator } from '../animation/AnimatorHandle';
import { buildTentacleGLB } from '../demos/tentacle';
import { Quat } from '../math/Quat';

export interface AnimBenchConfig {
  name: string;
  count: number;
  radial: number; rings: number;
  skinned: boolean; animateJoints: boolean;
  morphTargets: number; activeTargets: number;
  frames: number;
  /** >1 pushes the camera away so triangles are tiny and the run becomes vertex-bound (isolates deformation cost). */
  distanceScale?: number;
}

export interface AnimBenchRow {
  name: string; count: number; vertices: number; activeTargets: number;
  animMs: number; transformSkeletonMs: number; extractMs: number; renderCpuMs: number; totalCpuMs: number;
  jointUploadBytes: number; morphUploadBytes: number; draws: number; instances: number; submitToDoneMs: number;
}

export async function runAnimBench(gpu: GPUContext, canvas: HTMLCanvasElement, cfg: AnimBenchConfig): Promise<AnimBenchRow> {
  const renderer = new Renderer(gpu);
  const world = new World();
  const ts = new TransformSystem(world.transforms), bs = new BoundsSystem(world.transforms, world.bounds);
  const anim = new AnimationSystem(world), skel = new SkeletonSystem(world, renderer.joints);
  const rw = new RenderWorld(), ex = new RenderExtractor(world, ts);

  const asset = await loadGLTF(buildTentacleGLB({ radial: cfg.radial, rings: cfg.rings, morphTargets: cfg.morphTargets, skinned: cfg.skinned }));
  const side = Math.ceil(Math.sqrt(cfg.count));
  let shared: AnimatedInstance | undefined;
  const owners: number[] = [];
  const weights = new Float32Array(Math.max(1, cfg.morphTargets));
  for (let i = 0; i < cfg.count; i++) {
    const inst = instantiateGLTF(asset, { world, meshes: renderer.meshes, materials: renderer.materials });
    const root = entityIndex(inst.root);
    world.transforms.setPosition(root, ((i % side) - (side - 1) / 2) * 0.8, 0, (Math.floor(i / side) - (side - 1) / 2) * 0.8);
    if (cfg.skinned && cfg.animateJoints) {
      const ai = AnimatedInstance.fromGLTF(asset, inst, shared); shared ??= ai;
      const a = Animator.attach(world, root, ai, ai.clipIndex('wave'));
      a.time = (i * 0.173) % a.duration; a.setSpeed(1).play();
    }
    const morphOwner = world.meshRenderers.morphOwner[entityIndex(inst.meshEntities[0])];
    if (morphOwner >= 0) owners.push(morphOwner);
  }
  const cam = entityIndex(world.create());
  const ds = cfg.distanceScale ?? 1;
  world.transforms.add(cam, 0, (side * 0.5 + 3) * ds, (side * 0.8 + 6) * ds);
  const pitch = Math.atan2((side * 0.5 + 2) * ds, (side * 0.8 + 6) * ds);
  const q = Quat.fromAxisAngle(Quat.create(), 1, 0, 0, -pitch);
  world.transforms.setRotation(cam, q[0], q[1], q[2], q[3]);
  world.cameras.add(cam, Math.PI / 3, 0.1, 400 * ds);

  let t = 0;
  const frame = () => {
    const dt = 1 / 60; t += dt;
    const a0 = performance.now();
    anim.update(dt);
    // drive `activeTargets` morph weights through the same MorphStore path the animation system uses
    for (let k = 0; k < cfg.activeTargets; k++) weights[k] = 0.5 + 0.5 * Math.sin(t * (1 + k * 0.3));
    for (const o of owners) world.morphs.setWeights(o, weights);
    const a1 = performance.now();
    ts.update(); skel.update(ts.updated); bs.update(ts.updated);
    const a2 = performance.now();
    ex.extract(rw, canvas.width / canvas.height);
    const a3 = performance.now();
    renderer.render(rw, undefined, t);
    const a4 = performance.now();
    return [a1 - a0, a2 - a1, a3 - a2, a4 - a3];
  };

  for (let i = 0; i < 20; i++) frame();            // warm-up (pipelines, bind groups)
  await gpu.queue.onSubmittedWorkDone();
  const sums = [0, 0, 0, 0]; let done = 0, joint = 0, morph = 0;
  for (let f = 0; f < cfg.frames; f++) {
    const t0 = performance.now();
    const m = frame();
    await gpu.queue.onSubmittedWorkDone();
    done += performance.now() - t0;
    for (let k = 0; k < 4; k++) sums[k] += m[k];
    joint += renderer.stats.animation.jointUploadBytes; morph += renderer.stats.animation.morphUploadBytes;
  }
  const n = cfg.frames, s = renderer.stats;
  return {
    name: cfg.name, count: cfg.count, vertices: (cfg.radial + 1) * (cfg.rings + 1), activeTargets: cfg.activeTargets,
    animMs: sums[0] / n, transformSkeletonMs: sums[1] / n, extractMs: sums[2] / n, renderCpuMs: sums[3] / n,
    totalCpuMs: (sums[0] + sums[1] + sums[2] + sums[3]) / n, jointUploadBytes: joint / n, morphUploadBytes: morph / n,
    draws: s.drawCalls, instances: s.instances, submitToDoneMs: done / n,
  };
}

export function formatAnimRows(rows: AnimBenchRow[]): string {
  const f = (x: number, w = 7) => x.toFixed(3).padStart(w);
  let s = 'config                      chars  verts  tgts   anim   xf+skel  extract  renderCPU  totalCPU  jointB  morphB  draws  submit->done\n';
  for (const r of rows) {
    s += `${r.name.padEnd(26)} ${String(r.count).padStart(6)} ${String(r.vertices).padStart(6)} ${String(r.activeTargets).padStart(5)} ${f(r.animMs)} ${f(r.transformSkeletonMs, 8)} ${f(r.extractMs, 8)} ${f(r.renderCpuMs, 10)} ${f(r.totalCpuMs, 9)} `
      + `${r.jointUploadBytes.toFixed(0).padStart(7)} ${r.morphUploadBytes.toFixed(0).padStart(7)} ${String(r.draws).padStart(6)} ${f(r.submitToDoneMs, 10)} ms\n`;
  }
  return s;
}
