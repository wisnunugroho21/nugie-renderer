# Implementation Progress

Source of truth: `IMPLEMENTATION_PLAN.md` (original lives in the Downloads folder). This file tracks status,
decisions and measured results. A phase is "done" only when its acceptance criteria + tests/benchmarks pass.

Run: `npm run dev` (app at `/`, scenes via `?scene=materials|gltf`, benchmarks at `/bench.html`) ·
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
| 15 | Texture pipeline (sRGB/linear, GPU mips, dedupe, async) | DONE - browser; KTX2/Basis deferred |
| 16 | Animation runtime (STEP/LINEAR/CUBICSPLINE, Animator, AnimationSystem) | DONE - tests |
| 17 | Skinning data (SkeletonAsset vs SkeletonInstance, JOINTS/WEIGHTS incl. _1) | DONE - tests |
| 18 | Skeleton updates (convention documented + tested) | DONE - tests |
| 19 | Shared JointMatrixBuffer (one buffer, sparse uploads) | DONE - tests, 1000 skeletons = 0 extra buffers |
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
| 30 | Shadows: cascaded directional (4 cascades, stable fit + texel snapping) and spot shadow maps, depth32float array, deformVertex depth pass (skin/morph), alpha-mask cutouts, 3x3 PCF, normal-offset bias | DONE (cascade blending and BVH culling of shadow casters deferred) - cascaded sun, spot and point-light (6-face) shadows; 5 math tests + browser verification (shadows only darken; GPU errors 0) |
| 31 | Render graph: passes declare reads/writes, stable topological order, culling of unused passes, cycle detection; the renderer builds its frame from it | DONE - 4 unit tests, used by every frame |
| 32 | GPU profiling: timestamp-query scopes (shadows, clusters, prepass, hiz, cull, main ...) resolved asynchronously through a staging ring, shown in the HUD | DONE - verified in browser |
| 33 | Depth prepass (opaque + alpha-masked, `@invariant` position, depth test `equal`) | DONE - pixel-identical to the single pass; dense-overdraw benchmark 1.4-1.7x |
| 34-38 | Hi-Z pyramid, GPU frustum + Hi-Z occlusion culling, compaction, indirect draws (`?gpucull=frustum\|hiz\|hiz2`) | DONE - Hi-Z pyramid exact vs CPU (self-test), images identical to CPU path, Benchmark G |
| 40 | Temporal visibility: two-phase occlusion culling (`hiz2`: draw last frame's visible set, build pyramid, test the rest) | DONE - Benchmark G: GPU pass time 26.5 ms -> 0.42 ms with 20k occluded spheres |
| 39 | GPU-driven LOD selection in the culling shader (batches of LOD-group meshes expand into one indirect draw per level; `?gpucull=frustum&gpulod=1`) | DONE - per-level counts identical to the CPU reference (60/448/319) and image identical; no hysteresis on the GPU path |
| 41 | Async work: `FrameBudgetQueue` (priority, per-frame time budget, cancellation, always progresses) | DONE - 2 unit tests |
| 42 | Texture streaming: CPU mip chains, per-texture resident mip range driven by on-screen coverage, memory + upload budgets, downgrade hysteresis, GPU-side mip copy on residency change (`/?scene=streaming`) | DONE - 7 policy tests + 2 mip-chain tests; demo: 533 MB of textures held in 22.7 MB |
| 43 | Web Workers: `WorkerPool` (priority, concurrency, transfers, errors) + geometry worker (LOD chains, meshlets); sync fallback in Node | DONE - 3 tests + browser (`?scene=lod&worker=1`, 25.6k-triangle chain: 329 ms blocking main-thread work moved off-thread) |
| 44 | Geometry optimisation: Forsyth vertex-cache reordering, fetch reordering, quadric edge-collapse simplification (boundary protected, flip rejection), automatic LOD chains (`/?scene=lod&auto=1`), meshlets with bounds + normal cones | DONE - 11 tests (ACMR 3.00 shuffled -> 0.68 optimised (row-major grid: 1.01), 32 ms for 20k triangles, silhouette error, meshlet coverage / cone culling safety); GPU meshlet culling deferred |
| 28C | Volumetric fog: froxel volume (8 px tiles x 48 exponential slices, rgba16f 3D), height-exponential density, directional + ranged lights (shadow-mapped, clustered), Henyey-Greenstein phase, ambient in-scatter; applied to meshes and sky with one lookup (`?fog=<density>`) | DONE - 2 GPU self-tests vs analytic transmittance / in-scatter (<= 3.5e-3) |
| 64 | Advanced optimisation: async pipeline warm-up (`renderer.warmup()` / `?warmup=1`: shared pipelines deduplicated, 220 material x variant jobs -> 12 compiles in ~0.6 s, no first-use hitch), bind-group cache keys unique per renderer / material manager (fixes stale resources when several renderers share one device), `@invariant` depth for prepass equality, GPU-driven culling / LOD / occlusion (phases 34-40), cluster + froxel work on the GPU | DONE - measured in Benchmarks B / C / G |

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

Run: `/bench.html?suite=passes`. Shadows cost ~3.6 ms, froxel fog ~0.8 ms and light assignment ~0.4 ms; the depth prepass saves ~1.5 ms of main-pass time but costs 1.7 ms here (no net gain without heavy overdraw).

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

## Deferred / known limitations
- Animated bounds are conservative padding (skin: 0.5 x extent; morph: sum of max displacements). Per-animation / joint bounds later.
- Morph delta arenas always hold position+normal+tangent per target (zeros if absent): 3x memory; optimize if profiling says so.
- Skinned meshes support 4 influences on the GPU (JOINTS_1/WEIGHTS_1 are parsed + kept in assets, not yet uploaded).
- Device must expose >= 10 vertex-stage storage buffers (engine requests up to 12; warns otherwise).
- No 2D blend trees yet (plan: "later"); 1D trees nest, so 2D locomotion can be composed from them.
- Motion matching inertializes translation/rotation only (not scale/morph); root velocity is not smoothed at a switch.
- No animation graph demo scene yet (all behaviour covered by unit tests + ECS integration tests).
- Particles: no GPU sorting (alpha particles can mis-order; use additive or accept), no soft particles (needs scene depth), no collisions.
- Ribbons: trail ring holds `pointsPerRibbon` points (older points are overwritten); texture u uses accumulated length.
- Dev note: stepping `window.__r.app.onFrame(dt)` in a loop advances time deterministically even when rAF is paused.
- KTX2 / Basis / BC / ETC2 / ASTC (Phase 15 "later"): textures are decoded PNG/JPEG via `createImageBitmap`.
- glTF: TEXCOORD_1+, COLOR_0, KHR_texture_transform, KHR_draco/meshopt are not supported (warned or rejected when required).
- Material has ONE sampler (last texture's sampler wins); per-texture samplers would need bindless-style tricks.
- Shadows: at most 8 spot and 2 point shadow casters (config), cascades are not blended, casters are culled with a linear per-layer test, spot shadows use a fixed bias set.
- Area lights: LTC fit tail over-estimates (specular up to 1.35x the quadrature reference in far tails); no shadows from area lights.
- Fog: no temporal reprojection / noise (froxel grid is 8 px x 48 slices), area lights do not scatter; transparent objects and particles are not fogged.
- GPU culling: spheres only; transparent batches stay on the CPU path; the in-frame `hiz` mode cannot be combined with GPU LOD (depth mismatch), use `hiz2`; GPU LOD has no hysteresis.
- Meshlets are built and cone-culled on the CPU only (no GPU meshlet pipeline); LOD generation keeps the original normals / UVs of the surviving vertices.
- Texture streaming keeps the full CPU mip chain in memory (a real streamer would read mips from disk / network on demand).
- Custom materials are not pre-warmed (validated on first use through error scopes).
- Dev note: the browser pane pauses `requestAnimationFrame` when the tab is not fronted; call `tabs_select` before reading the HUD.
