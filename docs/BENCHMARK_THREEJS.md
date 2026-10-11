# nugie-renderer vs Three.js `WebGPURenderer`

Identical-scene comparison, run with [`/bench-three.html`](../bench-three.html) (source: [`src/bench/compareThree.ts`](../src/bench/compareThree.ts)).
Reproduce with `npm run dev`, then open `/bench-three.html?scenario=objects` or `?scenario=lights`. The page prints the hardware, the
tables below, and offers the raw results as JSON.

The original broad comparison below is retained as a historical run. See [the static-scene optimization report](STATIC_SCENE_PERFORMANCE.md) for the current optimized comparison, raw measurements and reproduction command.

## Hardware and software (recorded by the page)

| | |
|---|---|
| GPU (WebGPU adapter) | vendor `apple`, architecture `metal-3`, fallback adapter: no (the browser masks the device name) |
| GPU (WebGL unmasked renderer) | ANGLE (Apple, ANGLE Metal Renderer: **Apple M1**) |
| CPU / memory | 8 threads, 8 GB (as reported by `deviceMemory`) |
| Browser | Chromium 152 inside the Claude desktop app, macOS |
| Display | 1440 x 900 @2x; the benchmark canvases are 960 x 540 at pixel ratio 1 |
| WebGPU limits | `maxStorageBuffersPerShaderStage` 10, `maxBufferSize` 4 GiB, `timestamp-query` and `subgroups` available |
| Three.js | r186 (`three/webgpu`, `WebGPURenderer`, `antialias: false`) |
| nugie-renderer | 0.2.0 |
| Measured | 2026-10-11 |

Both engines request the default adapter; each device's adapter is printed per row and was `apple / metal-3` for every contender.

## What is identical

* **Geometry**: Three.js geometries are built from the same vertex and index arrays as nugie's meshes (cube, 8x6 sphere, 24x12 sphere, plane).
* **Materials**: metallic-roughness PBR, same linear base colours and roughness, metalness 0, no textures; no ambient, IBL, fog or shadows.
* **Lights**: same positions, colours, directions and units. Both use radiometric units (directional = irradiance; point = I / d^2 with the
  `(1 - (d / range)^4)^2` window), so intensities are passed unchanged.
* **Camera**: same pose, 60 degree vertical FOV, near / far; 960 x 540, pixel ratio 1, no MSAA, no post chain, black clear colour.
* **Output transform**: nugie's direct path applies the Narkowicz ACES fit and the sRGB encode inside the material shader, so that exact curve
  is registered in Three.js as a custom tone mapping.
* **Static scene**: no transform updates and no culling (everything is in view) in either engine. Tuned Three.js variants freeze matrices,
  disable frustum culling and disable object sorting.

### Image check (matched visual settings)

Each contender's frame is read back and compared with the first contender (nugie). Results in this run:

| Scenario | Mean abs. error (0..255) | Pixels differing by > 16 |
|---|---|---|
| objects, 1000 and 10,000 | 0.04 and 0.06 | 0.02% and 0.03% |
| lights, 16 to 1024 | 0.08 to 0.15 | 0.01% to 0.07% |

A row is flagged `IMAGE MISMATCH` when the mean error exceeds 0.5. This check caught three real configuration errors while building the
benchmark (a wrong light-unit assumption, an unmatched tone curve, and Three.js' clustered addon dropping lights at its default
64-per-cluster cap with 1024 lights); the results below are after fixing them.

## Method

* 3 rounds x 40 frames per contender (120 pooled frames) after 30 warm-up frames; every round creates a fresh device and the contender order
  rotates between rounds. Medians and p95 are over the pooled frames.
* `cpu` = time inside `render()` (command encoding and submit). `total` = start of `render()` until `onSubmittedWorkDone()` resolves, which includes a
  fixed latency of roughly a millisecond, so `total` is a GPU-plus-overhead figure, not pure GPU time.
* Draw calls and triangles come from each engine's own counters. Three.js reports one extra draw and one extra triangle for its fullscreen
  output pass.

## Results: 10,000 objects (8 materials x 2 meshes, one directional light)

Times in ms, medians (p95 in parentheses).

| Contender | draws | cpu | total |
|---|---|---|---|
| nugie, one draw per object (`unsorted`) | 10,000 | 3.4 (20.6) | 12.1 (33.7) |
| nugie, instanced | 16 | 1.1 (6.2) | 2.6 (9.0) |
| Three `Mesh`, default settings | 10,000 | 18.2 (111.2) | 44.9 (164.3) |
| Three `Mesh`, tuned | 10,000 | 17.3 (19.5) | 44.1 (48.0) |
| Three `InstancedMesh`, tuned | 16 | 0.2 (0.5) | 1.3 (1.9) |
| Three `BatchedMesh`, tuned | 10,000 | 0.6 (0.7) | 3.1 (4.4) |

1,000 objects:

| Contender | draws | cpu | total |
|---|---|---|---|
| nugie `unsorted` | 1,000 | 2.2 (3.2) | 4.1 (5.5) |
| nugie instanced | 16 | 0.7 (4.7) | 1.8 (6.6) |
| Three `Mesh`, default | 1,000 | 11.1 (21.9) | 14.5 (25.6) |
| Three `Mesh`, tuned | 1,000 | 9.8 (16.3) | 13.1 (21.3) |
| Three `InstancedMesh`, tuned | 16 | 0.8 (4.2) | 1.5 (5.6) |
| Three `BatchedMesh`, tuned | 1,000 | 0.8 (3.3) | 1.8 (4.0) |

## Results: 400 instanced spheres + floor under N point lights (fragment bound)

Total ms, medians (cpu in parentheses). Both engines draw the scene in 2 to 3 draw calls, so the light count is the only variable.

| Lights | nugie clustered | nugie naive loop | Three clustered (addon) | Three forward (default) |
|---|---|---|---|---|
| 16 | 1.9 (0.3) | 3.3 (0.6) | 1.5 (0.7) | 2.3 (0.5) |
| 64 | 2.5 (0.5) | 7.5 (0.6) | 1.6 (0.8) | 41.9 (1.1) |
| 256 | 3.3 (0.2) | 21.7 (0.7) | 1.8 (0.3) | 506.7 (1.9) |
| 1024 | 9.9 (0.7) | 79.7 (0.8) | 9.2 (4.1) | not run (forward loop is about 2 s per frame; add `&full=1`) |

The 1024-light Three.js row uses a 256-per-cluster capacity; with the addon's default of 64 it rendered 1.7 levels of mean error away from the
reference (lights dropped) and ran in 4.8 ms, which is why the capacity was raised.

## Reading the numbers

* **Against Three.js out of the box** (`Mesh` objects, default forward lighting) nugie is much faster: about 3.7x less total time at 10,000
  `unsorted` objects (12.1 ms against 44.9 ms) and 17x to 150x less at 64 to 256 lights against Three.js' forward loop (nugie clustered).
* **Against Three.js with its own optimised paths the picture is more even, and Three.js is ahead in places.**
  * Instanced drawing: Three.js `InstancedMesh` took 1.3 ms against 2.6 ms for nugie's instanced mode at 10,000 objects, and its CPU
    cost is lower (0.2 ms against 1.1 ms). It was also faster at 1,000 objects, though the p95 values there overlap.
  * Clustered lighting: Three.js' `ClusteredLighting` addon was faster than nugie at 16 to 256 lights (1.5 to 1.8 ms against 1.9 to 3.3 ms) and
    roughly equal at 1024 lights (9.2 ms against 9.9 ms). Three.js' clustered path costs more CPU time at 1024 lights (4.1 ms
    against 0.7 ms).
  * nugie's naive loop and Three.js' default forward loop are both far slower than their clustered counterparts, and the gap grows with the
    light count.
* `BatchedMesh` on the WebGPU backend issues one draw per instance (10,001 draws in the table), so it behaves like many draw calls, yet its
  CPU time is low because the matrices live in a texture; it is not equivalent to indirect or instanced submission.
* nugie's tail latency (p95) in the 10,000-object `unsorted` and `instanced` rows is higher than its median; Three.js `InstancedMesh` was
  steadier. The cause was not investigated.

## Caveats

* One machine, one browser (Chromium 152 in the Claude desktop app, which may throttle or schedule differently from a normal Chrome window),
  one run of 3 x 40 frames. Treat differences under about 20% as noise and repeat on other hardware before drawing conclusions.
* `total` includes the `onSubmittedWorkDone` round trip; very small values (about 1 to 2 ms) are dominated by that overhead.
* Scene transforms are static. This benchmark does not measure per-frame transform updates, shadows, skinning, IBL or textures.
* Three.js tone mapping is applied in its output pass and nugie's inside the material shader, which is a real architectural difference
  that stays in the numbers.
