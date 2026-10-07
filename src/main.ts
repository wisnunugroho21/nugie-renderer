import { Application } from './app/Application';
import { OrbitController } from './app/OrbitController';
import { Renderer, DEFAULT_SCENE, type BatchingMode } from './rendering/Renderer';
import { RenderWorld } from './rendering/RenderWorld';
import { RenderExtractor } from './rendering/RenderExtractor';
import { World } from './ecs/World';
import { TransformSystem } from './ecs/systems/TransformSystem';
import { BoundsSystem } from './ecs/systems/BoundsSystem';
import { AnimationSystem } from './ecs/systems/AnimationSystem';
import { SkeletonSystem } from './ecs/systems/SkeletonSystem';
import { ParticleEmitterSystem } from './ecs/systems/ParticleEmitterSystem';
import { RibbonEmitterSystem } from './ecs/systems/RibbonEmitterSystem';
import { entityIndex } from './ecs/Entity';
import { VisibilitySystem, type CullMode } from './visibility/VisibilitySystem';
import { TextureLoader } from './assets/TextureLoader';
import type { Demo, DemoContext } from './demos/Demo';
import { materialsDemo } from './demos/materialsDemo';
import { gltfDemo } from './demos/gltfDemo';
import { characterDemo } from './demos/characterDemo';
import { particlesDemo } from './demos/particlesDemo';
import { lodDemo } from './demos/lodDemo';
import { lightsDemo } from './demos/lightsDemo';
import { occlusionDemo } from './demos/occlusionDemo';
import { streamingDemo } from './demos/streamingDemo';

const DEMOS: Record<string, Demo> = { materials: materialsDemo, gltf: gltfDemo, character: characterDemo, particles: particlesDemo, lod: lodDemo, lights: lightsDemo, occlusion: occlusionDemo, streaming: streamingDemo };

async function main() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const app = new Application(canvas);
  try {
    await app.init();
  } catch (e) {
    hud.textContent = String(e);
    return;
  }
  const gpu = app.gpu;
  const params = new URLSearchParams(location.search);
  const renderer = new Renderer(gpu);
  app.onResize = (w, h) => renderer.resize(w, h);
  renderer.batching = (params.get('mode') as BatchingMode) ?? 'instanced';
  renderer.clusteredShading = params.get('cluster') !== '0';
  renderer.depthPrepass = params.get('prepass') === '1';
  renderer.gpuLOD = params.get('gpulod') === '1';
  renderer.gpuCulling = (params.get('gpucull') as 'off' | 'frustum' | 'hiz' | 'hiz2') ?? 'off';

  const world = new World();
  const ts = new TransformSystem(world.transforms);
  const bs = new BoundsSystem(world.transforms, world.bounds);
  const animation = new AnimationSystem(world);
  const skeletons = new SkeletonSystem(world, renderer.joints);
  const particleEmitters = new ParticleEmitterSystem(world);
  const ribbonEmitters = new RibbonEmitterSystem(world);
  const rw = new RenderWorld();
  const extractor = new RenderExtractor(world, ts);
  const visibility = new VisibilitySystem();
  visibility.mode = (params.get('cull') as CullMode) ?? 'bvh';
  const orbit = new OrbitController(canvas);

  const cam = entityIndex(world.create());
  world.transforms.add(cam);
  world.cameras.add(cam, Math.PI / 4, 0.1, 500);

  const ctx: DemoContext = {
    app, gpu, renderer, world, ts, bs, animation, skeletons, particleEmitters, ribbonEmitters, extractor, rw, visibility, orbit, params, camera: cam,
    textures: new TextureLoader(gpu), scene: DEFAULT_SCENE,
  };
  const demoName = params.get('scene') ?? 'materials';
  const update = (DEMOS[demoName] ?? materialsDemo)(ctx);
  // Image-based lighting: ?env=sky (procedural) or ?hdr=<url to a Radiance .hdr>; ?envI=<intensity>, ?sky=0 hides the background.
  const envI = Number(params.get('envI') ?? 1);
  if (params.get('hdr')) {
    const buf = await (await fetch(params.get('hdr')!)).arrayBuffer();
    renderer.setEnvironment(renderer.ibl.fromHDR(buf), envI);
  } else if (params.get('env') === 'sky') renderer.setEnvironment(renderer.ibl.fromSky(), envI);
  renderer.showSkybox = params.get('sky') !== '0';
  if (params.get('fog')) renderer.enableFog({ density: Number(params.get('fog')) });
  if (params.get('warmup') === '1') {
    const t0 = performance.now();
    const n = await renderer.warmup();
    (window as unknown as { __warm: unknown }).__warm = { pipelines: n, ms: performance.now() - t0, creationsAfterWarmup: gpu.resources.stats.pipelineCreations };
  }
  (window as unknown as { __r: unknown }).__r = ctx;

  app.onFrame = (dt) => {
    const time = performance.now() / 1000;
    update?.(time, dt);
    orbit.update(world, cam, dt);

    const a0 = performance.now();
    animation.update(dt);                 // clips -> local TRS / morph weights
    const a1 = performance.now();
    ts.update();                          // dirty transform hierarchy
    skeletons.update(ts.updated);         // joint matrices (only moved skeletons)
    bs.update(ts.updated);
    particleEmitters.update();            // emitter entity transforms -> particle pools
    renderer.particles?.update(Math.min(dt, 0.1), time);
    ribbonEmitters.update();               // trail heads follow their entities
    for (const rs of renderer.ribbonSystems) rs.update(time);
    const e0 = performance.now();
    extractor.extract(rw, canvas.width / canvas.height);
    renderer.stats.cpu.extraction = performance.now() - e0;
    const an = renderer.stats.animation;
    an.activeAnimators = animation.activeAnimators; an.activeSkeletons = world.skins.aliveInstances;
    an.updatedSkeletons = skeletons.updatedSkeletons; an.updatedJoints = skeletons.updatedJoints;
    const animMs = a1 - a0, xformMs = e0 - a1;
    const vis = renderer.applyLOD(rw, visibility.update(rw));   // CPU LOD: overrides meshes, drops sub-pixel objects
    renderer.render(rw, ctx.scene, time, vis);

    const s = gpu.resources.stats, rs = renderer.stats;
    hud.textContent =
      `scene: ${demoName}  batching: ${renderer.batching}  cull: ${visibility.mode}\n` +
      `renderables: ${rw.count}  visible: ${rs.visible}  culled: ${rs.frustumRejected}  (cull ${rs.cpu.culling.toFixed(3)} ms)\n` +
      `draws: ${rs.drawCalls}  instances: ${rs.instances}  tris: ${rs.triangles}\n` +
      `pipeline/material/mesh switches: ${rs.pipelineSwitches}/${rs.materialSwitches}/${rs.meshSwitches}\n` +
      `gpu ms: ${[...renderer.profiler.smoothed].map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  ') || (renderer.profiler.supported ? '...' : 'timestamps unsupported')}
` +
      (renderer.textureStreamer ? `streaming: ${(renderer.textureStreamer.stats.residentBytes / 1048576).toFixed(1)} MB resident, ${renderer.textureStreamer.stats.changes} level changes, ${(renderer.textureStreamer.stats.uploadedBytes / 1024).toFixed(0)} KB uploaded this frame
` : '') +
      `lights: ${rs.lighting.lights} (${rs.lighting.globalLights} global)  shading: ${rs.lighting.clustered ? `clustered (${rs.lighting.clusters} clusters)` : 'naive loop'}
` +
      `upload: ${rs.bufferUploadBytes} B (transforms ${rs.transformUploadBytes} B in ${rs.transformUploadRanges} ranges)\n` +
      (renderer.lodLibrary.groups.length ? `LOD: levels [${Array.from(rs.lodCounts.subarray(0, 4)).join(', ')}] culled ${rs.lodCulled} (select ${renderer.lod.ms.toFixed(2)} ms)
` : '') +
      `anim: ${rs.animation.activeAnimators} animators, ${rs.animation.activeSkeletons} skeletons (${rs.animation.updatedSkeletons} updated / ${rs.animation.updatedJoints} joints, ${rs.animation.jointUploadBytes} B), ` +
      `${rs.animation.activeMorphStates} morph states / ${rs.animation.activeMorphTargets} targets (${rs.animation.morphUploadBytes} B)  [anim ${animMs.toFixed(2)} ms, xform+skel ${xformMs.toFixed(2)} ms]\n` +
      `cpu ms: sort ${rs.cpu.sorting.toFixed(2)} batch ${rs.cpu.batching.toFixed(2)} encode ${rs.cpu.encoding.toFixed(2)} total ${rs.cpu.total.toFixed(2)}\n` +
      `particles: ${renderer.particles ? renderer.particles.pools.map((p) => `${p.config.name}:${p.spawnedThisFrame}`).join(' ') : '-'} spawned this frame
` +
      `buffers: ${s.buffers} (${(s.bufferBytes / 1024).toFixed(0)} KB)  textures: ${s.textures} (${(s.textureBytes / 1024).toFixed(0)} KB)  bindgroups: ${s.bindGroups}\n` +
      `pipelines: ${s.pipelineCreations} (after freeze ${s.pipelineCreationsAfterFreeze})  errors: ${gpu.errors.length + gpu.resources.shaders.errors.length + renderer.materials.shaderErrors.length}`;
    if (!gpu.resources.pipelines.isFrozen && app.frame > 30) gpu.resources.pipelines.freeze();
  };
  app.start();
}
main();
