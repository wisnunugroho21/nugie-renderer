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

> To use the renderer from a separate game project as an npm package, see **Using it as an npm package** in the README.

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
| `/?scene=materials` (also `gltf`, `character`, `particles`, `lod`, `lights`, `occlusion`, `streaming`, `animgraph`) | demos (`animgraph` shows how to build state machines, blend trees and layers: `src/demos/animationGraphDemo.ts`) |
| `/selftest.html` | GPU self-tests (compute / lighting / shadows / fog vs CPU references) |
| `/bench.html?suite=lights\|cull\|passes\|anim` | benchmarks |

Demo URL switches (handy while developing): `env=sky`, `hdr=<url>`, `envI=<intensity>`, `fog=<density>`, `cluster=0`, `prepass=1`,
`cull=none|linear|bvh`, `gpucull=frustum|hiz2`, `gpulod=1`, `warmup=1` (the `lights` scene also takes `shadows=0` and `n=<lights>`).

**Starting your own game:** copy `game.html` and `src/game/` (rename them), add the page to `build.rollupOptions.input` in
`vite.config.ts`, and import everything from [`src/index.ts`](../src/index.ts).

---

## 2. Project layout

```
src/index.ts     Public API barrel: import from here
src/app/         Engine (what a game uses), Application (device + frame loop + resize), OrbitController, Hud, urlSettings
src/ecs/         World, entities, component stores (components/), per-frame systems (systems/)
src/rendering/   Renderer (frame orchestration: queues -> batches -> pass graph), RenderExtractor, RenderWorld, materials/, lighting/, shadows/,
                 post/ (post-processing, transmission copy), overlay/ (lines, points, sprites, text), GPU culling, primitives.
                 RenderFeature (the plug-in point: particles, ribbons, overlays and your own features), post/FullscreenEffect.
                 Small collaborators of Renderer: FrameUniform (per-view uniform), Skybox, GPULodIndex, lighting/LegacySceneLights, streaming/StreamingDriver
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

### Post-processing and anti-aliasing

```ts
engine.renderer.post.configure({ msaa: 4, fxaa: true, bloom: { intensity: 0.25, threshold: 1 }, toneMapper: 'neutral', exposure: 1.2, vignette: 0.25,
                                 ssao: { radius: 0.6, intensity: 1 }, ssr: { intensity: 1, maxRoughness: 0.5 } });
engine.renderer.post.disable();                 // back to direct rendering
// or from the start:  await Engine.create(canvas, { post: { msaa: 4, bloom: true } });
```

Two independent switches:

* **The post chain** (`configure` turns it on; `disable()` / `enabled: false` turns it off): the scene is rendered as linear HDR (`rgba16float`),
  then **bloom** (13-tap Karis prefilter, dual-filter pyramid, tent upsample) is added, **exposure** and a **tone mapper**
  (`aces` = the engine's classic look, `reinhard`, `neutral` = Khronos PBR Neutral, `none`) are applied, followed by saturation / contrast / vignette
  (display space), sRGB encoding with a 1-LSB dither, and optionally **FXAA**. Bloom settings: `threshold`, `knee`, `intensity`, `radius`, `levels`.
* **MSAA** (`msaa: 4`): a 4x multisampled colour + depth target resolved automatically. Works with or without the chain.
  It is disabled (with a console warning) while `gpuCulling` is `'hiz2'` because the Hi-Z pyramid samples a single-sample depth buffer; use FXAA there.

**SSAO** (`ssao: true` or `{ radius, bias, intensity, power, samples }`) darkens creases and contact points: normal-oriented hemisphere sampling against the
depth buffer, then a depth-aware blur. It multiplies the final lit image (it cannot tell direct from ambient light), so keep `intensity` moderate in brightly lit scenes.
**SSR** (`ssr: true` or `{ intensity, maxDistance, thickness, maxRoughness, steps, stride }`) reflects what is on screen in glossy opaque PBR surfaces: a ray march through
the depth buffer with bisection refinement; the weight follows Fresnel, smoothness and screen-edge fade, and it blends over the IBL reflection (misses keep the environment).
Both read an "aux" target (view-space normal, roughness, metallic) that the renderer draws after the main pass: opaque and alpha-masked **PBR** materials only. Custom
shaders get depth-derived normals for SSAO and no SSR; blended surfaces (glass, particles) are invisible to both and are not reflected. Costs: one extra draw of the opaque batches
plus a few full-screen passes. Limits: no off-screen reflections, reflected glossy surfaces are not blurred by roughness, and no temporal filtering (the sample noise is hidden by a blur).

Notes:

* Post-processing off (the default) is exactly the old path: shaders tone map and sRGB-encode themselves into the swap chain.
* **Custom WGSL materials** should end with `return vec4(outputColor(linearColor), alpha)` (provided by the engine prelude) instead of calling
  `linearToSrgb(tonemapACES(..))` themselves; otherwise their colour is tone mapped twice while the chain is on.
* With the chain on, blending (glass, particles) happens in linear light, so transparent objects look slightly different from the direct path.
  `renderer.clearColor` is converted from sRGB to linear for the HDR target.
* Changing `enabled` or `msaa` rebuilds pipelines on the next frame: set them before `await renderer.warmup()` to avoid a hitch.
* Not included: depth of field, TAA / SMAA, outlines.
* URL switches for the demos: `msaa=4`, `fxaa=1`, `bloom=<intensity>`, `tonemap=none|reinhard|aces|neutral`, `exposure=<x>`, `vignette=<0..1>`, `post=1`, `ssao=<intensity>`, `ssr=<intensity>`.

### Materials: shading models, surface detail, physical extensions

`createPBR` is one description that selects a shader variant; features you do not use are compiled out, so a plain material costs what it always did.

```ts
renderer.materials.createPBR({ baseColor, roughness, metallic });                                  // physically based (default)
renderer.materials.createPBR({ shading: 'toon', baseColor, toonSteps: 3 });                         // 'basic' | 'lambert' | 'phong' | 'toon' | 'matcap' | 'pbr'
renderer.materials.createPBR({ clearcoat: 1, clearcoatRoughness: 0.03, baseColor: [0.8, 0.05, 0.05, 1], metallic: 0.6 });   // car paint
renderer.materials.createPBR({ transmission: 1, thickness: 0.8, ior: 1.5, attenuationColor: [0.1, 0.7, 0.3], attenuationDistance: 1.2 });   // coloured glass
renderer.materials.createPBR({ displacementScale: 0.3, bumpScale: 0.03, textures: { baseColor, height } });   // terrain tile (use a subdivided mesh)
```

| Feature | Description fields | Notes |
|---|---|---|
| Shading models | `shading`: `basic` (unlit), `lambert`, `phong` (`shininess`, `specular`), `toon` (`toonSteps` bands, or a ramp texture in `textures.aux`), `matcap` (image in `textures.aux`) | lit models keep shadows, fog, normal / alpha maps and image-based diffuse; unlit ones only base colour + emissive |
| Height detail | `textures.height` (R) + `bumpScale` (bump mapping), `parallaxScale` (parallax occlusion, 24 layers), `displacementScale` / `displacementBias` (vertex displacement) | displacement needs a subdivided mesh and widened bounds (`world.bounds.padding[e]`); shadows and the depth prepass use the displaced shape |
| Alpha map | `textures.alpha` (G channel) | blends by default (`alphaMode: 'MASK'` for cut-outs); cut-out shadows honour it |
| Environment per material | `environment` (an `Environment` from `engine.captureEnvironment` / `renderer.ibl`), `envIntensity` | one prefiltered cube: its roughest mip stands in for the irradiance |
| Clearcoat | `clearcoat`, `clearcoatRoughness` | second GGX lobe on the geometric normal, direct + image-based |
| Sheen | `sheenColor`, `sheenRoughness` | Charlie distribution; the image-based part is a fit, not the glTF LUT |
| Transmission, volume, dispersion | `transmission`, `thickness`, `attenuationColor` / `attenuationDistance`, `ior`, `dispersion` | see below |
| Iridescence | `iridescence`, `iridescenceIor`, `iridescenceThickness: [min, max]` nm | thin-film Fresnel evaluated at the view angle (per fragment, not per light) |
| Anisotropy | `anisotropy` (-1..1), `anisotropyRotation` | stretched GGX highlights + a bent reflection vector; needs mesh tangents or uvs |
| Specular / IOR | `ior`, `specularIntensity`, `specularColor` | dielectric F0 from the IOR, tinted and scaled (KHR_materials_ior / specular) |

* **Transmission** refracts what is behind the surface. With the HDR post chain on (`renderer.post.configure({...})`) and a transmissive material in view, the main pass is split: opaque
  geometry and the sky are drawn first, copied (with mips, so rough glass blurs), and transmissive and blended surfaces then sample that copy at the exit point of the refracted ray (offset by
  `thickness`; `dispersion` bends red / green / blue differently; the volume absorbs with Beer-Lambert). Without the chain (or with `gpuCulling: 'hiz2'`, or inside render-target views) it
  refracts the environment only. Transmissive surfaces do not see each other. As a side effect the sky is now drawn before blended surfaces (it used to be drawn after them).
* **Per-pixel factors**: the one spare texture slot, `textures.aux`, doubles as the packed factors map for physical materials: R clearcoat, G clearcoat roughness, B transmission, A thickness (multiplied
  into the factors). Other extension maps (sheen colour, specular, iridescence thickness, anisotropy direction ...) are factor-only. Why: a pipeline layout is limited to 16 sampled textures per
  stage and the scene bind group already uses 7; materials now take 9 (base colour, metal-rough, normal, occlusion, emissive, height, alpha, aux, environment cube), which uses the budget up.
* Extension lobes are evaluated for point / spot / directional lights and image-based lighting; rectangular area lights use the plain GGX / diffuse model (diffuse only for the non-PBR models).
* Custom WGSL materials keep their five texture slots and end with `outputColor(...)` as before; the shared prelude gained the extra material bindings (unused by them).
* glTF: `KHR_materials_clearcoat / sheen / transmission / volume / ior / specular / iridescence / anisotropy / dispersion / unlit` factors are imported (their textures are skipped with a warning).
* Demo: `/?scene=gallery&env=sky` is a labelled ball per feature; add `&post=1` for screen-space transmission.

### Primitives

`createCube / createUVSphere / createPlane` plus, from `shapes.ts`: `createCylinder`, `createCone`, `createCapsule`, `createTorus`, `createTorusKnot`,
`createLathe(profile)`, `createTube(path)` (+ `sampleCatmullRom` to smooth a path), `createExtrude(polygon)`, `createShape(polygon)` (ear-clipping triangulation, no holes),
`createCircle`, `createRing`, `createQuad` (XY, faces +Z), `createPlaneGrid`, and the regular solids `createTetrahedron / Octahedron / Icosahedron / Dodecahedron(radius, detail)`
(`detail` > 0 subdivides towards a sphere with smooth normals). Every shape has outward normals, CCW winding, uvs and tangents, takes an options object with sensible defaults
(unit-sized, centred) and is covered by watertightness / volume tests. Create a mesh with `renderer.meshes.create(name, createTorus({ radius: 1 }))`.

### Object grouping

```ts
const arm = engine.spawnGroup({ position: [0, 2, 0], name: 'arm' });
const hand = engine.spawnObject({ mesh, material, position: [1, 0, 0], parent: arm, name: 'hand' });
engine.world.transforms.setRotation(arm, 0, Math.sin(t), 0, Math.cos(t));   // the hand swings with it
engine.setVisible(arm, false);                 // hides the whole tree
engine.setParent(hand, otherGroup, true);      // keepWorld: re-parent without moving it
engine.find('hand', arm);                      // by name, anywhere or inside one tree
engine.destroyTree(arm);                       // the group and everything below it
```

A group is an entity with only a transform; children inherit it (the transform system already did this). `ecs/Hierarchy.ts` adds `createGroup`, `childrenOf`,
`descendantsOf`, `rootOf`, `setParent` (optionally keeping the world pose), `setVisible`, `destroyTree`, `worldPosition` and `findByName` (names live in `world.names`).
Do not mark children of a group that moves as `RenderFlags.Static` (the static BVH assumes they never move).

### InstancedMesh and BatchedMesh

```ts
const rocks = engine.createInstancedMesh({ mesh: rock, material: grey, count: 50_000, position: [0, 0, 0] });
for (let i = 0; i < rocks.capacity; i++) rocks.setTRSAt(i, x, y, z, qx, qy, qz, qw, s, s, s);   // or setMatrixAt(i, m)
rocks.setMaterialAt(7, red); rocks.setVisibleAt(3, false); rocks.setCount(40_000);

const props = engine.createBatchedMesh({ material: concrete });
const [crate, barrel] = [props.addGeometry(crateMesh), props.addGeometry(barrelMesh)];
const id = props.addInstance(crate, { position: [1, 0, 2], scale: 2 });
props.setGeometryAt(id, barrel); props.deleteInstance(id);
```

Both are thin, tested layers over light entities parented to a group (move the group = move all). The renderer already merges objects sharing (mesh, material) into one
instanced draw and culls them individually, so a million-instance-style scene costs one draw per distinct (mesh, material) in view, not one per object: 100k cubes drew in
25 draw calls in the demo (`/?scene=shapes&n=100000`; about 20 ms of render CPU plus ~25 ms of per-frame extraction and transforms on the dev machine; GPU-side time was not the limit).
Differences from three.js: per-instance colour is done with `setMaterialAt` (a small palette of materials, still batched), and instance data lives in the ECS (CPU) rather than in a
GPU matrix buffer, so `setMatrixAt` costs a decompose. `BatchedMesh` draws one batch per DISTINCT geometry rather than one multi-draw for all of them.

### Lines, points, sprites and text

```ts
const lines = engine.createLineSystem({ autoClear: true, width: 2 });      // immediate mode: re-issue every frame
lines.grid(40, 40); lines.axes([0, 0, 0], 2); lines.box(min, max, [1, 0.5, 0]); lines.sphere(c, r); lines.arrow(a, b); lines.polyline(pts, color, 2, true);
const points = engine.createPointSystem({ size: 4, sizeUnit: 'pixels' });   // retained until clear()
points.addMany(xyzFloat32Array, [1, 1, 0.5, 1]);

const font = await engine.createFont({ family: 'sans-serif', weight: 'bold' });   // browser canvas -> glyph atlas
const labels = engine.createTextSystem(font);
const label = labels.addText(font, 'Hello\nworld', { position: [0, 2, 0], size: 0.3, align: 'center' });   // billboard in the world
label.setText('changed'); label.setPosition(p); label.remove();
const hud = engine.createTextSystem(font, { space: 'screen' });                   // pixels from the top-left, drawn on top
hud.addText(font, 'score 0', { position: [16, 16, 0], size: 22 });

const sprites = engine.createSpriteSystem({ texture, sizeUnit: 'pixels', blend: 'additive' });   // icons, glows, particles by hand
sprites.add({ position: [x, y, z], size: 24, uv: spriteSheetUV(2, 1, 4, 4), color: [1, 1, 1, 0.8] });
```

* **Lines** are screen-space quads of a width in pixels (anti-aliased, round-ish joins are not provided: square caps), colour and width interpolate along a segment, segments crossing
  the near plane are clipped. All segments of a system are one draw call. `depthTest: false` draws gizmos on top. Helpers: `line, gradient, polyline, segments, box, transformedBox, circle,
  sphere, arrow, axes, grid, cross, frustum`.
* **Dashes and caps**: `createLineSystem({ dashSize, gapSize, dashOffset, caps: 'butt' | 'square' | 'round', widthUnit: 'pixels' | 'world' })` (dash lengths in world units; the pattern runs on along a `polyline`, `setDash` animates it). Points take `minSize` / `maxSize` in pixels.
* **Points** are discs or squares sized in pixels or world units. **Sprites** face the camera ('camera'), turn about Y only ('axis-y') or lie in a plane ('fixed', with `right` / `up`);
  a system draws one texture. **Text** is glyph sprites from a font atlas: `\n`, wrapping (`maxWidth`), left / centre / right alignment, anchors; no kerning or complex scripts; one
  system per font, and the atlas is rasterised with the browser's canvas (so the font must be installed or loaded).
* All of them draw into the main pass after the scene (HDR / MSAA / post-processing aware), linear colours may exceed 1 (they bloom). They are not drawn into render-target views.
* Alpha-blended things are not sorted against each other: add overlapping sprites back to front.
* Demo: `/?scene=shapes&env=sky` (all primitives on a rotating carousel group, 8000 instanced cubes (`n=`), a batched mesh, debug boxes, a point cloud, sparkles, labels and a HUD; H hides the carousel).

### Render-to-texture: mirrors, minimaps, security cameras, probes

```ts
// planar mirror: a canvas-sized target, the main camera reflected in the plane, and the material that shows it
const mirror = engine.createMirror({ point: [0, 0, -6], normal: [0, 0, 1] }, { tint: [0.92, 0.96, 1] });
engine.spawnObject({ mesh: quad, material: mirror.material, position: [0, 2.6, -6], scale: [12, 5.2, 1] });   // a quad lying in that plane

// any other camera into a texture: a top-down minimap on a "monitor"
const target = engine.createRenderTarget({ width: 256, height: 256 });
const view = engine.addView({ target, interval: 2, skybox: false });        // interval 2: render every other frame
view.camera.topDownOrthographic(playerX, playerZ, 9);                       // update it whenever the player moves
const screen = renderer.materials.createPBR({ baseColor: [0, 0, 0, 1], emissive: [1, 1, 1], textures: { emissive: target.ref } });

// reflection probe: render the scene from a point into a cube map, bake it, light everything with it
renderer.setEnvironment(engine.captureEnvironment([0, 1.5, 0], { size: 128, exclude: (e) => e === chromeSphere }));
```

* **`RenderTarget`** (`engine.createRenderTarget`): colour (linear HDR `rgba16float`) + depth. `target.ref` is a `TextureRef` for any material slot (an emissive or
  base-colour texture on a PBR material, texture slot 0 of a custom one). `scale: 1` follows the canvas size (materials are refreshed on resize), `readPixels()` reads it back.
* **`RenderView`** (`engine.addView`): renders the scene from `view.camera` into the target every frame (or every `interval`th), before the main view, in the order added.
  Set the camera with `camera.position / target / fovY / aspect` + `update()`, `camera.setMatrices(view, projection, near, far)` or `camera.topDownOrthographic(...)`.
  `mirror: { point, normal }` renders the main camera reflected in a plane instead (oblique near plane, reversed winding), `exclude(entity)` leaves objects out.
* **No feedback loops**: objects whose material samples the target are skipped in that view automatically (a mirror never draws itself). A view that shows another target sees it as rendered earlier in the same frame when it was added later, otherwise as of the previous frame.
* **What a view draws**: opaque, alpha-masked and blended meshes with direct lighting from every light (plain light loop, no clusters), image-based lighting, the skybox and the
  main view's shadow maps (cascades are fitted to the main camera, so shadows can be missing far from it). Not drawn: particles, ribbons, fog, post-processing, MSAA.
  Custom WGSL materials should end with `outputColor(...)` (as for post-processing) so they write linear HDR into the target.
* **Mirror material** (`createMirrorMaterial`) shows the target at the surface's own screen position, so use it with `mirror` views (or as a "window"). The target should have the canvas aspect.
* **Probe** (`engine.captureEnvironment`): six 90 degree faces rendered in the WebGPU cube-map orientation, then irradiance + prefiltered specular baked by the IBL baker. It is one
  environment for the whole scene (no per-object probe volumes); a single capture point makes nearby objects look huge in the skybox, so capture at a distance or hide it (`sky=0`).
* Cost: each view is a full extra pass over the scene (culling, sorting, draws): keep views small, use `interval`, and `cull` the cheap way. Demo: `/?scene=rtt&env=sky` (add `probe=1`; P re-captures).
* Tests: `tests/viewMath.test.ts` (reflection, oblique plane, cube-face orientation against the WebGPU sampling rules, ortho map).

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

### Raycasting and picking

```ts
canvas.addEventListener('pointerdown', (e) => {
  const hit = engine.pick(e.clientX, e.clientY);              // nearest object under the pointer, or null
  if (hit) console.log(hit.entity, hit.distance, hit.point, hit.normal);
});
const down = engine.raycast({ origin: [x, 5, z], direction: [0, -1, 0] }, { maxDistance: 10, filter: (e) => e !== player });
const all = engine.raycastAll(ray);                          // every hit, nearest first
```

CPU-side: a world-AABB broad phase, then exact triangle tests (Moller-Trumbore in mesh-local space, so any scale / rotation works).
Options: `maxDistance`, `filter`, `skipHidden` (default true), `cullBackfaces`, `precise: false` (boxes only, cheapest). Notes:

* Results reflect the bounds and transforms of the last frame; the first pick needs one rendered frame.
* Meshes keep a CPU copy of their positions and indices (16 B per vertex-ish); set `renderer.meshes.keepCpuGeometry = false` before creating meshes to drop it (picking then uses boxes).
* Skinned and morphed meshes are tested against their (padded) world AABB, `hit.triangle === -1`.
* Particles, ribbons and lights are not pickable; the cost is linear in the number of renderers, fine for thousands, not for huge scenes.

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

**A new rendering feature** (a GPU simulation, a custom draw, a debug visualisation, a post effect): implement `RenderFeature` and register it with
`renderer.addFeature(feature)` - no change to the renderer. Every hook is optional. **The renderer's own parts use the same hooks**: shadows, light
clusters, volumetric fog, the sky, texture streaming, particles, ribbons, the line / point / sprite overlays and the post-processing chain are all
features (`renderer.features` lists them in run order), so reading one of them is the best documentation of a hook (see `src/rendering/RenderFeature.ts`).

| Hook | Runs | Used by |
|---|---|---|
| `beginFrame(frame)` | before the lights / scene uniform are uploaded; may change `frame.lights` | shadows (assign slots), clusters and fog (size the grids), texture streaming |
| `buildInstances(frame)` | before the instance buffer is uploaded (main view only) | shadows (caster batches) |
| `prepare(frame)` | after the frame's batches are built | overlays (upload) |
| `addPasses(graph, frame)` | while the pass graph is declared | shadow maps, clusters, fog, particle / ribbon simulation |
| `addPostPasses(graph, frame)` | after the scene, before the built-in post chain (HDR chain on) | the post chain itself, your effects |
| `drawBackdrop(pass, frame)` | main pass, after opaque geometry, before blended surfaces | the sky |
| `drawMain(pass, frame)` | main pass, after the scene | particles, ribbons, overlays |
| `retarget()` | the main pass's format / sample count changed | everything that owns a pipeline |
| `endFrame()` | after the submit | overlays (`autoClear`) |

Within every hook features run in `order` (`FeatureOrder`: streaming 0, shadows 10, clusters 20, fog 30, yours 100 by default, particles 100,
ribbons 200, overlays 300, post chain 1000). `produces` names the graph resources a feature's passes write, so the scene passes wait for them.

```ts
const feature: RenderFeature = {
  name: 'my-feature',
  order: 150,                           // runs (in every hook) after features with a lower order
  produces: ['myData'],                 // graph resources its passes write; the main pass waits for them
  prepare(frame)  { /* upload this frame's uniforms (frame.time, frame.camera) */ },
  addPasses(graph, frame) {             // compute / render passes, ordered by the declared reads and writes
    graph.addPass({ name: 'my-sim', writes: ['myData'], execute: (enc) => { /* dispatch */ } });
  },
  drawMain(pass, frame) {               // after the scene geometry and sky; set frame.frameBindGroup as group 0
    pass.setPipeline(pipeline); pass.setBindGroup(0, frame.frameBindGroup); pass.draw(3);
  },
  retarget() { pipeline = null; },      // the main pass's format / sample count changed (HDR, MSAA): rebuild pipelines from frame.target
  endFrame() { /* clear immediate-mode data */ },
};
renderer.addFeature(feature);           // renderer.removeFeature(feature) to unplug it
```

`frame` (`FeatureFrame`) carries the scene (`rw`, `camera`, `lights`, `visible`), the canvas size, the bind groups (`frameBindGroup`,
`sceneBindGroup`, `objectBindGroup()`), the main pass's `target` formats, the GPU `profiler` and the per-frame `instances` ring buffer.

`src/demos/featureDemo.ts` (`/?scene=feature`) is a complete, runnable template: a backdrop drawn in the main pass and a post effect.

**A new post effect**: a feature with `addPostPasses` (runs on the linear HDR scene colour, before bloom and tone mapping; needs
`renderer.post.configure({})`). `FullscreenEffect` turns one WGSL function into a pass - it supplies the pipeline, a scratch texture and the copy back:

```ts
const fx = new FullscreenEffect(engine.gpu, { label: 'grade', wgsl: `
  fn effect(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return vec4<f32>(color.rgb * params[0].x, color.a); }` });   // params = fx.params
renderer.addFeature({ name: 'grade',
  addPostPasses: (g, f) => g.addPass({ name: 'grade', reads: ['sceneColor'], writes: ['sceneColor'], execute: (enc) => fx.run(enc, f.sceneTexture) }) });
```

Effects that need their own multi-pass chain (blurs at several resolutions, screen-space techniques with several inputs) can create their own textures and
passes in `addPostPasses` the same way; the built-in SSAO / SSR / bloom live in `src/rendering/post/PostProcessor.ts` if you want to extend those instead.

**A rendering pass inside the renderer itself** (shadow-like passes that need its private state): add it in `Renderer.recordPasses` with
`g.addPass({ name, reads, writes, execute })`; passes are created in small `add*Pass` methods in `src/rendering/Renderer.ts`.

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
   `/bench.html?suite=passes` gives a per-pass breakdown (the spheres use a 3-level LOD group, `lod=0` turns it off; other options: `segs=<n>` sphere tessellation - small values make the scene fragment-bound, `lights=<n>`, `tile=<px>` / `slices=<n>` light-cluster grid, `frames=<n>`, `rows=1`).
7. Never `await` GPU readbacks in the frame loop.

---

## 9. Known limitations (see `PROGRESS.md` for the full list)

* Off-screen views do not draw particles / fog / post-processing; no per-object reflection probes or portals with recursion.
* Lines have no round joins / dashes, text has no kerning / SDF, there are no glTF-style line or point primitives (use the line / point systems).
* Material maps for individual extensions (clearcoat, transmission, thickness, sheen, specular, iridescence, anisotropy) are not supported beyond the packed `aux` map; transmissive objects do not refract each other.
* No DOF / TAA / SMAA (bloom, tone mapping, SSAO, SSR, FXAA and MSAA exist, see "Post-processing and anti-aliasing"); SSR is screen-space only.
* No built-in input, physics, audio or UI. Picking is CPU raycasting (no GPU ID buffer, no skinned-triangle hits).
* Transparent objects and particles are not fogged; area-light shadows are approximated by a cube map from the light's centre.
* The GPU-culling path handles opaque / alpha-masked batches (transparent stay on the CPU path).
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
