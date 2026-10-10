# Code review and performance report

Review date: 2026-10-10. Baseline: Git commit `2197189`.

The review covered the application/frame lifecycle, ECS and transform hierarchy, asset decoding, GPU managers, render extraction/queues/graph/views, visibility/picking, streaming, workers, and their tests/configuration. The existing animation, material, lighting, post-processing, particle and shader code was checked through source inspection and the existing CPU/GPU validation suites. The domain folder structure was retained; the refactor removes duplicated ownership and algorithms rather than moving every file or changing public names. This is a tested maintenance pass, not a proof that every input, adapter, device-loss scenario or shader combination is correct.

## Fixes and restructuring

| Area | Finding and resulting behavior |
| --- | --- |
| Frame lifetime | Stop/restart inside a frame could create multiple RAF chains. A loop generation prevents stale callbacks from scheduling another chain; a throwing callback stops its generation and allows a later restart. Engine time comes from the RAF timestamp. |
| Entities and bit sets | Invalid numeric handles/indices could alias live entries after bitwise conversion. Reads reject invalid identities; invalid bit writes/capacities throw. Empty bit intersections enumerate nothing. |
| Hierarchy | Resetting an existing transform left stale links. Reset now detaches and orphans children consistently. Missing parents/children and invalid indices are rejected; missing traversal roots return empty results/-1 instead of looping. World-pose reparenting rejects singular parents before mutation. |
| Render extraction | Changing an object's static flag without changing membership left the BVH stale. Static membership changes now advance the structure version. |
| Picking/BVH | Cached bounds were padded twice. Cached world bounds are now used directly. BVH traversal keeps the new backing arrays after stack growth; leaf sizes are validated. |
| Render graph | Initial external read-modify-write passes could form false cycles; a failed compilation or graph mutation could retain an old execution plan. Dependency/liveness/order phases are separate, invalidation is explicit, and deep dependency traversal is iterative. |
| Render views | Queue, batch, frame and pipeline scratch were swapped individually. `RenderDrawState` groups per-view state and pipeline invalidation in one owner. |
| Workers | Synchronous postMessage failure poisoned a slot; termination/fatal load errors could leave promises waiting. Failures now settle jobs and release slots/pools, and future requests reject after close. Partial construction cleans up workers. |
| Scheduling | Both queues repeatedly scanned/spliced arrays. One indexed heap handles priority ordering, FIFO ties and cancellation. Cancelling an already running task cannot hide its failure. |
| Streaming | Disabled culling's null slots could crash; material references/callback ownership could become stale. Current references and registered textures are checked and callback detachment is ownership-aware. Residency is calculated once and updated as downgrades are applied. |
| Texture loading/mips | Failed promises blocked retry; bitmaps/textures leaked on failure. Cache entries are retryable and cleanup runs on error. CPU mip generation is a pure module, validates input dimensions/length, and avoids temporary per-channel arrays. |
| glTF | Dense/sparse matrix padding was ignored; sparse integer reads applied normalization inconsistently. Shared layout decoding handles padded matrix columns and missing final padding; offsets, strides, sparse count/type/order/ranges are checked. Shared matrix decomposition avoids zero-scale NaNs and duplicate code. |
| GPU allocation | Invalid sizes could corrupt arena usage or cause unbounded growth. Arena/ring allocators validate dimensions and enforce device limits. Texture accounting includes multisampling and 3D mip depth. Concurrent async pipeline priming shares work and failed creation is retryable. |
| Tooling/package | The lockfile is committed, supported Node versions are declared, and `npm run check` runs the complete CPU/build/package validation path. Library tree shaking stripped deep-import exports and omitted unreferenced modules: all runtime modules are now entries with declarations. An import-time WebGPU global access is deferred until allocation. Node type definitions were added to check the library build config. A repeatable maintenance benchmark and architecture/extension guide were added. |

The glTF matrix/sparse behavior follows the [Khronos glTF 2.0 accessor specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#accessors), including four-byte matrix column alignment and strictly increasing sparse indices.

## Validation

- Baseline: 43 CPU test files, 548 tests passing.
- Final: 47 CPU test files, 593 tests passing; 45 added regressions/behavior checks.
- TypeScript checking, production demo build and ES-module library/declaration build pass.
- Browser GPU self-tests: 34/34 pass, with no uncaptured GPU validation errors.
- Render-to-texture demo smoke check: HUD reports zero GPU errors and zero pipelines created after freeze; captured warning/error logs are empty.
- Browser draw-submission and GPU culling benchmark suites complete with empty warning/error logs.
- Public/deep package import checks pass and all 177 runtime/declaration pairs are present. Packaging dry run passes; dependency audit reports zero known vulnerabilities.

New tests exercise RAF lifetime, invalid identities/capacities, hierarchy traversal and singular reparenting, worker failure cleanup and cancellation, graph invalidation and deep traversal, static BVH changes, picking bounds, streaming callback/reference changes, texture failure retry/cleanup, padded/sparse glTF accessors, and GPU allocation/cache/accounting behavior. CPU resource tests use fake GPU objects; the browser suite supplies actual shader execution and validation coverage.

## Benchmark method

Environment: Windows laptop, Intel Core 7 240H, Node.js 24.18.0; RTX 4050 Laptop and Intel integrated graphics are present. The browser adapter identity was not recorded, so GPU results should be treated as measurements of this browser session rather than attributed to a particular adapter.

CPU harness: 20 warm-up operations, then repeated operations measured with `performance.now`; general workloads run approximately 400 ms, maintenance workloads 200 ms. Maintenance results below use the median of three final runs after closing animated benchmark/demo tabs. The original queue was loaded from baseline source in an isolated temporary comparison module, then removed. Baseline timings are single runs, so ratios are approximate and include warm-up, GC, timer and machine power-state variation. These are microbenchmarks, not end-to-end game frame-rate claims. Values below timer precision are not useful performance evidence.

### Before/after maintenance workloads

| Workload (milliseconds/operation) | Baseline | Final median | Interpretation |
| --- | ---: | ---: | --- |
| Enqueue + drain 100 empty tasks | 0.0420 | 0.0534 | Heap bookkeeping costs more for small queues |
| Enqueue + drain 1,000 empty tasks | 1.0528 | 0.6523 | About 1.6x faster |
| Enqueue + drain 10,000 empty tasks | 124.2124 | 8.3802 | About 14.8x faster; avoids quadratic scans |
| Plan 2,000 unseen resident textures | 63.1806 | 0.0954 | About 662x faster in this worst-case policy workload |
| Generate 1024x1024 linear RGBA8 mips | 5.5743 | 4.0557 | About 1.37x faster |
| Generate 1024x1024 sRGB RGBA8 mips | 21.1539 | 20.0281 | Small difference; transfer-function work still dominates |

Streaming benchmark details: each texture is 1024x1024 with 11 mips, initially fully resident, not touched this frame, and wants a downgrade. Large memory budget and downgrade hysteresis keep residency fixed throughout measurement. Previously each downgrade candidate recalculated the total resident bytes across all textures/mips. The final implementation retains the same decision behavior while computing the total once. Real workloads that do not reach this path will see smaller gains.

### Existing algorithm comparisons after changes

These compare strategies in the final code; they are not before/after refactor speedups.

| CPU workload | Measurement |
| --- | --- |
| Update 100 dirty transforms among 10,000 | 0.0093 ms vs 0.5654 ms full recomputation (61x) |
| Frustum cull 100,000 objects | BVH 0.0203 ms; linear spheres 1.2987 ms; linear AABBs 1.8149 ms |
| Build BVH for 100,000 objects | 84.0 ms; amortize by retaining static structure |
| Motion search, 6,000 / 30,000 / 120,000 poses | 0.0709 / 0.3059 / 1.1917 ms |
| 200 animators, 64 joints each | 1.962 ms animation + transforms + skeleton update; 600 KB joint data/frame |
| 1,000 animators, 64 joints each | 10.405 ms total; 3,000 KB joint data/frame |
| 1,000 animation controllers, 64 joints each | 12.569 ms total |
| 200 paused animators, 64 joints each | 0.030 ms; no transform/skeleton work or joint uploads |

Browser draw benchmark: 10,000 objects, eight materials and two meshes, 60 measured frames per mode. CPU is renderer preparation/encoding time; submit-to-done includes GPU execution, queue latency and scheduling.

| Mode | Draws | CPU/frame | Submit-to-done |
| --- | ---: | ---: | ---: |
| Unsorted | 10,000 | 5.005 ms | 16.163 ms |
| Sorted | 10,000 | 1.340 ms | 7.278 ms |
| Instanced | 16 | 0.907 ms | 4.240 ms |

GPU visibility benchmark: 2,000 spheres, CPU culling disabled, eight warm-up and 30 measured frames per mode. GPU pass timing is from timestamp queries; submit-to-done is a separate latency measurement.

| Scene / mode | GPU passes | Submit-to-done | CPU |
| --- | ---: | ---: | ---: |
| Mostly visible / off | 2.71 ms | 4.94 ms | 0.35 ms |
| Mostly visible / frustum | 2.68 ms | 5.16 ms | 0.31 ms |
| Mostly visible / Hi-Z two-phase | 2.88 ms | 5.43 ms | 0.37 ms |
| Behind wall / off | 2.91 ms | 5.06 ms | 0.27 ms |
| Behind wall / frustum | 2.87 ms | 5.12 ms | 0.30 ms |
| Behind wall / Hi-Z two-phase | 0.63 ms | 3.71 ms | 0.32 ms |

## Further performance improvements

1. Keep the existing instanced mode for repeated compatible meshes/materials. The draw benchmark shows it cuts encoding and submission overhead substantially; sorting alone also helps mixed materials.
2. Choose culling based on the scene. Keep static BVHs persistent, update dynamic bounds, and avoid rebuilding static structures every frame. Use Hi-Z when occlusion is substantial; its extra passes can cost more when objects are mostly visible.
3. Use animation LOD and update cadence for distant crowds. The 1,000-character tests spend roughly 10-13 ms in animation/transforms/skeletons, with approximately 3 MB of joint data per active frame. Paused/unchanged poses already skip work. Measure pose sharing or reduced update frequency before adding more complexity.
4. Prefer GPU mip generation for GPU-bound texture workflows, or schedule CPU mip work outside the frame budget. A 1024x1024 sRGB chain still takes around 20 ms on this CPU and can block a frame. Keep CPU generation for tests, CPU-resident streaming data and fallback/off-thread workflows.
5. Reuse warmed pipelines and precreated resources. Concurrent priming now deduplicates, but late pipeline creation remains expensive. The existing HUD freeze diagnostics should be part of feature smoke checks.
6. Profile complete representative game scenes before changing other algorithms. The new heap improves large backlogs but is slower at 100 tasks; shader, allocation and scheduling changes should be evaluated for the workload they actually serve.

## Reproduce

```sh
npm ci
npm run check
npm run bench
npm run bench:anim
npm run bench:maintenance
npm run dev
```

With the dev server running, open `/selftest.html`, `/bench.html` (draw suite), `/bench.html?suite=cull&n=2000`, and `/?scene=rtt`. Close animated tabs before CPU measurements, repeat runs, record browser/adapter/power state, and compare equivalent scene settings. For baseline comparisons use a separate checkout of `2197189`; do not overwrite the revised working tree.

## Limits of this verification

One local browser/device session does not establish support across all WebGPU implementations. CPU tests do not replace shader readbacks. Full device-loss/recovery, every asset extension, every demo setting and long-running memory/leak behavior were not exhaustively exercised. No visual redesign, shader-algorithm rewrite, dependency upgrade or public API renaming was included. The existing feature/system/material extension hooks remain the preferred way to add behavior.
