# Making a game with this renderer

This project is a WebGPU **renderer + entity-component (ECS) runtime**, not a full game engine. It gives you rendering, lighting,
shadows, animation, particles, glTF loading, culling and LOD. It does **not** include input handling, physics, audio, UI or
networking: you write those (or bring a library) and drive the engine from your own per-frame callback.

Every snippet below uses APIs that exist in `src/` today. Working references: [`src/game/main.ts`](../src/game/main.ts) (the starter
game, ~70 lines) and the scenes in [`src/demos/`](../src/demos).

**Contents:** [Run it](#1-run-it) · [Layout](#2-project-layout) · [Architecture](#3-the-architecture-in-one-picture) ·
[Minimal game](#4-a-minimal-game) · [Building blocks](#5-building-blocks) · [Extending the engine](#6-extending-the-engine) ·
[What you must add](#7-things-a-game-needs-that-you-must-add) · [Performance](#8-performance-checklist) · [Limitations](#9-known-limitations) ·
[Troubleshooting](#10-troubleshooting)

---

## 1. Run it

```bash
npm install
npm run dev          # http://localhost:5173/  (needs a WebGPU browser: recent Chrome / Edge)
npm test             # unit tests (Node, no GPU)
npm run build        # type-check + production build
```

| URL | What it is |
|---|---|
| `/game.html` | the starter game: copy `src/game/` to start your own |
| `/?scene=materials` (also `gltf`, `character`, `particles`, `lod`, `lights`, `occlusion`, `streaming`) | demos |
| `/selftest.html` | GPU self-tests (compute / lighting / shadows / fog vs CPU references) |
| `/bench.html?suite=lights\|cull\|passes\|anim` | benchmarks |

Demo URL switches (handy while developing): `env=sky`, `hdr=<url>`, `envI=<intensity>`, `fog=<density>`, `cluster=0`, `prepass=1`,
`cull=none|linear|bvh`, `gpucull=frustum|hiz|hiz2`, `gpulod=1`, `warmup=1` (the `lights` scene also takes `shadows=0` and `n=<lights>`).

**Starting your own game:** copy `game.html` and `src/game/` (rename them), add the page to `build.rollupOptions.input` in
`vite.config.ts`, and import everything from [`src/index.ts`](../src/index.ts).

---

## 2. Project layout

```
src/index.ts     Public API barrel: import from here
src/app/         Engine (what a game uses), Application (device + frame loop + resize), OrbitController, Hud, urlSettings
src/ecs/         World, entities, component stores (components/), per-frame systems (systems/)
src/rendering/   Renderer, RenderExtractor, RenderWorld, materials/, lighting/, shadows/, GPU culling, primitives
src/assets/      glTF/GLB loading + instantiation, texture loading, RGBE (.hdr)
src/animation/   clips, animator, graph/ (state machines, blend trees), ik/, motionmatching/, root motion
src/particles/   GPU particle pools and ribbons
src/geometry/    mesh optimiser, simplifier, automatic LOD, meshlets
src/streaming/   texture streaming
src/workers/     worker pool, frame-budget queue
src/shaders/     WGSL (engine contract in common*.wgsl)
src/demos/       runnable examples (register new ones in demos/index.ts)
src/game/        the starter game
PROGRESS.md      status, conventions, benchmark results, known limitations
```

---

## 3. The architecture in one picture

```
 your game code ──writes──▶  World (ECS: transforms, meshRenderers, lights, cameras, animators, ...)
                                 │   Engine.frame() runs the systems every frame
                                 ▼
                       RenderExtractor.extract()  ──▶  RenderWorld  (flat arrays the renderer reads)
                                                              │
                                    VisibilitySystem (CPU culling) ─▶ Renderer.render()
```

`Engine` owns all of this and runs one frame in this order:

1. your `beforeAnimation` systems (optional, see [§6](#6-extending-the-engine))
2. `AnimationSystem` — clips / controllers → local transforms, morph weights
3. `TransformSystem` — world matrices of everything that moved
4. `SkeletonSystem`, `BoundsSystem`, particle / ribbon emitter systems
5. your `afterTransforms` systems
6. `RenderExtractor` → `RenderWorld`, then CPU culling + LOD
7. `Renderer.render()` — shadows, clusters, particles, prepass, GPU culling, fog, main pass

Rules that keep it fast:

* **Gameplay writes only to `World`.** The renderer never reads the ECS directly; it reads the `RenderWorld` produced each frame.
* Entities are `Entity` handles (index + generation). Component stores are indexed by **entity index**: use `entityIndex(entity)` when
  calling `world.transforms.*`, `world.meshRenderers.*`, etc. Pass the full `Entity` to `world.destroy(entity)` / `world.isAlive(entity)`.
  (`engine.spawnObject` / `spawnLight` already return the index.)
* Conventions: column-major matrices, right-handed, camera looks down **-Z**, clip depth [0,1], character forward is **+Z**, a light shines
  along its local **-Z** (like glTF).
* Do not create pipelines during gameplay. Create all materials up front and `await renderer.warmup()`.

---

## 4. A minimal game

This is [`src/game/main.ts`](../src/game/main.ts) in short (the file also handles key release on window blur and shows errors on the page):

```ts
import { Engine, LightType, RenderFlags, Quat, createCube, createPlane } from '../index';

const engine = await Engine.create(document.getElementById('canvas') as HTMLCanvasElement);
const { renderer, world } = engine;

// assets: create meshes and materials once, up front
const cubeMesh = renderer.meshes.create('cube', createCube());
const planeMesh = renderer.meshes.create('plane', createPlane());
const floorMat = renderer.materials.createPBR({ baseColor: [0.35, 0.4, 0.45, 1], roughness: 0.9, metallic: 0 });
const playerMat = renderer.materials.createPBR({ baseColor: [0.9, 0.35, 0.2, 1], roughness: 0.4, metallic: 0 });

// entities
engine.spawnObject({ mesh: planeMesh, material: floorMat, scale: [40, 1, 40],
  flags: RenderFlags.Static | RenderFlags.ReceiveShadow });   // bounds default to the mesh's own
const player = engine.spawnObject({ mesh: cubeMesh, material: playerMat, position: [0, 0.5, 0] });
engine.spawnLight({ type: LightType.Directional, rotation: [-0.5, 0.2, 0.1, 0.84], intensity: 3, castShadow: true });

renderer.setEnvironment(renderer.ibl.fromSky(), 0.8);   // image-based lighting + skybox
await renderer.warmup();                                // compile pipelines now, not mid-game

// camera: the engine creates one (engine.camera is its entity index); tilt it down once
const tilt = Quat.fromAxisAngle(Quat.create(), 1, 0, 0, -0.5);
world.transforms.setRotation(engine.camera, tilt[0], tilt[1], tilt[2], tilt[3]);

// input is yours
const keys = new Set<string>();
window.addEventListener('keydown', (e) => keys.add(e.code));
window.addEventListener('keyup', (e) => keys.delete(e.code));
const pos = { x: 0, z: 0 };

engine.start((time, dt) => {            // runs first every frame; the engine then updates systems and draws
  if (keys.has('KeyW')) pos.z -= 6 * dt;
  if (keys.has('KeyS')) pos.z += 6 * dt;
  if (keys.has('KeyA')) pos.x -= 6 * dt;
  if (keys.has('KeyD')) pos.x += 6 * dt;
  world.transforms.setPosition(player, pos.x, 0.5, pos.z);
  world.transforms.setPosition(engine.camera, pos.x, 7, pos.z + 11);   // simple follow camera
});
```

`game.html` only needs `<canvas id="canvas">` and a `<script type="module">`. For mouse-orbit camera control while prototyping, use
`new OrbitController(canvas)` and call `orbit.update(world, engine.camera, dt)` in your callback.

### Engine cheat-sheet

| You want | Use |
|---|---|
| Create the engine | `await Engine.create(canvas, { fovY, near, far })` (rejects if WebGPU is missing — show the message to the player) |
| Add a mesh object in one call | `engine.spawnObject({ mesh, material, position, scale, rotation, flags, bounds })` → entity index |
| Add a light in one call | `engine.spawnLight({ type, position, rotation, color, intensity, range, innerCone, outerCone, castShadow })` |
| The active camera | `engine.camera` (entity index; move it with `world.transforms`) and `world.cameras` for fov / near / far |
| Run your game each frame | `engine.start((time, dt) => { ... })`; stop with `engine.stop()` |
| Step manually (tests, captures) | `engine.frame(dt, time)` |
| Everything else | `engine.world`, `engine.renderer`, `engine.visibility`, `engine.animation`, `engine.textures`, `engine.timings` |

---

## 5. Building blocks

### Meshes and materials

```ts
const meshId = renderer.meshes.create('name', meshData);   // MeshData = { vertices, indices }
// standard vertex layout: position(3) normal(3) uv(2) tangent(4) = 48 B; all static meshes share one buffer
```

Built-ins: `createCube`, `createPlane`, `createUVSphere(segments, rings)` in `src/rendering/primitives.ts`.

Mesh data (vertices, indices, skin weights, morph deltas) lives in a few shared GPU buffers sized to what the device allows. If a mesh
cannot fit, `meshes.create` throws an `ArenaCapacityError` that names the buffer and the byte limit, and nothing is allocated, so you
can catch it and keep going. A warning is logged when a buffer passes 80% of the limit. Morph targets are the usual culprit
(48 bytes per vertex per target): trim targets you do not need.

```ts
const m = renderer.materials.createPBR({
  baseColor: [1, 1, 1, 1], metallic: 0, roughness: 0.5,
  emissive: [1, 0.5, 0.1], emissiveStrength: 8,
  alphaMode: 'OPAQUE' | 'MASK' | 'BLEND', doubleSided: false,
  textures: { baseColor, metalRough, normal, occlusion, emissive },   // TextureRef from TextureLoader (engine.textures)
});

// custom WGSL: you write vs_main / fs_main; engine helpers + generated param_<name>() accessors are available
const fx = renderer.materials.createCustom({ name: 'pulse', wgsl, params: [{ name: 'speed', type: 'f32' }], values: { speed: 3 } });
```

See `src/demos/materialsDemo.ts` for a complete custom material. A broken custom shader falls back to a visible error material instead of
crashing (messages are collected in `renderer.materials.shaderErrors`).

### An object = entity + components

`engine.spawnObject(...)` covers the common case. For full control use the stores directly:

```ts
import { entityIndex } from '../index';

const e = entityIndex(world.create());
world.transforms.add(e, x, y, z);
world.transforms.setScale(e, sx, sy, sz);
world.transforms.setRotation(e, qx, qy, qz, qw);            // quaternion, normalised for you
world.transforms.setParent(child, parent);                  // hierarchies
world.meshRenderers.add(e, meshId, materialId, flags);      // RenderFlags: CastShadow | ReceiveShadow | Static | Hidden
world.bounds.add(e, minX, minY, minZ, maxX, maxY, maxZ);    // local-space AABB (optional: `engine.autoBounds`, on by default, gives bounds-less renderers their mesh's bounds; skinned / morphed meshes need explicit padded bounds)
```

Same mesh + same material objects are automatically **instanced** into one draw call; `Static` objects skip per-frame work (a static
object must not move; clear the flag first if it must). Destroy with `world.destroy(entityHandle)` (the handle, not the index).

### Lights

```ts
engine.spawnLight({ type: LightType.Point, position: [0, 3, 0], color: [1, 0.8, 0.5], intensity: 40, range: 12 });
// or by hand:
world.lights.add(e, LightType.Point, r, g, b, intensity, range);   // Directional | Point | Spot | Ambient | Area
world.lights.innerCone[e] = 0.2; world.lights.outerCone[e] = 0.5;  // spot, radians
world.lights.addArea(e, width, height, r, g, b, intensity);        // rectangular area light (LTC specular)
world.lights.castShadow[e] = 1;                                    // sun: 4 blended cascades, spot: 1 map, point / area: cube map
```

Hundreds to thousands of point/spot lights are fine (clustered shading). Shadow budgets: 8 spot and 2 point/area casters, one cascaded
sun (`renderer.shadows.config`). With no light entities at all, a built-in sun + ambient (`engine.scene`) is used.

### Environment, fog, post look

```ts
renderer.setEnvironment(renderer.ibl.fromSky(), intensity);        // procedural sky
renderer.setEnvironment(renderer.ibl.fromHDR(await (await fetch(url)).arrayBuffer()), 1);   // Radiance .hdr
renderer.enableFog({ density: 0.02, heightFalloff: 0.1, anisotropy: 0.4, maxDistance: 120 }); // volumetric fog with light shafts
renderer.showSkybox = true;
renderer.clearColor = { r: 0.05, g: 0.06, b: 0.09, a: 1 };         // background when there is no skybox
```

Tone mapping is built into the PBR shader (ACES).

### glTF models and animation

```ts
import { loadGLTF, instantiateGLTF, AnimatedInstance, Animator, entityIndex } from '../index';

const asset = await loadGLTF(new Uint8Array(await (await fetch('hero.glb')).arrayBuffer()));
const inst = instantiateGLTF(asset, { world, meshes: renderer.meshes, materials: renderer.materials, textures: engine.textures });
await inst.ready;                                              // textures finish uploading asynchronously
world.transforms.setPosition(entityIndex(inst.root), 0, 0, 0);

const ai = AnimatedInstance.fromGLTF(asset, inst);             // pass a previous instance as 3rd arg to share clip data
const anim = Animator.attach(world, entityIndex(inst.root), ai, ai.clipIndex('Run'));
anim.setSpeed(1).play();                                       // also: pause(), stop(), setLoop(bool), play('Idle')
```

Skinned meshes and morph targets are rendered on the GPU; crowds of the same character collapse into few draw calls. For
gameplay-driven animation (blend trees, state machines with conditions, layers/masks, root motion, IK, motion matching) see
`src/animation/graph/` and `tests/animation-graph.test.ts`; attach a controller with
`world.controllers.add(entity, animatedInstance, controller)` and drive it through its `AnimationParams` (`setFloat`, `setBool`, triggers).

### Particles and trails

```ts
const ps = renderer.enableParticles();
const pool = ps.createPool({ name: 'fire', maxCount: 20000, billboard: { orientation: 'camera', blend: 'additive' } });
const e = entityIndex(world.create());
world.transforms.add(e, 0, 0.2, 0);
world.particleEmitters.add(e, pool, pool.addEmitter({ shape: 'sphere', radius: 0.25, rate: 1500, lifetime: [0.6, 1.3], size: [0.35, 0.6], colorStart: [1, 0.5, 0.1, 0.06], colorEnd: [0.6, 0.05, 0, 0] }));
```

Particles simulate entirely on the GPU (a million alive is fine). Mesh particles: `createPool({ maxCount, mesh: { meshId } })`.
Ribbons/trails/beams: `renderer.createRibbonSystem(...)`. Full examples: `src/demos/particlesDemo.ts`.

### Level of detail, culling, streaming

* **LOD:** `renderer.lodLibrary.create({ levels: [{ meshId, minScreenSize }, ...] })` then `world.lods.add(entity, groupId)`. Generate levels
  automatically with `generateLODChain(meshData, [0.5, 0.25, 0.1])` (`generateLODChainAsync` does it in a Web Worker).
* **CPU culling:** `engine.visibility.mode = 'bvh'` for big static worlds, `'linear'` for small ones, `'none'` to disable.
* **GPU-driven culling:** `renderer.gpuCulling = 'frustum' | 'hiz2'` (+ `renderer.gpuLOD = true`). `hiz2` skips whatever is hidden behind big
  occluders and is the one to try for dense scenes.
* **Texture streaming:** create textures through `TextureStreamer` (`src/streaming/`) and call `renderer.setTextureStreamer(streamer)`;
  resident mips follow on-screen size under a memory budget.

---

## 6. Extending the engine

The codebase is organised so a new feature touches as few places as possible.

**A new per-frame system** (AI, physics sync, day/night cycle, a new feature): implement `EngineSystem` and register it.

```ts
const bobbing: EngineSystem = {
  update(dt, time) { world.transforms.setPosition(buoy, 0, Math.sin(time) * 0.2, 0); },
};
engine.addSystem(bobbing);                       // phase 'beforeAnimation' (default)
engine.addSystem(cameraRig, 'afterTransforms');  // runs after world matrices are final, e.g. to read where things ended up
```

**A new component**: subclass `ComponentStore` (typed arrays indexed by entity index) and register it.

```ts
class HealthStore extends ComponentStore {
  hp = new Float32Array(0);
  protected grow(n: number) { this.hp = growF32(this.hp, n); }   // keep existing data when the world grows
  protected reset(i: number) { this.hp[i] = 0; }                  // called when the entity or component goes away
  add(i: number, hp: number) { this.ensureCapacity(i + 1); this.has.set(i); this.hp[i] = hp; }
}
const health = world.registerStore(new HealthStore());
BitSet.forEachAnd([health.has], (i) => { /* every entity with health */ });
```

**A new look**: write a custom WGSL material (`createCustom`) — it plugs into batching, culling, lighting data and the error fallback without
touching the renderer. Shared WGSL lives in `src/shaders/` (`common*.wgsl` describe the bind groups).

**A new demo / experiment**: add a file in `src/demos/` exporting a `Demo` (`(ctx) => (time, dt) => void`) and register it in
`src/demos/index.ts`; open it with `/?scene=<name>`.

**A new render pass** (post effect, extra shadow-like pass): add it in `Renderer.recordPasses` with the render graph —
`g.addPass({ name, reads: [...], writes: [...], execute: (encoder) => ... })`. Declared reads/writes decide the order and unused passes are
dropped. Passes are created in small `add*Pass` methods in `src/rendering/Renderer.ts`.

**Tests**: pure CPU logic goes in `tests/*.test.ts` (Vitest); GPU kernels get a `SelfTest` in `src/selftest/` compared against a CPU reference.

---

## 7. Things a game needs that you must add

| Need | Suggestion |
|---|---|
| Input | DOM events as above (keyboard, pointer lock for mouse look, Gamepad API) |
| Physics / collision | a library such as Rapier or cannon-es; each frame copy body positions into `world.transforms.setPosition/setRotation` (in your `engine.start` callback or a `beforeAnimation` system) |
| Audio | Web Audio API |
| UI / HUD | HTML/CSS overlay on top of the canvas (`formatHud(engine, 'name')` gives a ready-made debug overlay text) |
| Game state / scenes | plain TypeScript; spawn and `world.destroy()` entities as levels change |
| Saving, networking | your own |

Keep game code out of the renderer folders: put it in your own folder and talk to the engine through `engine.*`, the `World` and systems.

---

## 8. Performance checklist

1. Share meshes and materials between objects (instancing needs identical mesh + material).
2. Mark non-moving things `RenderFlags.Static`; set tight local `bounds` on everything.
3. Create materials/meshes at load time, then `await renderer.warmup()`; the engine freezes the pipeline cache after 30 frames and
   reports any later creation (`pipelines: … (after freeze N)` in the debug HUD must stay 0).
4. Prefer many cheap lights over few expensive ones; clustered shading handles the count. Only shadow what matters (sun + a few spots).
5. Use LOD for anything with more than a few thousand triangles that appears many times.
6. Profile: the debug HUD (`formatHud`) shows GPU time per pass (`renderer.profiler.smoothed`), draw calls, uploads and cull stats;
   `/bench.html?suite=passes` gives a per-pass breakdown.
7. Never `await` GPU readbacks in the frame loop.

---

## 9. Known limitations (see `PROGRESS.md` for the full list)

* No built-in input, physics, audio or UI.
* Transparent objects and particles are not fogged; area-light shadows are approximated by a cube map from the light's centre.
* The GPU-culling path handles opaque / alpha-masked batches (transparent stay on the CPU path); in-frame `hiz` cannot be combined with GPU LOD (use `hiz2`).
* glTF: one UV set, no Draco/meshopt/KTX2; each material has one sampler.
* Works within WebGPU's default limit of 8 storage buffers per shader stage (the vertex stage uses 6). All meshes share one deform buffer, so the total skin + morph data is capped by the device's `maxStorageBufferBindingSize` (128 MB on the default limit).

---

## 10. Troubleshooting

| Symptom | Likely cause |
|---|---|
| "WebGPU is not supported in this browser." | Use a recent desktop Chrome / Edge; some browsers hide WebGPU behind a flag |
| Blank screen, errors in the console starting with `The number of storage buffers …` | The GPU / driver exposes fewer than 8 storage buffers per stage (the WebGPU default) |
| Object not drawn | Missing `world.transforms.add` or `world.meshRenderers.add`; `RenderFlags.Hidden` set; the camera is inside / behind it; the camera entity has no `world.cameras` component |
| Object disappears at screen edges or while moving | Its `bounds` are too small (or it is flagged `Static` but moved) |
| Object is black or has no shadow | No light (the fallback sun is used only with zero lights); `castShadow` not set on the light, or `RenderFlags.CastShadow` / `ReceiveShadow` missing on the object |
| A magenta "error" material | A custom WGSL material failed validation or compilation: read `renderer.materials.shaderErrors` and `engine.gpu.errors` |
| Hitches the first time something appears | Material created during play: create it at load and `await renderer.warmup()` |
| `ArenaCapacityError` when creating a mesh | The shared mesh / deform buffer reached the device limit: reduce morph targets or vertex counts, or load fewer meshes at once |
| `engine.gpu.errors` is not empty | WebGPU validation errors are collected there and logged to the console |
