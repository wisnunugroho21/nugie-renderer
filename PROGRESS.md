# Implementation Progress

Source of truth: `IMPLEMENTATION_PLAN.md` (original lives in the Downloads folder). This file tracks status,
decisions and measured results. A phase is "done" only when its acceptance criteria + tests/benchmarks pass.

Run: `npm run dev` (demos at `/` with `?scene=<name>`, starter game at `/game.html`, benchmarks at `/bench.html`, GPU self-tests at `/selftest.html`) ·
`npm test` · `npm run typecheck` · `npm run bench` (CPU benchmarks).

## Status

| Phase | Topic | Status |
|---|---|---|
| 1 | Bootstrap (Vite/TS/Vitest, GPUContext, resize, device-loss) | DONE - verified in browser |
| 2 | Basic renderer (cube, depth, culling, camera) | DONE - verified in browser |
| 3 | Math + camera, persistent frame uniform | DONE - 17 tests |
| 4 | Resource managers + pipeline cache + metrics | DONE - tests |
| 5 | DynamicBufferAllocator (ring) | DONE - tests; 1000 objects = 1 buffer |
| 6 | Data-oriented ECS + dirty transform system | DONE - tests + benchmark (66-71x) |
| 7 | Render extraction / RenderWorld | DONE - tests |
| 8 | Material system (PBR, emissive, custom WGSL) | DONE - tests + browser |
| 9 | Render queues (radix sorted) | DONE - tests |
| 10 | Batching + instancing | DONE - tests + Benchmark A |
| 11 | Frustum culling (linear sphere/AABB) | DONE - tests + browser |
| 12 | Flat-array BVH (static) | DONE - tests + Benchmark B (CPU): 77x vs linear |
| 13 | glTF/GLB loader -> engine assets -> ECS instantiation | DONE - generated-GLB tests |
| 14 | PBR rendering of glTF (textures, normal maps, emissive) | DONE - browser (`?scene=gltf`) |
| 15 | Texture pipeline (sRGB/linear, GPU mips, dedupe, async) | DONE - browser; KTX2/Basis added later (see "Compressed assets") |
| 16 | Animation runtime (STEP/LINEAR/CUBICSPLINE, Animator, AnimationSystem) | DONE - tests |
| 17 | Skinning data (SkeletonAsset vs SkeletonInstance, JOINTS/WEIGHTS incl. _1) | DONE - tests |
| 18 | Skeleton updates (convention documented + tested) | DONE - tests |
| 19 | Shared JointMatrixBuffer (one buffer, sparse uploads; affine 3x4 = 48 B per joint, skipped when a skeleton's matrices did not change) | DONE - tests, 1000 skeletons = 0 extra buffers |
| 20 | GPU skinning | DONE - GPU parity self-test + browser |
| 21-22 | Morph target data + shared morph buffers (deltas, compacted active targets) | DONE - tests |
| 23 | GPU morphing | DONE - GPU parity self-test |
| 24 | Combined Morph -> Skin, one shared WGSL implementation | DONE - CPU order tests + GPU parity |
| 25 | Animated bounds (conservative expansion) | DONE - tests (joint/per-animation bounds deferred) |
| 26 | Animation blending (crossfade, 1D blend trees, override/additive) + deterministic state machine | DONE - 34 tests |
| 26A | Root motion (policies, axis filter, yaw extraction, no double application) | DONE - tests incl. ECS entity displacement |
| 26B | Layered animation + bone/morph masks | DONE - tests |
| 26C | IK: Two-Bone, FABRIK, Look-At (model space, weights, poles) | DONE - 18 tests |
| 26D | Motion matching (feature DB, search, inertialization) as a state-machine source | DONE - 24 tests + search benchmark |
| 26E | Particle core + emitters (GPU emit/simulate/compact, indirect dispatch/draw) | DONE - 20 CPU tests + 8 GPU self-tests |
| 26F | Billboard / point-sprite particles (screen, camera-facing, world-up, point; alpha/additive; flipbook) | DONE - GPU self-test + browser |
| 26G | Mesh particles (one mesh per pool, one indirect indexed draw) | DONE - GPU self-test + browser |
| 26H | Ribbons / trails / beams (chain) / flat streaks (one draw call per system) | DONE - 5 GPU self-tests + browser |
| 27 | LOD (LODLibrary/LODSystem, hysteresis) | DONE - triangles 7.12M -> 678k, GPU latency 9.2 -> 6.4 ms |
| 28 | Lighting groundwork: scene bind group v2, LightBuffer, ECS light extraction, multi-light PBR loop, ambient hemisphere, legacy fallback | DONE - 6 LightData tests + GPU parity self-test (5.8e-7 vs TS) |
| 28A | IBL: procedural sky / RGBE .hdr -> cube, GPU mip chain, irradiance (E/PI), GGX-prefiltered specular, split-sum BRDF LUT, skybox pass | DONE - 6 RGBE tests + 5 GPU self-tests (LUT 4e-4 vs CPU, constant-env energy check, orientation) |
| 28B | Rectangular area lights: exact polygon diffuse form factor + LTC GGX specular (offline fit, tools/fitLTC.ts) | DONE - GPU self-test vs brute-force quadrature (form factor 1.6e-5; specular ratio 0.89..1.35, tails over-estimated) |
| 29 | Clustered forward shading: compute light assignment (screen tiles x 24 exp. slices), global/ranged light split, fixed-stride lists + overflow counter | DONE - 2 GPU self-tests (CPU reference, overflow) + pixel-identical to naive loop + Benchmark C |
| 30 | Shadows: cascaded directional (4 cascades, stable fit + texel snapping) and spot shadow maps, depth32float array, deformVertex depth pass (skin/morph), alpha-mask cutouts, 3x3 PCF, normal-offset bias | DONE (cascades blend over the last 10% of each range in `shadowVisibility`; shadow casters are culled per layer through a static BVH + linear dynamic test, `CasterCuller`) - cascaded sun, spot and point-light (6-face) shadows; 5 math tests + browser verification (shadows only darken; GPU errors 0) |
| 31 | Render graph: passes declare reads/writes, stable topological order, culling of unused passes, cycle detection; the renderer builds its frame from it | DONE - 4 unit tests, used by every frame |
| 32 | GPU profiling: timestamp-query scopes (shadows, clusters, prepass, hiz, cull, main ...) resolved asynchronously through a staging ring, shown in the HUD | DONE - verified in browser |
| 33 | Depth prepass (opaque + alpha-masked, `@invariant` position, depth test `equal`) | DONE - pixel-identical to the single pass; dense-overdraw benchmark 1.4-1.7x |
| 34-38 | Hi-Z pyramid, GPU frustum + Hi-Z occlusion culling, compaction, indirect draws (`?gpucull=frustum\|hiz\|hiz2`) | DONE - Hi-Z pyramid exact vs CPU (self-test), images identical to CPU path, Benchmark G |
| 40 | Temporal visibility: two-phase occlusion culling (`hiz2`: draw last frame's visible set, build pyramid, test the rest) | DONE - Benchmark G: GPU pass time 26.5 ms -> 0.42 ms with 20k occluded spheres |
| 39 | GPU-driven LOD selection in the culling shader (batches of LOD-group meshes expand into one indirect draw per level; `?gpucull=frustum&gpulod=1`) | DONE - per-level counts identical to the CPU reference (60/448/319) and image identical; no hysteresis on the GPU path |
| 41 | Async work: `FrameBudgetQueue` (priority, per-frame time budget, cancellation, always progresses) | DONE - 2 unit tests |
| 42 | Texture streaming: CPU mip chains, per-texture resident mip range driven by on-screen coverage, memory + upload budgets, downgrade hysteresis, GPU-side mip copy on residency change (`/?scene=streaming`) | DONE - 7 policy tests + 2 mip-chain tests; demo: 533 MB of textures held in 22.7 MB |
| 43 | Web Workers: `WorkerPool` (priority, concurrency, transfers, errors) + geometry worker (LOD chains, meshlets); sync fallback in Node | DONE - 3 tests + browser (`?scene=lod&worker=1`, 25.6k-triangle chain: 329 ms blocking main-thread work moved off-thread) |
| 44 | Geometry optimisation: Forsyth vertex-cache reordering, fetch reordering, quadric edge-collapse simplification (boundary protected, flip rejection), automatic LOD chains (`/?scene=lod&auto=1`), meshlets with bounds + normal cones | DONE - 11 tests (ACMR 3.00 shuffled -> 0.68 optimised (row-major grid: 1.01), 32 ms for 20k triangles, silhouette error, meshlet coverage / cone culling safety); GPU meshlet culling: `MeshletCuller` (frustum + normal-cone compute pass compacting the surviving triangles into one index buffer drawn by a single `drawIndexedIndirect`; GPU self-test vs the CPU reference) is a standalone building block, not yet wired into the renderer's batches |
| 28C | Volumetric fog: froxel volume (8 px tiles x 48 exponential slices, rgba16f 3D), height-exponential density, directional + ranged lights (shadow-mapped, clustered), Henyey-Greenstein phase, ambient in-scatter; applied to meshes and sky with one lookup (`?fog=<density>`) | DONE - 2 GPU self-tests vs analytic transmittance / in-scatter (<= 3.5e-3) |
| 64 | Advanced optimisation: async pipeline warm-up (`renderer.warmup()` / `?warmup=1`: shared pipelines deduplicated, 220 material x variant jobs -> 12 compiles in ~0.6 s, no first-use hitch), bind-group cache keys unique per renderer / material manager (fixes stale resources when several renderers share one device), `@invariant` depth for prepass equality, GPU-driven culling / LOD / occlusion (phases 34-40), cluster + froxel work on the GPU | DONE - measured in Benchmarks B / C / G |

## Code review and restructuring (October 2026)

Review pass over the modules, typecheck, 437 unit tests and the 34 GPU self-tests all green afterwards. Changes:

* **`Engine`** (`src/app/Engine.ts`) now owns the GPU context, ECS world, every per-frame system, the render extraction, culling and the
  renderer, and runs a frame in the right order (`Engine.frame`). `main.ts` shrank from 137 to ~35 lines; the HUD text (`app/Hud.ts`),
  URL switches (`app/urlSettings.ts`) and the demo registry (`demos/index.ts`) moved out of it. Games use `engine.spawnObject`,
  `engine.spawnLight`, `engine.start(update)` and can add their own systems with `engine.addSystem(system, phase)`.
* `src/index.ts` is the public API barrel; `src/game/` + `game.html` is a compile-checked starter game.
* `Renderer.render()` (a 245-line function) is split into `uploadFrameData`, `buildBatches`, `recordPasses` and one `add*Pass` /
  `drawGeometry` / `drawExtras` method per pass, with a reused `FrameState` for the data they share. Behaviour is unchanged.
* `bench/main.ts` suite dispatch is a table instead of five copies of the same boilerplate.
* Every function, method and named helper now has a doc comment; stale comments were corrected.
* **Bugs fixed:**
  * The render pipeline layout counted 4 scene + 8 object storage buffers in the *compute* stage (12), which fails on GPUs whose
    per-stage limit is 10 (device creation succeeded, then every pipeline was invalid). The object group is now vertex-only; the
    compute-visible variant (`BindLayouts.objectCompute`) is used only by the GPU self-tests.
  * `RendererStats.reset()` wiped `cpu.extraction`, which the caller measures *before* `render()`; it is now preserved.
  * `WorkerPool.terminate()` left in-flight and queued job promises pending forever; they are now rejected.
  * `Application.stop()` did not cancel the pending animation frame (a quick stop/start could run two loops) and the resize observer
    was never released (`dispose()` added).
* **Follow-up fixes:** `DynamicBufferAllocator` now keeps one GPU buffer per ring slot, so offsets handed out earlier in a frame stay
  valid when the buffer grows (`generation` is a unique buffer id, so bind-group keys also differ per slot). `GPUCuller.prepare` no
  longer allocates per frame (reused scratch arrays, single pass per table) and its compute bind groups are cached. Renderers without
  bounds get their mesh's bounds automatically (`Engine.autoBounds`; `spawnObject` defaults to mesh bounds), so static objects always
  fit the BVH; deforming meshes still need explicit padded bounds.

## Feature-hook restructuring (October 2026)

Built-in rendering pieces now plug in through `RenderFeature` like user features. 599 unit tests, tsc, vite build and the 34 GPU
self-tests pass; canvas hashes for the lights, rtt and feature demos (default, chain, ssao+ssr+bloom, msaa+fxaa, frustum, hiz2, fog, naive)
are identical to before.

* **Hooks:** `beginFrame`, `buildInstances`, `prepare`, `addPasses`, `addPostPasses`, `drawBackdrop`, `drawMain`, `retarget`, `endFrame`,
  plus `order` (`FeatureOrder`, exported from `src/index.ts`) and `produces`. The old adapter functions are gone.
* **Converted:** shadows, light clusters, volumetric fog, sky, texture streaming, the post chain, particles, ribbons and the line / point /
  sprite overlays (shared `OverlaySystem` base). The renderer's hard-coded `MAIN_READS` list is now the registry's `producedResources`.
* **`Renderer`** no longer swaps state for off-screen renders: `ViewState` (target, formats, draw state) is passed explicitly, and
  `OffscreenViews` (new) owns render targets, views and probe capture. `formats.ts` holds the shared `DEPTH_FORMAT`.
* **`PostProcessor.addChainPasses`** is one small method per effect (view depth, SSAO, SSR, bloom, composite, FXAA).
* Docs: `MAKING_A_GAME.md` section 6 and file map, `ARCHITECTURE.md` and `RENDERER_WALKTHROUGH.md` describe the hook order and `ViewState`.
* GPU-culled draws are counted in `stats.triangles` / `stats.instances` by reading the indirect arguments back through a small staging ring (`GPUCuller.recordStats`); the values lag the frame by 2-3 frames and never stall it (`culler.collectStats = false` turns the readback off).

## Storage-buffer budget and arena guard (October 2026)

* **Vertex stage: 10 -> 6 storage buffers.** `deformData` is ONE arena for all skin weights and morph deltas (skin: 1 element per
  vertex at `skinBase`; morph: position [, normal [, tangent]] delta interleaved, `morphStride` (1-3, only what the mesh has) elements per vertex per target at `morphBase`, read as
  raw `vec4<u32>` and bit-cast, so no bit pattern is ever interpreted as a float). The material buffer holds the 64-byte records AND the
  custom parameters (a region after the records; `paramBase` is an absolute vec4 index; `paramVec4(i)` views a record as four vec4s,
  so `param_<name>()` accessors in custom shaders are unchanged). Object group = transforms, instances, joints, morph weights,
  deform data; material group = materials, sampler, 5 textures.
* The engine now runs within WebGPU's default limit of 8 storage buffers per stage; `GPUContext` requests exactly 8 and warns below 6.
  The GPU self-test, demos, fog, shadows and GPU culling all pass on a device capped at 8.
* **Consequences to keep in mind:** a merged buffer is one binding, so it is bound by `maxStorageBufferBindingSize` (128 MB default);
  growing the material records moves the parameter region (every custom record is re-pointed and everything re-uploaded, bind groups
  rebuilt); the GPU culling pass uses all 8 of its storage bindings (merge `batchInfo` / `batchFirst` / `thresholds` before adding a
  ninth).
* **`Arena` size guard:** each arena reads the device limits (`maxBufferSize`, and `maxStorageBufferBindingSize` for storage arenas).
  Growth never doubles past the limit, a request that cannot fit throws `ArenaCapacityError` (arena label, requested vs allowed bytes),
  and a warning is logged once above 80% of the limit. `Arena.ensureRoom(count)` checks without consuming.
* **`MeshManager.create` is all-or-nothing:** it validates the input and reserves room in the vertex, index and deform arenas before
  allocating from any of them, so a failure leaves no half-created mesh and no wasted space.
* Tests: `tests/arena.test.ts` (limits, errors, capped doubling, warning, atomic mesh creation), updated `tests/materials.test.ts`.

## Conventions (documented decisions)

- Column-major matrices, column vectors, right-handed, camera looks down -Z.
- Clip depth [0,1], **standard Z** (not reversed). Revisit at Phase 34 (Hi-Z) if precision demands reversed-Z.
- Vertex layout: position(3) normal(3) uv(2) tangent(4), 48 B; all static meshes share one VB + one uint32 IB.
- Tangent convention (glTF): tangent along +U; bitangent = cross(N,T)*w points to image-UP (decreasing V).
- Bind groups: 0 Frame, 1 Scene, 2 Material (shared records + params + sampler + 5 textures), 3 Object (transforms + instances).
- Material id == record index in the shared `MaterialBuffer`; custom params in the shared `CustomMaterialParameterBuffer`.
- Custom shaders may not declare `@group/@binding`; they use generated `param_<name>(base)` accessors.
- ECS component data is indexed by entity INDEX; `Entity` ids carry a generation to detect stale handles.

## Benchmark results (this machine, Chromium WebGPU in the Claude browser pane)

### Phase 6 - Transform update, 10,000 entities / 100 dirty (`npm run bench`)
dirty-only 0.019 ms vs recompute-all 1.25 ms -> **~66-71x**.

### Phase 10 - Benchmark A: draw submission (`/bench.html`), 60 frames mean
| scene | mode | draws | mat switches | CPU total ms | submit->done ms |
|---|---|---|---|---|---|
| 10k cubes, 1 mat, 1 mesh | unsorted | 10000 | 1 | 3.80 | 24.8 |
| | sorted | 10000 | 1 | 4.82 | 25.3 |
| | instanced | 1 | 1 | 2.95 | 8.9 |
| 10k objs, 8 mats, 2 meshes | unsorted | 10000 | 8735 | 7.70 | 43.7 |
| | sorted | 10000 | 8 | 3.60 | 21.4 |
| | instanced | 16 | 8 | 2.40 | 8.7 |

Takeaway: sorting only pays when state actually varies (it cost +1 ms with a single material); instancing is the big win.

### Phase 11/12 - Benchmark B (CPU part), 100,000 objects, ~1.3% visible (`npm run bench`)
| strategy | ms/op | vs linear sphere |
|---|---|---|
| BVH (static scene) | 0.032 | 77x |
| linear, bounding sphere | 2.49 | 1x |
| linear, AABB | 2.96 | 0.8x |
| BVH build (one-off, 100k) | ~400 ms | - |

GPU frustum / Hi-Z variants of Benchmark B arrive with Phases 35/36.

### Phase 13-15 - glTF pipeline smoke (`?scene=gltf`)
Generated textured GLB (4 PNG textures) loads + instantiates in ~165 ms; 4 texture uploads shared by 3 instances;
3 instances drawn in 1 instanced call; 0 validation errors.

### Phase 19-25 - Animation benchmarks D/E/F (`/bench.html?suite=anim`, Intel Gen12LP iGPU, 16.7k-vertex tubes)
CPU per frame (anim + transform/skeleton + extract + render), submit->done = GPU+CPU latency:
| scenario | CPU ms | joint upload | submit->done ms |
|---|---|---|---|
| 100 skinned characters | 0.5-0.8 | 19 KB | 8.3 |
| 500 skinned characters | 1.9-2.3 | 96 KB | 33 |
| 1000 skinned characters | 3.7-3.9 | 192 KB | 64 (16.7M skinned vertices/frame) |

Morph vertex-bound (200 instances, 16 targets): BEFORE active-target compaction 0 active = 20.5 ms and 16 active = 20.6 ms
(the shader looped over ALL targets); AFTER: 9.7 ms and 9.3-10.4 ms (static baseline 8.6 ms). Compaction halved vertex-bound
morph cost and made it independent of the total target count; uploads shrink to 2 words per active target.

GPU self-test page `/selftest.html` (8 checks): WGSL `deformVertex` vs CPU reference for static/morph/skin/morph->skin
(max err 3.6e-4 = unorm16 weight quantization), `vertex_index` includes `baseVertex`, sRGB/linear mip filtering, no GPU errors.

### Phase 26D - motion matching brute-force search (`npm run bench`)
| database | search time |
|---|---|
| 6,000 frames x 30 dims | 0.11 ms |
| 30,000 frames | 0.50 ms |
| 120,000 frames (>1 h @ 30 fps) | 2.46 ms |
Searching every 0.1 s keeps this negligible, so KD-tree/ANN is NOT justified yet (per plan: only when profiling says so).
Build (offline) cost: ~20 ms per 1,000 frames.

### Phase 26E - GPU particle simulation scale (Intel Gen12LP iGPU; emit + simulate + compact, per-frame submit->done)
| alive particles | ms / frame |
|---|---|
| 100,000 | 4.7 (latency floor) |
| 500,000 | 4.3 |
| 1,000,000 | 13.9 |
No GPU->CPU readback in the frame loop; the alive count only exists on the GPU (indirect dispatch + indirect draw).

### Benchmark C - fragment-bound lighting (Chromium WebGPU, submit -> done latency, 1600x900, 400 spheres + floor)

| lights | naive loop | clustered | speedup |
|---:|---:|---:|---:|
| 16 | 5.98 ms | 4.06 ms | 1.5x |
| 64 | 8.65 ms | 4.62 ms | 1.9x |
| 256 | 23.6 ms | 5.33 ms | 4.4x |
| 1024 | 86.8 ms | 12.4 ms | 7.0x |
| 4096 | 338 ms | 29.0 ms | 11.7x |

Run: `/bench.html?suite=lights`. Clustered output is pixel-identical to the naive loop (max channel difference 0) as long as no cluster list overflows (256 per cluster by default; overflow is counted on the GPU).

### Benchmark G - GPU-driven visibility (CPU culling disabled, 20,000 spheres of 2,304 triangles, 640x360)

| scene | mode | frame latency | GPU pass time |
|---|---|---:|---:|
| mostly visible | off | 36.0 ms | 29.0 ms |
| mostly visible | frustum (GPU cull + indirect) | 36.4 ms | 29.3 ms |
| mostly visible | hiz (in-frame prepass) | 53.6 ms | 47.2 ms |
| mostly visible | hiz2 (two-phase) | 30.4 ms | 22.7 ms |
| behind a wall | off | 32.7 ms | 26.5 ms |
| behind a wall | hiz | 32.3 ms | 25.6 ms |
| behind a wall | hiz2 | 6.7 ms | 0.42 ms |

Run: `/bench.html?suite=cull&n=20000`. In-frame `hiz` cannot win because the prepass still draws everything; the temporal two-phase variant removes that cost.
Note: GPU culling saves nothing when everything is visible; its value is occluded / off-screen geometry and offloading the CPU.

### Benchmark B - GPU time per pass (timestamp queries; cascaded sun + spot shadows, 512 clustered lights, IBL, fog, 3,000 spheres, 1024x768)

| configuration | total | main | shadows | fog | clusters | prepass |
|---|---:|---:|---:|---:|---:|---:|
| everything on | 23.7 ms | 18.5 | 3.8 | 0.9 | 0.46 | - |
| no fog | 21.9 ms | 18.0 | 3.5 | - | 0.41 | - |
| no shadows | 19.4 ms | 18.1 | - | 0.8 | 0.45 | - |
| no shadows, no fog | 17.0 ms | 16.6 | - | - | 0.42 | - |
| everything + depth prepass | 23.4 ms | 17.0 | 3.5 | 0.9 | 0.40 | 1.7 |

Run: `/bench.html?suite=passes` (`segs=8` makes it shading-bound: the default scene has ~3.2M triangles, so about half of its 18 ms main pass is geometry). Shadows cost ~3.6 ms, froxel fog ~0.8 ms and light assignment ~0.4 ms; the depth prepass saves ~1.5 ms of main-pass time but costs 1.7 ms here (no net gain without heavy overdraw).

## Particle / ribbon architecture (Phase 26E-H)
Per pool: ParticleStateBuffer, ParticleAliveBuffer A/B (ping-pong), ParticleDeadBuffer (atomic stack), ParticleSpawnBuffer,
EmitterBuffer, ParticleIndirectArgsBuffer. Kernels: reset -> simulate (indirect) -> emit -> finalize (writes draw + dispatch args).
The indirect-args buffer is bound as writable storage ONLY in the finalize kernel (a buffer cannot be INDIRECT and writable
storage in one sync scope). Ribbons: one shared ring segment buffer; trails commit points when the head moved `minSegment`;
chains are CPU-written control points (lightning via `beamPoints`); geometry is generated in the vertex shader.
Particles use additive/alpha blending in display space until the HDR post-process chain exists (Phase 31/32).

## Animation graph architecture (Phase 26)
`AnimationController` = layers (state machine each) -> override/additive blend with per-node masks -> root-motion policy
-> constraints (IK). Poses are local-TRS SoA (`Pose`); blending never uses matrices. `Motion.update()` is a once-per-frame hook
so stateful sources (motion matching) can sit inside states/blend trees. `AnimationSystem` writes only changed nodes into the ECS.
Conventions: character forward = +Z; IK/look-at targets are in the owner entity's MODEL space (`AnimationSystem.worldToModel`).

## Render graph as data, Gigi style (October 2026)

* `src/rendering/graph/`: a technique schema modelled on EA SEED's Gigi (resources with type / size / lifetime / visibility, typed variables, compute / draw / copy / sub-graph / callback nodes),
  a flattener (sub-graph inlining, loop unrolling, variable binding), a compiler (size resolution, validation, dependencies, culling, stable or transition-minimising order, lifetimes, transient
  memory aliasing), shader tokens, a WebGPU runtime (`TechniqueInstance`), JSON load / save with strict validation and a Graphviz export. The frame graph uses the same analysis (it is now a technique itself, see "One render graph" below) and also reports resource spans and
  transition statistics. Documentation: `docs/TECHNIQUES.md`.
* Tests: `tests/technique.test.ts` (37) and four GPU self-tests (compute chain with aliased textures, size-variable recompile, looped sub-graph, draw into an imported texture) checked against CPU values.
* `TechniqueBuilder` (`technique(name)`): the same graphs from code, with typed variable / resource handles, a `wgsl` template tag and `instantiate(gpu)`; `tests/technique-builder.test.ts` (7, including equality with the JSON example files) and a GPU self-test.
* Demo `/?scene=technique`: a builder-made plasma + blur technique running as a frame-graph pass (via `addTo` in a `RenderFeature`), with live recompiles. Writing it exposed (and fixed) texture reallocation on condition toggles; `TechniqueInstance.onResourcesReplaced` reports genuine replacements.
* Not done: a visual editor / viewer, code generation backends, ray tracing nodes.
* Draw nodes later gained vertex / index buffers, indirect (indexed) draws, `baseVertex` and MSAA targets with resolve.

## Engine passes moved onto the technique render graph (October 2026)

* The post chain (view depth, SSAO, SSR, bloom, composite, FXAA), user full-screen effects, the transmission copy + mip chain, light-cluster assignment, volumetric fog, GPU culling (3 phases),
  the Hi-Z pyramid, GPU particles and ribbon trails now run as technique nodes inside the frame graph (table: `docs/TECHNIQUES.md`, "What the engine runs as techniques").
* New technique capabilities this needed: host-supplied bind groups + a configurable group index for generated bindings, bindings to a mip range (disjoint ranges of one texture in one node),
  GPU timestamp hooks on `execute`, and dependency analysis that lets a node read the incoming contents of an imported / persistent resource that a later node overwrites.
* Verification: `postTests` (GPU self-test, golden images recorded from the hand-written chain: 4 configurations incl. a multisampled depth buffer, bit-exact), the cluster / fog / Hi-Z / particle / ribbon
  self-tests against their CPU references, and pixel-identical frames through the real engine against a build of the previous commit for the post chain (5 configurations), the feature demo, lights + fog,
  LOD with GPU culling (off / frustum / hiz2), the material gallery with transmission, and particles.
* Technique nodes can now declare bindings in several `@group`s (per-binding `group`), bind buffers as `var<uniform>` single elements, and give a buffer binding a dynamic offset (`setDynamicOffset`), so per-view / per-object data can live in one ring buffer. Unit tests on a recording fake device and a GPU self-test (three groups, three views from one uniform buffer).
* **Render nodes** (`g.renderPass`): the technique owns a render pass's attachments (MSAA resolve, depth layer / read-only, timestamps) and the host records many draws with its own pipelines and bind groups through a state-tracking `TrackedRenderPass`. The depth prepass, the aux pass and the shadow-map layers now run as render nodes, pixel-identical to the callback versions (lights + prepass + 7 shadow layers, MSAA and single-sample SSAO/SSR, LOD with GPU culling).
* The **main pass(es)** are render nodes too (`MainPassNode`): the technique owns the swap chain / HDR scene image, the MSAA buffer and its resolve, the depth load / clear and the clear colour; the scene draws and the features' hooks record inside. Frames are pixel-identical to the callback version in 30+ configurations (post chain x5, direct and HDR MSAA, transmission with MSAA and SSAO, GPU culling off / frustum / hiz2 with and without post, lights + fog + prepass + shadows, particles).
* **Segments and the tracked pass everywhere**: a render node's draws are ordered segments (`passSegment`), recorded through one `TrackedRenderPass` that also wraps render bundle encoders (`isBundle`, `executeBundles`, `invalidate`). The scene draw loop (batches, indirect culled draws, retained bundles) and every feature hook (sky, lines, points, sprites, particles, ribbons, custom features) now draw through it; `RenderFeature.drawBackdrop` / `drawMain` receive a `TrackedRenderPass` instead of a raw encoder (the raw one is `pass.encoder`). Each feature is a named segment of the main pass in the graph. Verified pixel-identical against the previous commit (post chain x6, LOD + GPU culling x9, lights + fog + prepass + shadows, particles, feature demo, sky, shapes demo with lines / points / sprites in direct / MSAA / post, render-to-texture) with unchanged CPU time per frame at 6001 draws.
* **Copy and clear nodes** (`g.copy` with `from` / `to` / `size`, `g.clear`): texture<->texture (mips, origins, layers), buffer<->buffer (offsets, runtime sizes) and texture<->buffer (row layout), validated against the declarations; techniques can run on a device-only `TechniqueHost` for imported-resource copies. Every encoder copy in the engine moved onto them: arena growth, streamed-texture mip copies, the profiler's query staging copy, all readbacks (`RenderTarget.readPixels`, particle / ribbon debug reads, the self-test helpers via `graph/Readback.ts`) and the cluster overflow clear. Verified: texture streaming (105 level changes, same bytes and image), regrown arenas (byte-identical contents), profiler timings, render targets.
* The **offscreen render-to-texture views and reflection-probe captures** are render nodes too (`MainPassNode` with an array layer for the cube faces and a discarded depth); `ViewJob` names textures instead of views. Pixel-identical (RTT demo with three views incl. a mirror, two probe captures with different options), and target resizes rebuild the node. `IBLBaker`, `MipmapGenerator`, `CompactVertexStream` are asset-preparation utilities.

## Render graph cost check (October 2026)

Draw-submission benchmark A (`/bench.html`, 10,000 draws, CPU ms per frame) on the current build against a worktree at the last commit before the engine moved onto the graph (2ee50d4), runs interleaved on the same machine:

| | baseline | render graph |
|---|---|---|
| A1 unsorted | 7.7 / 7.8 | 7.7 / 7.8 (first run 8.4-8.6, before the fix below) |
| A2 unsorted | 9.8 / 9.9 | 10.5 |
| A2 sorted | 8.6-9.1 | 8.1-9.2 |
| instanced (fixed per-frame cost) | 0.23-0.56 | 0.34-0.61 |

GPU time per pass (benchmark B) differs by less than the run-to-run noise (about 3 ms on this iGPU). Found and fixed: every render pass created its attachment views and error strings each frame; `TechniqueInstance` now caches single-mip views per texture and the node context strings, which removed the ~10% CPU regression seen on the 10k unsorted path. What is left is a fixed per-frame cost well under 0.2 ms.

## One render graph (October 2026)

The engine had two render graph systems: the Gigi-style technique compiler and `RenderGraph`, a flat list of callback passes that shared only the analysis code. `RenderGraph` is gone; the frame is one technique, and in a second step every engine pass in it became data nodes.

* `logical: true` resources (`TechniqueBuilder.logical(name)`): names for ordering that hold no memory; callback nodes use them, any node can wait for one with `after`. `TechniqueInstance.addTo()` (replaces `asPass`).
* `rendering/graph/FrameGraph.ts`: `FrameGraph.begin()` returns a `FrameBuilder`; `run()` compiles, or reuses the plan when `structureKey()` is unchanged and hands the instance this frame's imports, variable values, host bind groups, dynamic offsets, GPU timestamps and code (`setHostCode`). `Renderer.graph` became `Renderer.frame`.
* `FrameBuilder.importTexture / importBuffer` declare a host object as an imported resource from the object itself; `include(node, technique, { imports, variables, outputs, after, publish })` runs a system's technique as a sub-graph with the frame's names, binding its variables to `<node>/<name>`; `publish` says what the scene passes wait for (replaces `produces` for the engine's own features).
* Converted from callbacks to data nodes: shadow layers (render nodes), light clusters, fog, GPU culling (three nodes), Hi-Z, transmission copy, the post chain, particle pools, ribbon trails, full-screen effects (`FullscreenEffect.addToFrame`) -- all `include`d techniques -- and the depth prepass, the aux pass and every main pass (`declareMainPass`, render nodes whose segments are the scene and the features' draws). Hi-Z, transmission and fog volumes are created by their owners and imported (they were exported by their techniques). The periodic off-screen views (`addView`: mirrors, minimaps, security cameras) are render nodes of the frame too (below); the probe capture runs between frames and stays a small technique of its own.
* Node attribute `after` (ordering-only dependency, usage `order` asks for no GPU usage), `pipelineCache` (pipelines survive a frame recompile), `callback` usage no longer demands texture / buffer usage flags of the objects it names.
* Hooks changed: `RenderFeature.addPasses` / `addPostPasses` (and `PostProcessor.addChainPasses`, `ParticleSystem.addPasses` ...) receive a `FrameBuilder`; `graph.addPass({ name, ..., sideEffect })` is `graph.callback(name, { ..., keep })`; a callback names what it touches with `graph.logical(...)` (the engine's resources only exist once the pass that owns them was declared).
* Verified: 804 tests, GPU self-tests 65/65 (post-chain golden images, culling, Hi-Z, fog, clusters, particles, ribbons), a 22-scene / setting battery (`tools/frameBattery.js`: prepass, MSAA, post chain, transmission, `hiz2` and frustum culling, shadows, clusters, fog, particles, ribbons, a feature and a technique pass) with the frame image identical to the callback-based frame in the 18 deterministic scenes and within noise (the baseline's own run-to-run noise) in the 4 that load asynchronously or use random sparkles, the plan compiled once over repeated frames, and benchmark A (10k draws) unchanged.

### Off-screen views in the frame (October 2026)

* `OffscreenViews.renderDue` now prepares each due view (writes its uniforms, builds its queues and batches) instead of drawing it; `OffscreenViews.declarePasses` declares them as render nodes `view:<n>` at the head of the frame (registration order, before the shadow passes, so a view still shows the previous frame's shadow map and lights). One command buffer and one submit instead of one per view.
* Each view owns a `FrameUniform` and a `ViewScene` (`SceneResources.createViewScene`: the main view's last scene uniform with clusters and fog switched off, in its own buffer and bind group) plus a `ViewState`, kept while it is registered, because the passes are recorded after all the views were prepared; `ViewState.frameBindGroup` / `sceneBindGroup` make `drawGeometry` use them. `removeView` frees them. The main view's uniforms are no longer overwritten and restored around the views.
* `captureEnvironment` is unchanged: it runs between frames and bakes straight away. `OffscreenViews` owns the whole view lifecycle now; `Renderer` only supplies draw primitives through a small `ViewHost` (`buildBatches`, `drawGeometry`, `drawSky`).
* Verified: 809 tests, GPU self-tests 65/65, the scene battery (`rtt`: mirror, minimap with interval 2, security camera, three monitors sampling them) identical to the callback-based frame, a probe capture between frames with no GPU errors.

### Review, benchmark and clean-up after the frame became one graph (October 2026)

* Review findings fixed: a view's winding followed the mirror only when first created; `FrameBuilder.include` now refuses techniques with callback / render nodes (a reused plan cannot refresh their code); the view segment / batch code that existed three times is one place in `OffscreenViews` (which now owns the view lifecycle, with `Renderer` supplying `ViewHost` primitives); `ViewScene` reuses its scratch buffer; stale docs on logical resources.
* Dead code removed: `ViewState.shadingTarget`, `PostProcessor.msaaView`, `PipelineCache.getCompute` (+ its map), `Mat4.multiplyAt`, `TextureStreamer.residentLevel`, `MaterialManager.paramLayout`.
* Frame cost (`npm run bench:frame`, no GPU: declaring a 10-node frame with 5 particle pools, clusters, fog, culling and the 40-variable post chain, its structure key, and running the reused plan): **about 86 us per frame** (declare 62 us, key 18 us, run 6 us), under 0.6% of a 60 fps frame. In the browser the cost shows as 0.03 ms (one pass) to about 0.12 ms (eight includes) next to the passes' real work. `include` and `structureKey` were tuned for this (per-technique check cache, direct sub-graph node, hand-written key for sub-graph nodes: key 58 -> 31 us in the browser).
* Browser frame times on this machine swing 2-5x from minute to minute (the same build measured 4 ms and 15 ms for 10k unsorted draws within minutes, in both the old and the new build), so A/B runs of whole frames only resolve large differences; use `tools/frameTiming.js` (CPU time of `engine.frame` per scene) and `tools/frameBattery.js` (pass order + image per scene) alternately on both builds, and `npm run bench:frame` for the graph's own cost.

### Steady-state cost review of the frame graph (October 2026)

Benchmarked against a worktree at the last commit before the render-graph work (b2d88e3), same Intel Gen12LP iGPU, production builds, runs interleaved.

* **Fixed: every step rebound every frame.** `setImport` set one instance-wide "bindings dirty" flag, and the triple-buffered instance ring (`instances`) is a different buffer each frame,
  so with GPU culling every step of the frame recreated its bind groups and texture views: 31 bind groups and 92 views per frame in a 34-step frame (post chain, fog, `hiz2`). Steps are now
  rebound only when a resource *they* bind changes, and each step keeps its last few bind-group sets by physical resource, so a cycling import costs nothing once warm: **0 per frame**.
* **Fixed: every step's uniform rewritten when any variable changed.** `TechniqueInstance` now tracks which steps read each variable and rewrites only those uniforms.
* **Fixed: a frame whose shape alternates recompiled every frame.** A view with `interval: 2` (or transmission switching on and off) changed the structure key every other frame; `FrameGraph`
  disposed and rebuilt the whole instance each time: 11 textures, 21 buffers and 32 bind-group layouts per frame, ~4 ms CPU instead of ~1 ms, and the contents of persistent resources were lost.
  `FrameGraph` now keeps the last four plans (an idle one is freed after 120 frames) and they share memory through `AllocationPool` (`rendering/graph/AllocationPool.ts`): **0 GPU objects** over 20 alternating frames.
* **Fixed: shadow GPU timing.** All shadow layers shared one pair of timestamp queries, so the `shadows` time in the HUD / benchmark B was the last layer's only; each layer has its own pair again (summed, as before the migration).
* **Wasted work removed:** `HiZ`, `ClusterGrid`, `VolumetricFog` and `FullscreenEffect` built a standalone `TechniqueInstance` (pipelines, a full-size scratch texture for the effect) that only their
  `encode` / `run` paths use; the frame path never executed it. They are now made on first use. `ShadowSystem` reuses its per-layer `BatchList`s. `FrameBuilder.include` caches the frame names of a
  technique's variables, variable handles are made on demand and `structureKey` stays on `JSON.stringify`'s fast path: declaring the `bench:frame` frame went from ~41 to ~29 us.
* **Dead code removed:** `GPUCuller.encode` (+ the three instances its constructor built), `TransmissionCopy.copyFrom`, `HiZ.fullView`, `ShadowSystem` per-layer views, `RenderTarget.depthView`,
  `PostProcessor.structureVersion`, `PostFrameInfo.depthView`, `FeatureRegistry.drawBackdrop / drawMain` (replaced by `FeatureRegistry.segments`, which `Renderer` uses for the main-pass segments).
* **Results.** GPU time per pass (benchmark B, everything on): 13.25 / 13.08 ms baseline vs 13.71 / 13.16 ms now, within noise. Benchmark A CPU, instanced path (one draw, GPU idle-waited
  every frame, so caches are cold): 0.32-0.44 ms baseline vs 0.51-0.65 ms now; the difference is the per-frame declaration and execution of the graph (~0.05-0.15 ms on this laptop), the
  price of re-declaring the frame every frame. Unsorted / sorted 10k-draw paths are within noise. Verified: 821 tests, GPU self-tests 65/65, `npm run check`, scenes `rtt`, `materials` (MSAA, SSAO, SSR,
  bloom, FXAA, transmission), `lights` (fog, prepass, clusters), `particles`, `occlusion` (`hiz2`) and `gallery` with every feature on, no GPU validation errors.

## Compressed assets (October 2026)

* **`EXT_meshopt_compression`** and **`KHR_draco_mesh_compression`** are decoded while parsing (`parseGLTF` -> `assets/gltf/GLTFCompression.ts`): the document that comes
  out is plain glTF (decoded data lives in one extra buffer, Draco primitives get ordinary accessors), so the rest of the loader is unchanged. `KHR_mesh_quantization`
  vertex data is accepted (the accessor reader already handled normalised / integer attributes).
* **KTX2** (`assets/codecs/Ktx2.ts`, `Ktx2Texture.ts`) and **`KHR_texture_basisu`**: UASTC and ETC1S payloads are transcoded to the best format the device supports
  (UASTC: ASTC 4x4, BC7, ETC2, BC3 / BC1; ETC1S: ETC2, BC7, BC3 / BC1; RGBA8 when none is available or the size is not a multiple of 4) and uploaded with the mip chain stored in
  the file. KTX2 files that already hold a GPU format (BC, ETC2 / EAC, ASTC, uncompressed RGBA8 / R8 / half and float formats) upload directly; Zlib and Zstd supercompression are undone.
  The devices' `texture-compression-bc | etc2 | astc` features are requested in `GPUContext`.
* Decoders are the vendored builds in `src/assets/vendor` (see its README), loaded lazily; `configureCodecs({ draco, basis })` points them at other URLs / bytes.
* Tests: `tests/codecs-gltf.test.ts` (real encoders: meshoptimizer, draco3d), `tests/codecs-ktx2.test.ts` (real UASTC / ETC1S fixtures from `scripts/make-codec-fixtures.ts`),
  GPU self-tests (`/selftest.html`: every transcode target decoded on the device and compared with the RGBA8 transcode) and `/?scene=compressed`.

## Meshlet culling in the draw path (October 2026)

* **`renderer.meshlets`** (`rendering/MeshletDraws.ts`): `enable(meshId)` builds meshlets (64 vertices / 124 triangles) from the mesh's CPU geometry copy and gives it a
  `MeshletCuller`. After the batches are built, `plan` picks the main view's batches the cull is exact for (one instance, static mesh, `cullMode: 'back'`, positive determinant,
  opaque / alpha-mask, not GPU instance-culled; one batch per culler per frame). A callback node `meshlet-cull` records one compute pass per such draw (the object's transform,
  the camera frustum and position, the mesh's `baseVertex` and the batch's `firstInstance`); the main pass waits for it through the published logical `meshletDraws`.
* **`DrawRecorder`** draws those batches with the culler's compacted index buffer and one `drawIndexedIndirect` (then rebinds the shared index buffer). It works on the standard, packed
  and directional paths and inside retained render bundles (the culler is part of the bundle signature; the replayed indirect draw reads the arguments the culling pass wrote this frame).
  A non-zero `firstInstance` needs `indirect-first-instance` (requested by `GPUContext` when available); without it only batches at instance 0 qualify.
* `MeshletCuller.encode` takes `firstInstance`; `stats.meshlets` reports draws, meshlets tested and input triangles.
* Tests: `tests/meshlet-draws.test.ts` (eligibility, record -> object lookup, encode parameters, culler lifetime) and a GPU self-test that renders a sphere through the renderer with
  meshlets off and on, on the standard and the bundled path: identical images, partial triangle count read back from the indirect arguments.

## Deferred / known limitations
- Animated bounds are conservative padding (skin: 0.5 x extent; morph: sum of max displacements). Per-animation / joint bounds later.
- Morph delta arenas always hold position+normal+tangent per target (zeros if absent): 3x memory; optimize if profiling says so.
- Skinned meshes support 4 influences on the GPU (JOINTS_1/WEIGHTS_1 are parsed + kept in assets, not yet uploaded).
- Storage-buffer budget: the vertex stage binds 6 storage buffers (transforms, instances, joints, morph weights, one deform arena for skin + morph deltas, one material buffer holding records + custom parameters); the busiest compute pass (GPU culling) binds 8. The engine runs within WebGPU's default limit of 8 per stage (verified by requesting exactly 8).
- No 2D blend trees yet (plan: "later"); 1D trees nest, so 2D locomotion can be composed from them.
- Motion matching inertializes translation/rotation only (not scale/morph); root velocity is not smoothed at a switch.
- Animation graph demo: `/?scene=animgraph` (state machine with trigger / exit-time / crossfades, 1D blend tree, masked layers, speed parameter); IK and motion matching still have no demo (covered by unit tests).
- Particles: no GPU sorting (alpha particles can mis-order; use additive or accept), no soft particles (needs scene depth), no collisions.
- Ribbons: trail ring holds `pointsPerRibbon` points (older points are overwritten); texture u uses accumulated length.
- Dev note: stepping `window.__r.app.onFrame(dt)` in a loop advances time deterministically even when rAF is paused.
- glTF: TEXCOORD_1+, COLOR_0 and KHR_texture_transform are not supported (the transform matters for gltfpack output whose UVs are quantised past [0, 1]).
- Compressed assets: Draco, meshopt and Basis decoding runs on the main thread (no worker); KTX2 arrays, cube maps, 3D textures and UASTC HDR are rejected; KTX2 textures with a single mip level stay unmipped unless they transcode to RGBA8; the vendored wasm decoders need `unsafe-eval` (glue script) and `wasm-unsafe-eval` in a Content-Security-Policy.
- Material has ONE sampler (last texture's sampler wins); per-texture samplers would need bindless-style tricks.
- Shadows: at most 8 spot and 2 point shadow casters (config), casters are culled with a linear per-layer test, spot shadows use a fixed bias set. Cascades blend over the last 10% of each range (and fade out past the last); area lights shadow as a cube map from their centre (shares the 2 point/area budget; penumbra width grows with light size, not a true area-light penumbra).
- Area lights: LTC fit tail over-estimates (specular up to 1.35x the quadrature reference in far tails); shadows are an approximation from the centre point.
- Fog: no temporal reprojection / noise (froxel grid is 8 px x 48 slices), area lights do not scatter; transparent objects and particles are not fogged.
- GPU culling: spheres only; transparent batches stay on the CPU path; the in-frame `hiz` mode cannot be combined with GPU LOD (depth mismatch), use `hiz2`; GPU LOD has no hysteresis.
- Meshlet culling (`renderer.meshlets.enable(meshId)`) covers single-instance, static, back-face-culled, non-mirrored batches of the main view with GPU instance culling off, one batch per mesh per frame; instanced batches, the prepass, shadows, the aux pass and off-screen views draw whole meshes. No per-meshlet occlusion test; `stats.meshlets` counts draws / input triangles, not what the GPU kept (no readback). LOD generation keeps the original normals / UVs of the surviving vertices.
- Texture streaming keeps the full CPU mip chain in memory (a real streamer would read mips from disk / network on demand).
- Custom materials are not pre-warmed (validated on first use through error scopes).
- Dev note: the browser pane pauses `requestAnimationFrame` when the tab is not fronted; call `tabs_select` before reading the HUD.
