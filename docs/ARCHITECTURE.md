# Architecture and extension guide

The project keeps simulation data, render preparation, GPU resource ownership and shader implementation in separate modules. The public entry point is `src/index.ts`; deep imports are supported for advanced integrations. Keep the existing domain folders when adding features so users can find an implementation without following a large barrel of imports.

## Module responsibilities

| Folder | Responsibility | Extension point |
| --- | --- | --- |
| `app` | Application lifetime, frame ordering, high-level scene helpers | `Engine.addSystem`, application callbacks |
| `core`, `math` | GPU-independent containers and numeric operations | Pure algorithms with deterministic unit tests |
| `ecs/components` | Structure-of-arrays component storage indexed by entity index | Extend `ComponentStore`; define reset and growth behavior |
| `ecs/systems`, `animation` | Simulation, transforms, bounds, animation and skeletons | Add a system; specify which data it reads and changes |
| `assets` | Image/model decoding and CPU asset preparation | Decode independently of rendering, then upload through managers |
| `workers` | Off-thread geometry work and frame-budgeted main-thread tasks | Worker messages and `FrameBudgetQueue` tasks |
| `rendering` | Extracted render data, queues, batches, views and pass orchestration | `RenderFeature`, materials, `RenderView`, `FullscreenEffect` |
| `gpu` | Buffer/texture allocation, caches, limits and GPU accounting | Resource managers with explicit ownership and destruction |
| `visibility`, `picking` | Frustum/BVH/LOD decisions and CPU intersection queries | Operate on bounds and extracted data |
| `streaming` | Texture residency decisions and uploads | Pure `StreamPolicy` plus a `StreamingDriver` adapter |
| `particles`, `shaders` | GPU simulations and WGSL kernels | Feature adapters and GPU reference self-tests |
| `demo`, `game`, `selftest`, `bench` | Examples, GPU validation and browser performance workloads | Add a focused example or validation workload |

## Frame flow

`Engine.frame(dt, time)` runs custom `beforeAnimation` systems, animation, transforms, skeletons, bounds, particle/ribbon preparation, and custom `afterTransforms` systems. It then extracts a `RenderWorld`, performs CPU visibility and LOD selection, and calls the renderer.

Gameplay changes the `World`; render preparation consumes the flat `RenderWorld`. Changes to transforms must use the store's setters or mark them dirty. A system that writes transforms belongs before the transform update; `afterTransforms` is appropriate for reading final positions. Entity handles contain generations; component arrays and scene helper return values use entity indices. Check lifetime through `World.isAlive` when retaining a handle across destruction/reuse.

The renderer uploads changed data, creates queues, sorts and batches draws, constructs the render graph, records passes, and submits. `RenderDrawState` owns the queue builder, queue storage, batches, pipeline lookups and frame scratch for one view. Offscreen views swap this object together rather than individually replacing several related arrays. Target format/sample-count changes clear its pipeline lookup cache.

`RenderGraph` compilation is split into hazard discovery, iterative liveness traversal, and stable topological ordering. Passes declare logical `reads` and `writes`; `sideEffect` retains outputs such as the backbuffer. Declare every dependency. After adding/resetting passes, compile before execute. A failed compilation invalidates the previous executable order. A first pass that reads and writes the same resource consumes its existing external contents; ordinary forward readers depend on later producers.

## Adding features

1. Put gameplay or simulation in a component/system and register it with `engine.addSystem(system, phase)`. Store the data in its owning subsystem rather than extending `Engine` with feature-specific state.
2. Put rendering integrations behind `RenderFeature`, registered with `renderer.addFeature(feature)`. Use `prepare` for uploads, `addPasses` for compute/render graph work, `drawMain` for main-pass draws, `addPostPasses` for HDR effects, and `endFrame` for scratch cleanup. Declare `produces` for resources that the main pass must consume. Feature frame objects are reused: do not retain them.
3. For pixel effects, prefer `FullscreenEffect` and `addPostPasses`. For material changes, use `PBRExtension` or a custom material; preserve the existing bind-group and vertex-layout contracts. Implement `retarget` when pipelines depend on the target's format or sample count.
4. Keep decoding, policy and geometry algorithms independent of the GPU where practical. `assets/MipChain.ts` is an example: it can be tested and benchmarked without a WebGPU device. Its old export through `TextureStreamer` remains available.
5. Reuse `core/PriorityQueue` for priority scheduling. It supports unique entries and logarithmic push, pop and removal; a comparator must define the ordering. Worker/frame queues explicitly include submission sequence for FIFO ties.
6. Add behavior tests for lifecycle, error paths and invariants. Use the fake GPU for resource ownership and accounting; use `/selftest.html` for actual WGSL execution, output/readback comparisons and WebGPU validation.

## Ownership and lifecycle rules

- A manager that creates a GPU resource owns its release. Buffer replacement must respect device limits and preserve existing data. Validate allocation sizes before changing usage counters.
- Texture decoding owns its bitmap until upload finishes; close it even when allocation or upload fails. Failed cache entries must allow retry. Successful concurrent requests should share work.
- A worker pool has one job per slot. Message-level errors reject the job; a fatal worker event closes the pool and settles all pending promises. `terminate` is idempotent. A failed/terminated shared geometry pool may be recreated.
- Streaming decisions use current material texture references; material replacement must not leave stale associations. A callback adapter removes only a callback it still owns.
- Static renderable membership changes invalidate the BVH structure even if entity membership did not change. Cached world bounds already include bounds padding; consumers must not pad them again.
- Hierarchy mutation rejects missing transforms and cycles. Preserving a world pose under a singular parent throws before attachment; transform matrices must have been updated before world-space queries.

## Maintenance workflow

Use `npm ci` with the committed lockfile, then `npm run check` for type checking, CPU tests, demo build, library/declaration build and package verification. The library build treats every runtime source module as an entry so its deep-import exports survive tree shaking; demos, page entry points, self-tests and worker entry scripts are excluded. `npm run verify:package` checks public/deep imports and runtime/declaration pairs after a library build. Use `npm run bench`, `npm run bench:anim`, and `npm run bench:maintenance` for CPU workloads. With `npm run dev`, visit `/selftest.html` and browser benchmark suites before changing shader behavior or GPU pass ordering.

See [MAKING_A_GAME.md](MAKING_A_GAME.md) for end-user examples and [CODE_REVIEW.md](CODE_REVIEW.md) for the review findings, measurement method and current performance tradeoffs.
