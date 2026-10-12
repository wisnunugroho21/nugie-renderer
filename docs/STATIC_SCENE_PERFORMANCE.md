# Static-scene optimization against Three.js WebGPURenderer

This records the first CPU optimization phase. See [the completion-latency follow-up](STATIC_SCENE_LATENCY.md) for the newer default path and matched sequential/interleaved results.

The renderer now beats tuned Three.js on CPU render preparation in this test. It does **not yet beat Three.js on render-to-GPU-idle latency**. At 10,000 objects, project CPU median fell from 0.895 ms to 0.045 ms (about 20x), while completion latency fell from 2.395 ms to 1.125 ms (53%). The remaining completion gap changes between runs; it is not a demonstrated overall win.

## Recorded results

Apple M1, 8 CPU threads, 8 GB RAM, macOS Darwin 27.0.0, headed Google Chrome 153.0.8010.53, Three.js r186 / npm 0.186.1. WebGPU reports `apple / metal-3`, non-fallback adapter; WebGL's unmasked renderer explicitly names Apple M1. Hardware, browser, limits, raw samples and last-frame diagnostics are stored in every JSON result.

Times are milliseconds; each cell is median / p95. The baseline and optimized runs were collected separately on the same machine and harness. Use the contemporaneous Three.js row to assess each run.

| Objects | Renderer | CPU render call | Render start to GPU idle |
|---:|---|---:|---:|
| 1,000 | Project before | 0.180 / 0.535 | 1.015 / 7.550 |
| 1,000 | Three.js in baseline run | 0.190 / 0.670 | 0.795 / 1.745 |
| 1,000 | Project optimized | 0.040 / 0.070 | 0.760 / 0.880 |
| 1,000 | Three.js in optimized run | 0.115 / 0.170 | 0.635 / 0.895 |
| 10,000 | Project before | 0.895 / 1.045 | 2.395 / 2.740 |
| 10,000 | Three.js in baseline run | 0.130 / 0.295 | 1.060 / 4.745 |
| 10,000 | Project optimized | 0.045 / 0.130 | 1.125 / 1.635 |
| 10,000 | Three.js in optimized run | 0.115 / 0.230 | 1.100 / 1.545 |
| 50,000 | Project optimized | 0.070 / 0.325 | 2.585 / 3.735 |
| 50,000 | Three.js | 0.210 / 0.400 | 2.380 / 2.930 |

Sources: [baseline](../benchmarks/results/static-baseline.json), [optimized](../benchmarks/results/static-final.json), [50,000 objects](../benchmarks/results/static-large.json). Intermediate retained-only, shader and uniform runs are also preserved. At 10,000 objects their project completion medians ranged from 1.15 to 1.23 ms, versus Three.js 1.07 to 1.11 ms. The CPU advantage repeated across runs; the project completion median remained higher.

A current-code A/B run with only retained draw preparation disabled measured 0.630 ms CPU and 1.870 ms completion at 10k, versus 0.045 / 1.125 ms with retention enabled ([cache-off raw results](../benchmarks/results/static-cache-off.json)). Transform revision gating, uniform gating and shader specialization remained enabled in this A/B run.

## Matched workload and measurement

- Same seeded transforms, geometry/index arrays, 8 materials and 2 mesh types, one directional light, metalness 0, matching roughness and linear colors. Both engines use instancing: 16 geometry draws. Three.js adds a fullscreen output draw/triangle.
- Same camera, 960 × 540 actual pixels, pixel ratio 1, no MSAA, culling, shadows, IBL, ambient light, textures or fog. Three.js uses frozen world matrices, disabled sorting and disabled frustum culling. Its custom tone curve matches the project's Narkowicz ACES fit and sRGB output.
- Production build; both GPU timestamp profilers disabled. Cross-origin isolation enables finer browser timers. Three.js remains on its WebGPU backend.
- 30 warm-up frames, then 3 rounds × 120 measured frames per contender. Each round creates a fresh device; contender order rotates. Results pool all 360 samples. GPU work completes before the next measured render starts.
- CPU measures `render()` including command encoding/submission. Completion measures from the start of `render()` through `onSubmittedWorkDone()`. This includes CPU, browser scheduling and queue overhead; it is **not isolated GPU execution time or FPS**. Scene creation, initial uploads, compilation, ECS extraction, simulation and culling are outside timing. Repeated rendering uses the same extracted snapshot and time 0.
- Image readback happens before timing. Three/project RGB mean absolute error is 0.039, 0.062 and 0.087 out of 255 for 1k/10k/50k, with only 0.021%, 0.027% and 0.046% of pixels differing by more than 16. The saved 10k project images before/after are pixel-identical ([parity check](../benchmarks/results/image-parity.json)).

## Implemented improvements

1. **Retain draw preparation for stable snapshots.** Extraction now versions draw metadata and transforms. After stability is established, the renderer reuses sorted queues, batches, packed instance records and state-switch counts. Dependency checks scale with batches rather than objects. Camera position/far, material queue/features/pipeline/failure, mesh layout/deformation, membership and transform changes invalidate reuse.
2. **Keep static instance records resident across the GPU ring.** Each buffer generation gets populated once; unchanged main-view records are no longer copied or uploaded each frame. Features can append dynamic data, and growth repopulates the retained prefix safely. The 10k baseline diagnostics recorded 1,120,000 transform+instance bytes per frame; optimized diagnostics record zero. That baseline repeats a snapshot whose `changedSlots` still lists its initial transforms; normal ECS extraction already clears this list on unchanged frames.
3. **Avoid uploading a transform revision twice.** The GPU mirror tracks world identity and successful revision. New snapshots are fully initialized; failed writes can retry. This also fixes the repeated initial-transform uploads above.
4. **Skip identical frame/scene uniforms.** Byte comparisons avoid redundant writes; changes in camera, time, output/transmission flags, lighting, environment or fog still upload. Off-screen scene uniforms invalidate residency so the main view is restored.
5. **Specialize absent material maps.** Base color, metallic/roughness, occlusion and emissive map presence selects compile-time variants. Missing maps use the original white fallback values without texture reads. Attaching/removing maps updates the variant. This is a reduction in shader work, but these runs did not demonstrate a separate completion-time benefit from it or uniform gating.

Enabled by default through `renderer.cacheDraws`. Set it to `false` for A/B profiling. `renderer.stats.drawPreparationReused` reports reuse. LOD selection, explicit visibility slot lists, GPU culling, individual/unsorted batching and unversioned manually built worlds use ordinary preparation. Direct edits to an extracted `RenderWorld` must call `rw.invalidate()`; ECS-managed changes are tracked automatically. Moving scenes wait until stable before retaining, to avoid an additional instance-record copy every frame.

## Reproduce

```sh
npm exec --yes --package=playwright -- node scripts/run-static-benchmark.mjs repeat
npm exec --yes --package=playwright -- node scripts/run-static-benchmark.mjs large-repeat '&n=50000'
npm exec --yes --package=playwright -- node scripts/run-static-benchmark.mjs cache-disabled '&cache=0'
```

The runner builds production assets, starts an isolated preview server, launches installed headed Chrome, rejects missing contenders/image mismatches/GPU validation errors, saves JSON and image snapshots, then closes its browser/server. Set `BENCH_CHROME` to another Chrome executable or `BENCH_PORT` to another local port. Results are written to `benchmarks/results/`. Individual browser runs can use `/bench-three.html?scenario=objects&only=optimized&frames=120&rounds=3`.

Validation: TypeScript checks, all 608 unit tests, production benchmark builds, library build and package import verification passed. New tests cover ring residency/growth, cache invalidation and fallbacks, extraction revisions, transform retries, texture variant changes, uniform suppression and off-screen restoration.

## Remaining work to beat completion latency

The CPU preparation bottleneck is largely removed in this workload. At 50k, completion still scales to 2.585 ms despite a 0.070 ms render call. The next experiment should use a separate GPU timestamp run to distinguish vertex, fragment and browser/queue costs. Candidate changes include a rigid-instance vertex attribute path (currently the vertex shader reads an instance record and then a transform from storage), a compact vertex stream for map-free materials, and precomputed normal transforms. These are hypotheses, not measured wins. Preserve general nonuniform-scale/shear correctness and compare matching image output before accepting them. Do not disable lighting, reduce geometry/resolution or weaken Three.js batching to claim an overall lead.
