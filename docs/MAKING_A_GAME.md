# Making a game with this renderer

This project is a WebGPU **renderer + entity-component (ECS) runtime**, not a full game engine. It gives you rendering, lighting, shadows, animation, particles, glTF loading, culling and LOD. It does **not** include input handling, physics, audio, UI or networking: you write those (or bring a library) and drive the renderer from your own game loop.

All snippets below use APIs that exist in `src/` today; the demos in `src/demos/` are the best working references.

---

## 1. Run it

```bash
npm install
npm run dev          # http://localhost:5173/  (needs a WebGPU browser: recent Chrome / Edge)
npm test             # unit tests (Node, fake GPU)
npm run build        # type-check + production build
```

Useful pages:

| URL | What it is |
|---|---|
| `/?scene=materials` (also `gltf`, `character`, `particles`, `lod`, `lights`, `occlusion`, `streaming`) | demos |
| `/selftest.html` | GPU self-tests (compute / lighting / shadows / fog vs CPU references) |
| `/bench.html?suite=lights\|cull\|passes\|anim` | benchmarks |

Demo URL switches (handy while developing): `env=sky`, `hdr=<url>`, `fog=<density>`, `cluster=0`, `prepass=1`, `gpucull=frustum|hiz|hiz2`, `gpulod=1`, `warmup=1`, `shadows=0`.

---

## 2. Project layout

```
src/app/         Application (device + frame loop + resize), OrbitController
src/ecs/         World, entities, component stores, systems (transform, bounds, animation, skeleton, particles)
src/rendering/   Renderer, RenderExtractor, RenderWorld, materials, lighting, shadows, GPU culling, primitives
src/assets/      glTF/GLB loading + instantiation, texture loading, RGBE (.hdr)
src/animation/   clips, animator, state machines / blend trees, root motion, IK, motion matching
src/particles/   GPU particle pools and ribbons
src/geometry/    mesh optimiser, simplifier, automatic LOD, meshlets
src/streaming/   texture streaming
src/workers/     worker pool, frame-budget queue
src/shaders/     WGSL (engine contract in common*.wgsl)
src/demos/       runnable examples
PROGRESS.md      status, conventions, benchmark results, known limitations
```

---

## 3. The architecture in one picture

```
 your game code ──writes──▶  World (ECS: transforms, meshRenderers, lights, cameras, animators, ...)
                                 │   systems update every frame
                                 ▼
                       RenderExtractor.extract()  ──▶  RenderWorld  (flat arrays the renderer reads)
                                                              │
                                    VisibilitySystem (CPU culling) ─▶ Renderer.render()
```

Rules that keep it fast:

* **Gameplay writes only to `World`.** The renderer never reads the ECS directly; it reads the `RenderWorld` produced by `RenderExtractor` each frame.
* Entities are `Entity` handles (index + generation). Component stores are indexed by **entity index**: use `entityIndex(entity)` when calling `world.transforms.*`, `world.meshRenderers.*`, etc. Pass the full `Entity` to `world.destroy(entity)` / `world.isAlive(entity)`.
* Conventions: column-major matrices, right-handed, camera looks down **-Z**, clip depth [0,1], character forward is **+Z**, a light shines along its local **-Z** (like glTF).
* Do not create pipelines during gameplay. Create all materials up front and `await renderer.warmup()`.

---

## 4. A minimal game skeleton

Your own entry point replaces `src/main.ts` (copy it as a starting point; it wires everything for the demos).

```ts
import { Application } from './app/Application';
import { Renderer, DEFAULT_SCENE } from './rendering/Renderer';
import { RenderWorld } from './rendering/RenderWorld';
import { RenderExtractor } from './rendering/RenderExtractor';
import { World } from './ecs/World';
import { entityIndex } from './ecs/Entity';
import { TransformSystem } from './ecs/systems/TransformSystem';
import { BoundsSystem } from './ecs/systems/BoundsSystem';
import { AnimationSystem } from './ecs/systems/AnimationSystem';
import { SkeletonSystem } from './ecs/systems/SkeletonSystem';
import { ParticleEmitterSystem } from './ecs/systems/ParticleEmitterSystem';
import { RibbonEmitterSystem } from './ecs/systems/RibbonEmitterSystem';
import { VisibilitySystem } from './visibility/VisibilitySystem';
import { LightType } from './ecs/components/LightStore';
import { RenderFlags } from './ecs/components/MeshRendererStore';
import { createCube, createPlane } from './rendering/primitives';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const app = new Application(canvas);
await app.init();                                   // device, swap chain, resize handling

const renderer = new Renderer(app.gpu);
app.onResize = (w, h) => renderer.resize(w, h);

const world = new World();
const ts = new TransformSystem(world.transforms);
const bs = new BoundsSystem(world.transforms, world.bounds);
const animation = new AnimationSystem(world);
const skeletons = new SkeletonSystem(world, renderer.joints);
const particleEmitters = new ParticleEmitterSystem(world);
const ribbonEmitters = new RibbonEmitterSystem(world);
const rw = new RenderWorld();
const extractor = new RenderExtractor(world, ts);
const visibility = new VisibilitySystem();            // .mode = 'bvh' | 'linear' | 'none'

// camera (the first camera entity is the active one)
const cam = entityIndex(world.create());
world.transforms.add(cam, 0, 4, 10);
world.cameras.add(cam, Math.PI / 4, 0.1, 500);        // fovY, near, far

// assets
const cube = renderer.meshes.create('cube', createCube());
const plane = renderer.meshes.create('plane', createPlane());
const stone = renderer.materials.createPBR({ baseColor: [0.6, 0.6, 0.65, 1], roughness: 0.8, metallic: 0 });

// a floor and a player
const floor = entityIndex(world.create());
world.transforms.add(floor, 0, 0, 0);
world.transforms.setScale(floor, 40, 1, 40);
world.meshRenderers.add(floor, plane, stone, RenderFlags.Static | RenderFlags.ReceiveShadow);
world.bounds.add(floor, -0.5, 0, -0.5, 0.5, 0, 0.5);          // local-space AABB (required for culling)

const player = entityIndex(world.create());
world.transforms.add(player, 0, 0.5, 0);
world.meshRenderers.add(player, cube, stone);                  // default flags: casts + receives shadows
world.bounds.add(player, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5);

// a sun that casts cascaded shadows
const sun = entityIndex(world.create());
world.transforms.add(sun);
world.transforms.setRotation(sun, -0.5, 0.2, 0.1, 0.84);       // shines along local -Z (normalised for you)
world.lights.add(sun, LightType.Directional, 1, 0.95, 0.85, 3);
world.lights.castShadow[sun] = 1;

renderer.setEnvironment(renderer.ibl.fromSky(), 0.8);          // image-based lighting + skybox
await renderer.warmup();                                       // compile pipelines now, not mid-game

// input is yours
const keys = new Set<string>();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
const pos = { x: 0, z: 0 };

app.onFrame = (dt) => {
  const time = performance.now() / 1000;

  // 1. gameplay: write to the World
  const speed = 5;
  if (keys.has('KeyW')) pos.z -= speed * dt;
  if (keys.has('KeyS')) pos.z += speed * dt;
  if (keys.has('KeyA')) pos.x -= speed * dt;
  if (keys.has('KeyD')) pos.x += speed * dt;
  world.transforms.setPosition(player, pos.x, 0.5, pos.z);
  world.transforms.setPosition(cam, pos.x, 4, pos.z + 9);       // simple follow camera

  // 2. engine systems (this order matters)
  animation.update(dt);
  ts.update();                         // world matrices for everything that moved
  skeletons.update(ts.updated);
  bs.update(ts.updated);               // world bounds
  particleEmitters.update();
  renderer.particles?.update(Math.min(dt, 0.1), time);
  ribbonEmitters.update();
  for (const r of renderer.ribbonSystems) r.update(time);

  // 3. extract + cull + draw
  extractor.extract(rw, canvas.width / canvas.height);
  const visible = renderer.applyLOD(rw, visibility.update(rw));
  renderer.render(rw, DEFAULT_SCENE, time, visible);
};
app.start();
```

`index.html` only needs `<canvas id="canvas">`. Rotating the camera: `world.transforms.setRotation(cam, x, y, z, w)` (quaternion; see `src/math/Quat.ts`). `OrbitController` is a ready-made mouse orbit camera if you just want to look around.

---

## 5. Building blocks

### Meshes and materials

```ts
const meshId = renderer.meshes.create('name', meshData);   // MeshData = { vertices, indices }
// standard vertex layout: position(3) normal(3) uv(2) tangent(4) = 48 B; all static meshes share one buffer
```

Built-ins: `createCube`, `createPlane`, `createUVSphere(segments, rings)` in `src/rendering/primitives.ts`.

```ts
const m = renderer.materials.createPBR({
  baseColor: [1, 1, 1, 1], metallic: 0, roughness: 0.5,
  emissive: [1, 0.5, 0.1], emissiveStrength: 8,
  alphaMode: 'OPAQUE' | 'MASK' | 'BLEND', doubleSided: false,
  textures: { baseColor, metalRough, normal, occlusion, emissive },   // TextureRef from TextureLoader
});

// custom WGSL: you write vs_main / fs_main; engine helpers + generated param_<name>() accessors are available
const fx = renderer.materials.createCustom({ name: 'pulse', wgsl, params: [{ name: 'speed', type: 'f32' }], values: { speed: 3 } });
```

See `src/demos/materialsDemo.ts` for a complete custom material. A broken custom shader falls back to a visible error material instead of crashing.

### An object = entity + components

```ts
const e = entityIndex(world.create());
world.transforms.add(e, x, y, z);
world.transforms.setScale(e, sx, sy, sz);
world.transforms.setRotation(e, qx, qy, qz, qw);
world.transforms.setParent(child, parent);                  // hierarchies
world.meshRenderers.add(e, meshId, materialId, flags);      // RenderFlags: CastShadow | ReceiveShadow | Static | Hidden
world.bounds.add(e, minX, minY, minZ, maxX, maxY, maxZ);    // local AABB
```

Same mesh + same material objects are automatically **instanced** into one draw call; `Static` objects skip per-frame work. Destroy with `world.destroy(entityHandle)`.

### Lights

```ts
world.lights.add(e, LightType.Point, r, g, b, intensity, range);   // Directional | Point | Spot | Ambient | Area
world.lights.innerCone[e] = 0.2; world.lights.outerCone[e] = 0.5;  // spot, radians
world.lights.addArea(e, width, height, r, g, b, intensity);        // rectangular area light (LTC specular)
world.lights.castShadow[e] = 1;                                    // sun: 4 cascades, spot: 1 map, point: cube map
```

Hundreds to thousands of point/spot lights are fine (clustered shading); budgets: 8 spot and 2 point shadow casters, one cascaded sun (`renderer.shadows.config`).

### Environment, fog, post look

```ts
renderer.setEnvironment(renderer.ibl.fromSky(), intensity);        // procedural sky
renderer.setEnvironment(renderer.ibl.fromHDR(await (await fetch(url)).arrayBuffer()), 1);   // Radiance .hdr
renderer.enableFog({ density: 0.02, heightFalloff: 0.1, anisotropy: 0.4, maxDistance: 120 }); // volumetric fog with light shafts
renderer.showSkybox = true;
```

Tone mapping is built into the PBR shader (ACES).

### glTF models and animation

```ts
import { loadGLTF } from './assets/gltf/GLTFLoader';
import { instantiateGLTF } from './assets/gltf/GLTFInstantiator';
import { TextureLoader } from './assets/TextureLoader';
import { AnimatedInstance } from './animation/Animator';
import { Animator } from './animation/AnimatorHandle';

const asset = await loadGLTF(new Uint8Array(await (await fetch('hero.glb')).arrayBuffer()));
const inst = instantiateGLTF(asset, { world, meshes: renderer.meshes, materials: renderer.materials, textures: new TextureLoader(app.gpu) });
await inst.ready;                                              // textures finish uploading asynchronously
world.transforms.setPosition(entityIndex(inst.root), 0, 0, 0);

const ai = AnimatedInstance.fromGLTF(asset, inst);             // pass a previous instance as 3rd arg to share clip data
const anim = Animator.attach(world, entityIndex(inst.root), ai, ai.clipIndex('Run'));
anim.setSpeed(1).play();                                       // also: pause(), stop(), setLoop(bool), play('Idle')
```

Skinned meshes and morph targets are rendered on the GPU; crowds of the same character collapse into few draw calls. For gameplay-driven animation (blend trees, state machines with conditions, layers/masks, root motion, IK, motion matching) see `src/animation/graph/` and `tests/animation-graph.test.ts`; attach a controller with `world.controllers.add(entity, animatedInstance, controller)` and drive it through its parameters.

### Particles and trails

```ts
const ps = renderer.enableParticles();
const pool = ps.createPool({ name: 'fire', maxCount: 20000, billboard: { orientation: 'camera', blend: 'additive' } });
const e = entityIndex(world.create());
world.transforms.add(e, 0, 0.2, 0);
world.particleEmitters.add(e, pool, pool.addEmitter({ shape: 'sphere', radius: 0.25, rate: 1500, lifetime: [0.6, 1.3], size: [0.35, 0.6], colorStart: [1, 0.5, 0.1, 0.06], colorEnd: [0.6, 0.05, 0, 0] }));
```

Particles simulate entirely on the GPU (a million alive is fine). Mesh particles: `createPool({ maxCount, mesh: { meshId } })`. Ribbons/trails/beams: `renderer.createRibbonSystem(...)`. Full examples: `src/demos/particlesDemo.ts`.

### Level of detail, culling, streaming

* **LOD:** `renderer.lodLibrary.create({ levels: [{ meshId, minScreenSize }, ...] })` then `world.lods.add(entity, groupId)`. Generate levels automatically with `generateLODChain(meshData, [0.5, 0.25, 0.1])` from `src/geometry/LODGenerator.ts` (use `generateLODChainAsync` to do it in a Web Worker).
* **CPU culling:** `visibility.mode = 'bvh'` for big static worlds, `'linear'` for small ones.
* **GPU-driven culling:** `renderer.gpuCulling = 'frustum' | 'hiz2'` (+ `renderer.gpuLOD = true`). `hiz2` skips whatever is hidden behind big occluders and is the one to try for dense scenes.
* **Texture streaming:** create textures through `TextureStreamer` (`src/streaming/`) and call `renderer.setTextureStreamer(streamer)`; resident mips follow on-screen size under a memory budget.

---

## 6. Things a game needs that you must add

| Need | Suggestion |
|---|---|
| Input | DOM events as above (keyboard, pointer lock for mouse look, Gamepad API) |
| Physics / collision | a library such as Rapier or cannon-es; each frame copy body positions into `world.transforms.setPosition/setRotation` |
| Audio | Web Audio API |
| UI / HUD | HTML/CSS overlay on top of the canvas |
| Game state / scenes | plain TypeScript; spawn and `world.destroy()` entities as levels change |
| Saving, networking | your own |

Keep game code out of the renderer folders: write systems as functions that run between `animation.update(dt)` and `extractor.extract(...)` in the frame callback.

---

## 7. Performance checklist

1. Share meshes and materials between objects (instancing needs identical mesh + material).
2. Mark non-moving things `RenderFlags.Static`; set tight local `bounds` on everything.
3. Create materials/meshes at load time, then `await renderer.warmup()`; check the HUD says `after freeze 0` for pipelines.
4. Prefer many cheap lights over few expensive ones; clustered shading handles the count. Only shadow what matters (sun + a few spots).
5. Use LOD for anything with more than a few thousand triangles that appears many times.
6. Profile: the on-screen HUD shows GPU time per pass (`renderer.profiler.smoothed`), draw calls, uploads and cull stats; `/bench.html?suite=passes` gives a per-pass breakdown.
7. Never `await` GPU readbacks in the frame loop.

---

## 8. Known limitations (see `PROGRESS.md` for the full list)

* No built-in input, physics, audio or UI.
* Transparent objects and particles are not fogged; area lights do not cast shadows; cascades are not blended.
* The GPU-culling path handles opaque / alpha-masked batches (transparent stay on the CPU path); in-frame `hiz` cannot be combined with GPU LOD (use `hiz2`).
* glTF: one UV set, no Draco/meshopt/KTX2; each material has one sampler.
* Needs a device exposing at least 10 vertex-stage storage buffers for skinning/morphing (most desktop GPUs do).
