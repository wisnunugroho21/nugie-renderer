# Completion latency follow-up

The new default path beats tuned Three.js `WebGPURenderer` in the interleaved 10k and 50k static-scene tests on this Apple M1. The lead is workload/method dependent: long sequential blocks still lose at 50k, and the 1k sequential median is slightly higher. These results establish a measured lead for the stated tests, not a universal renderer ranking.

## Matched interleaved results

Five rounds × 300 frames per contender (1,500 samples), 30 warm-up frames per device. All three devices remain live; each frame rotates contender order and awaits GPU idle before the next sample. This reduces the bias from measuring one contender for a long block while clocks and browser scheduling change. Context switching adds overhead, so these absolute times should not be compared directly with sequential results.

Milliseconds, median / p95. CPU is the render call; completion is render start through `onSubmittedWorkDone()`.

| Objects | Contender | CPU | Completion |
|---:|---|---:|---:|
| 10,000 | Project, new default | 0.085 / 0.230 | **1.425 / 1.935** |
| 10,000 | Project, retained general shader | 0.085 / 0.230 | 1.715 / 2.275 |
| 10,000 | Three.js, tuned InstancedMesh | 0.270 / 0.620 | 1.570 / 2.170 |
| 50,000 | Project, new default | 0.250 / 0.370 | **4.210 / 4.960** |
| 50,000 | Project, retained general shader | 0.260 / 0.380 | 4.790 / 5.590 |
| 50,000 | Three.js, tuned InstancedMesh | 0.710 / 1.030 | 4.390 / 5.120 |

Project completion median is **9.2% lower at 10k** and **4.1% lower at 50k** than Three.js. Compared with the project's retained general shader, it is 16.9% and 12.1% lower. Raw samples, settings, hardware, source commit/hash and active-path counters are in [10k results](../benchmarks/results/static-latency-interleaved.json) and [50k results](../benchmarks/results/static-latency-interleaved-large.json).

## Sequential cross-checks and limits

The existing method measures a whole block for one device, recreates devices each round, and rotates contender order. Five rounds × 300 frames in these runs:

| Run | Objects | Project completion median / p95 | Three.js completion median / p95 |
|---|---:|---:|---:|
| [Same-run A/B](../benchmarks/results/static-latency-ab.json) | 10k | 1.165 / 1.520 | 1.250 / 1.460 |
| [Independent confirmation](../benchmarks/results/static-latency-confirm.json) | 10k | 1.170 / 1.465 | 1.270 / 1.460 |
| [Two-size run](../benchmarks/results/static-latency-final.json) | 1k | 0.630 / 0.790 | 0.605 / 0.825 |
| Same two-size run | 10k | 1.255 / 1.525 | 1.280 / 1.505 |
| [Large sequential run](../benchmarks/results/static-uniform-material-large.json) | 50k | 3.050 / 4.670 | 2.615 / 4.345 |

The A/B retained general shader measured 1.205 / 2.095 ms. The 10k median lead repeated, but the sequential p95 did not beat Three.js in every run. The large sequential test remains a loss. All experiment results are preserved, including unsuccessful packed-instance and intermediate binding/normal variants. Absolute latency varies materially between runs and measurement modes.

A [separate timestamp-query run](../benchmarks/results/static-latency-profile.json) recorded smoothed main-pass estimates of 0.617 ms for the new path and 0.552 ms for the general path; an [earlier run](../benchmarks/results/static-gpu-profile-before.json) recorded 0.921 ms. These are asynchronous, quantized last-frame estimates collected in separate blocks, not pooled pass-time statistics. They do not establish an isolated GPU-execution win. The demonstrated result is end-to-end completion latency, including command processing and browser/queue overhead. Profiling was disabled for the main comparisons.

## What changed

- **A base PBR directional-light variant.** `fs_retained_directional` uses the same GGX distribution, correlated Smith visibility, Schlick Fresnel, diffuse term, metallic/roughness clamping, hemisphere ambient, emissive contribution, tone mapping and sRGB encoding. The renderer selects it only for retained, undeformed, map-free base PBR draws with exclusively directional lights and no active shadows, IBL, fog, clusters or depth prepass. Other scenes use the general shader. Scene eligibility is checked every frame.
- **Only necessary bindings.** This variant binds the frame uniform, scene uniform, lights, one material uniform, transforms and instance records. It excludes unused textures, samplers, skin/morph buffers and scene-effect resources from its pipeline layouts. Each material has a lazy 64-byte uniform that uploads only when its record revision changes. Scalar material changes have their own revision; texture-binding versions alone are insufficient.
- **Compact geometry.** A lazy GPU compute pass derives a 24-byte position/normal stream from the original 48-byte vertices. Vertex order, indices and triangle topology stay identical. It rebuilds after vertex writes or arena growth, using no additional CPU geometry copy. It costs 24 bytes per vertex in GPU memory once enabled for a scene.
- **Exact uniform-normal specialization.** Retained transforms are checked once per revision for exactly equal-length, orthogonal columns with positive determinant. Eligible transforms use the model's 3×3 matrix for normal direction. Shear, reflection, nonuniform scale and even a tiny nonuniform difference retain the cofactor path. No tolerance-based approximation is used.
- **Retained render bundles.** Geometry commands are cached separately for each resident GPU instance-buffer slot. Resource identities, pipelines, geometry ranges, draw counts and target formats invalidate commands when necessary. Camera/light/material contents can update inside the same buffers. Cache size is bounded and draw/instance/triangle statistics are preserved. `renderer.warmup()` primes the enabled variants before steady-state rendering; tests verify no new pipeline creation after freeze. Feature draws still run every frame.

`renderer.retainedLighting` and `renderer.retainedBundles` default to `true`. The original `cacheDraws` eligibility restrictions still apply. `renderer.stats.retainedLightingDraws` and `retainedBundleDraws` expose use of these paths.

An optional `renderer.retainedVertex = true` path packs model/cofactor matrices into instance vertex attributes. It remains **off by default** because its extra 104 bytes per object and vertex-fetch behavior did not establish an advantage for large M1 scenes. The selected default keeps storage-based transforms. `retainedVertexDraws` reports this optional path.

## Visual settings and verification

Same Apple M1 / `apple / metal-3` non-fallback adapter, 8 GB memory, Chrome 153.0.8010.53, Three.js r186, production builds. Same seeded scene and geometry, camera, 960 × 540 pixels, pixel ratio 1, no MSAA/culling/shadows/IBL/fog/textures, and matched Narkowicz ACES plus sRGB output. Both engines use 16 instanced geometry draws; Three.js has one extra fullscreen output draw and triangle. Three.js retains its frozen matrices, disabled sorting and disabled frustum culling.

The project's saved 10k frames remain pixel-identical to the earlier implementation, including the A/B general shader ([image checks](../benchmarks/results/latency-image-parity.json)). Three.js RGB mean absolute error is 0.062/255 at 10k and 0.087/255 at 50k. Initialization, compilation, initial uploads, extraction and simulation are outside measured render time.

Validation: TypeScript checks, **613 unit tests**, **36 real GPU self-tests** ([results](../benchmarks/results/selftest-latency-warmup.json)), production benchmark builds, library build and package import verification passed. GPU tests compare general/optimized images with nonuniform scale, shear, reflection, uniform scaling, point-light/fog/map fallback, camera/material/transform changes and buffer growth; they also assert actual path selection and draw counts. Compacted GPU vertices match source positions/normals after writes and growth. Material uniform tests cover update suppression and failed-write retries. No uncaptured GPU validation errors were recorded.

## Reproduce

```sh
# Three-way A/B, alternating warmed devices each frame
npm exec --yes --package=playwright -- node scripts/run-static-benchmark.mjs interleaved-repeat '&n=10000&ab=1&interleave=1&frames=300&rounds=5'
npm exec --yes --package=playwright -- node scripts/run-static-benchmark.mjs interleaved-large-repeat '&n=50000&ab=1&interleave=1&frames=300&rounds=5'

# Original sequential mode, plus real GPU correctness suite
npm exec --yes --package=playwright -- node scripts/run-static-benchmark.mjs sequential-repeat '&n=10000&ab=1&frames=300&rounds=5'
npm exec --yes --package=playwright -- node scripts/run-static-benchmark.mjs gpu-repeat --selftest
```

`&lighting=0` disables the new lighting path; `&bundles=0` disables bundles; `&vertex=1` enables the optional packed vertex path; `&profile=1` enables project timestamp queries for diagnosis. The runner writes JSON and snapshots under `benchmarks/results/`, records source identity, rejects image mismatches/missing contenders/GPU validation errors, and closes its browser/server. Its query overrides replace defaults instead of creating duplicate parameters.
