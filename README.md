# WebGPU Renderer

A data-oriented **WebGPU renderer and entity-component runtime** written in TypeScript. It gives a game everything it needs to put a
3D world on screen — PBR materials, clustered lighting, shadows, image-based lighting, volumetric fog, glTF models, skeletal and morph
animation (blend trees, state machines, IK, motion matching), GPU particles and ribbons, LOD, culling and texture streaming — and
leaves gameplay, input, physics and audio to you.

```ts
import { Engine, LightType, createCube } from './index';

const engine = await Engine.create(canvas);                       // device, swap chain, ECS, systems, renderer
const cube = engine.renderer.meshes.create('cube', createCube());
const red = engine.renderer.materials.createPBR({ baseColor: [0.9, 0.3, 0.2, 1] });

const player = engine.spawnObject({ mesh: cube, material: red, position: [0, 0.5, 0] });
engine.spawnLight({ type: LightType.Directional, rotation: [-0.5, 0.2, 0.1, 0.84], castShadow: true });

engine.start((time, dt) => {                                      // your gameplay; the engine does the rest
  engine.world.transforms.setPosition(player, Math.sin(time), 0.5, 0);
});
```

## Requirements

* A current Node.js LTS (build tooling only)
* A browser with **WebGPU**: recent Chrome or Edge (desktop). The engine works within WebGPU's default limit of 8 storage buffers per
  shader stage (the vertex stage uses 6).

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173/
```

| Page | What it is |
|---|---|
| `/` (`?scene=materials`) | Demo launcher. Other scenes: `gltf`, `character`, `particles`, `lod`, `lights`, `occlusion`, `streaming` |
| `/game.html` | **Starter game** (move a cube with WASD) — the template to copy for your own game, see [`src/game/main.ts`](src/game/main.ts) |
| `/selftest.html` | GPU self-tests: shaders, lighting, shadows, fog, particles compared with CPU reference implementations |
| `/bench.html?suite=lights\|cull\|passes\|anim` | GPU benchmarks (default suite: draw submission) |

Demo URL switches: `env=sky`, `hdr=<url>`, `envI=<intensity>`, `sky=0`, `fog=<density>`, `mode=unsorted|sorted|instanced`, `cluster=0`,
`prepass=1`, `cull=none|linear|bvh`, `gpucull=frustum|hiz|hiz2`, `gpulod=1`, `warmup=1`; plus scene options such as `n=<count>`
(see [`src/app/urlSettings.ts`](src/app/urlSettings.ts)).

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check, then production build (all four pages) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (Vitest, Node, no GPU needed) |
| `npm run bench` | CPU micro-benchmarks (transform update, culling, motion matching) |

## Using it as an npm package

The renderer builds as an ES-module library (`dist/`, one file per source module, with `.d.ts` files, WGSL shaders inlined and the
geometry worker emitted as an asset).

```bash
# in this repo: build and pack (prepack runs typecheck + tests + build:lib)
npm pack                                   # -> webgpu-renderer-0.1.0.tgz

# in your game project (Vite + TypeScript)
npm install ../webgpu-renderer/webgpu-renderer-0.1.0.tgz     # or: npm install ../webgpu-renderer   /   a git URL / registry name
```

```ts
import { Engine, LightType, createCube } from 'webgpu-renderer';          // the public API (src/index.ts)
import { Mat4 } from 'webgpu-renderer/math/Mat4';                          // any module can be deep-imported (no barrel needed)
```

* **Bundler:** use **Vite** (or another bundler that understands `new Worker(new URL(...), import.meta.url)`); the worker used for
  `generateLODChainAsync` is emitted next to the library files and picked up by your build.
* **Types:** TypeScript 5.x needs `"types": ["@webgpu/types"]` in your tsconfig (`npm i -D @webgpu/types`; it is an optional peer
  dependency). Recent TypeScript versions already ship WebGPU types. Use `"moduleResolution": "Bundler"`; `isolatedModules` is fine.
* **Publishing:** `package.json` is no longer `private` and has `"license": "UNLICENSED"` as a placeholder - choose your license and
  name (`@yourscope/webgpu-renderer`), then `npm version patch && npm publish` (or publish to a private registry / GitHub Packages).
* **Developing both at once:** `npm link` in this repo and `npm link webgpu-renderer` in the game, then `npm run build:lib` after
  engine changes (or point the game at the source with a Vite alias to `../webgpu-renderer/src/index.ts`).
* Verified: a separate Vite + TypeScript project installed from the packed tarball compiles under `isolatedModules`, builds, and runs
  the starter game (shadows, sky lighting) with no GPU errors.

## Making a game

Read **[docs/MAKING_A_GAME.md](docs/MAKING_A_GAME.md)**: a complete walkthrough from an empty scene to lights, shadows, glTF characters,
animation, particles, LOD and performance tuning, plus how to extend the engine with your own components, systems and shaders.

## How it works

```
 your game code ──writes──▶  World (ECS: transforms, mesh renderers, lights, cameras, animators, emitters, ...)
                                  │
                                  ▼   Engine.frame() runs the systems in order:
   animation → transforms → skeletons → bounds → particle / ribbon emitters → your systems
                                  │
                                  ▼
                RenderExtractor.extract()  ──▶  RenderWorld  (flat typed arrays; the only thing the renderer reads)
                                  │
                VisibilitySystem (CPU culling) → LOD selection
                                  │
                                  ▼
   Renderer.render():  upload → sort into queues → build instanced batches → pass graph:
      shadows · light clusters · particles · depth prepass · GPU culling · fog · main pass (+ skybox, particles, ribbons)
```

Design rules that keep it fast and easy to reason about:

* **Gameplay writes only to the `World`.** The renderer never touches the ECS; it reads the `RenderWorld` produced each frame.
* **Component data is structure-of-arrays**, indexed by the entity *index* (a generation counter in the entity id catches stale handles).
* **Everything shared lives in few big GPU buffers** (meshes, transforms, materials, joints, instances), so thousands of objects
  collapse into a handful of draw calls and bind-group changes.
* **No pipeline creation during gameplay**: create meshes / materials up front and `await renderer.warmup()`.
* Conventions: column-major matrices, right-handed, camera looks down **-Z**, clip depth [0, 1] (standard Z), character forward is **+Z**,
  lights shine along their local **-Z** (same as glTF).

## Project layout

```
src/
  index.ts          Public API barrel — import from here
  app/              Engine (the one object a game needs), Application (device + frame loop), OrbitController, debug HUD, URL switches
  ecs/              World, entities, component stores (components/), per-frame systems (systems/)
  rendering/        Renderer, render extraction, queues + batching, materials/, lighting/ (clusters, IBL, fog), shadows/, GPU culling
  gpu/              Thin managers over WebGPU: buffers, textures, samplers, shaders (#include + feature defines), pipeline + bind-group caches
  assets/           glTF/GLB loading + instantiation (gltf/), texture loading, Radiance .hdr
  animation/        Clips, animator, graph/ (state machines, blend trees, layers), ik/, motionmatching/, root motion
  particles/        GPU particle pools and ribbons
  geometry/         Mesh optimiser, simplifier, automatic LOD chains, meshlets
  visibility/       Frustum culling, BVH, LOD selection
  streaming/        Texture streaming policy + GPU streamer
  workers/          Web worker pool, frame-budget queue, geometry jobs
  math/ core/       Vec3 / Quat / Mat4 / AABB / Frustum, BitSet
  shaders/          WGSL (the engine's bind-group contract is in common*.wgsl)
  profiling/        GPU timestamp profiler, renderer statistics
  demos/            Demo scenes (register new ones in demos/index.ts)
  game/             Starter game
  selftest/ bench/  GPU self-test and benchmark pages
tests/              Unit tests (Vitest)
benchmarks/ tools/  CPU benchmarks; offline tools (LTC table fit, LOD timing)
docs/               MAKING_A_GAME.md
PROGRESS.md         Implementation status, measured results, known limitations
```

## Testing

* `npm test` — unit tests of the CPU side (ECS, math, culling, batching, animation, glTF, particles config, LOD, streaming policy, ...)
  using a fake GPU where needed.
* `/selftest.html` — runs the GPU kernels and shaders on your device and compares them with CPU references (34 checks).
* `npm run typecheck` / `npm run build` — strict TypeScript (`noUnusedLocals`, `noImplicitOverride`).

## Limitations

See [PROGRESS.md](PROGRESS.md#deferred--known-limitations) for the full list. Highlights: no built-in input / physics / audio / UI; glTF
supports one UV set and no Draco / meshopt / KTX2; transparent objects and particles are not fogged; GPU culling covers opaque and
alpha-masked batches.
