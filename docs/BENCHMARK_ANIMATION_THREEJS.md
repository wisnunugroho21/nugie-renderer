# Skinning and morphing: nugie-renderer vs Three.js `WebGPURenderer`

Identical-scene comparison of skeletal animation and morph targets, run with [`/bench-three.html`](../bench-three.html) (source:
[`src/bench/compareThree.ts`](../src/bench/compareThree.ts)). Reproduce with `npm run dev`, then open

```
/bench-three.html?scenario=skin&frames=60&rounds=4&interleave=1        # 3-joint skeleton per character, glTF 'wave' clip
/bench-three.html?scenario=morph&frames=60&rounds=4&interleave=1       # morph targets only (8 targets, 4 active)
/bench-three.html?scenario=skinmorph&frames=60&rounds=4&interleave=1   # both
```

Extra parameters: `n=<characters>` (default sizes 100 and 1000), `targets=` (default 8), `active=` (default 4), `radial=` / `rings=` (default 16 / 24, i.e. 425 vertices and
768 triangles per character). The page prints the hardware and the tables below and offers the raw samples as JSON.

## What is identical

* **Asset**: the same procedural tentacle GLB (`buildTentacleGLB`) is parsed by each engine's own glTF loader (nugie `loadGLTF` +
  `instantiateGLTF`, Three.js `GLTFLoader` + `SkeletonUtils.clone`), so geometry, skin weights, inverse bind matrices, morph deltas and the clip are byte-identical.
* **Animation**: skinned characters play the glTF `wave` clip looping, each with its own phase offset (nugie `AnimationSystem`, one
  Three.js `AnimationMixer` per character, the idiomatic setup). Morph weights are written every frame by the same function for both engines
  (`0.5 + 0.5 sin(t (1 + 0.3 k) + 0.1 i)` for the first `active` targets, through `MorphStore.setWeights` and `morphTargetInfluences`).
* **Time**: every frame advances a fixed 1/60 s, so both engines show the same pose in the snapshot frame.
* **Scene, material, light, camera, tone curve, resolution**: as in the [static comparison](BENCHMARK_THREEJS.md) (one directional light, PBR
  material from the GLB, 960 x 540, pixel ratio 1, no MSAA, same ACES fit and sRGB encode).
* **Image check**: each contender's snapshot is compared with nugie's. All rows below are within 0.23 mean absolute error (0..255) of nugie's image
  (static check: 0.05); the limit that flags a mismatch is 0.5.

Contenders: `nugie (batched)` is the default state-sorted instancing mode; `nugie (unsorted)` is one draw per character, the
like-for-like draw count for Three.js. `three (default)`; `three (tuned)` disables sorting and frustum culling and freezes the characters' root
matrices (bones still animate). `InstancedMesh` and `BatchedMesh` do not support skinning, so there is no instanced Three.js variant.

## Method

* 4 rounds x 60 frames per contender (240 pooled frames) after 30 warm-up frames, **interleaved**: all four devices live at once and
  the measured frame alternates between them, which removes clock and scheduling drift between contenders. Each scenario was run twice (A / B) to show
  reproducibility.
* A frame is one simulation step plus the render: animation, transform / skeleton update, extraction and `render()` for nugie; mixers, weight writes and
  `render()` for Three.js (which updates matrices and skeletons inside `render()`).
* `cpu` = time of that whole frame call (encoding and submit). `total` = frame start until `onSubmittedWorkDone()` resolves.
  `anim` = animation evaluation and morph-weight writes only (the part that is separable in both engines).
* All timings are medians over the pooled frames, in ms. The browser coarsens `performance.now()` to 0.1 ms, so values below about 0.5 ms (every `anim` figure
  at 100 characters) are quantised.

## Hardware and software

| | |
|---|---|
| GPU (WebGPU adapter) | vendor `intel`, architecture `gen-12lp` (integrated; the browser masks the device name) |
| GPU (WebGL unmasked renderer) | ANGLE (Intel, Intel(R) Graphics 0xA7AB, Direct3D11) |
| CPU | 16 threads |
| Browser | Chromium 152 inside the Claude desktop app, Windows 11 (the pane was hidden while measuring) |
| Display | 1536 x 960 @1.25x; the canvases are 960 x 540 at pixel ratio 1 |
| Three.js | r186 (`three/webgpu`, `WebGPURenderer`, `antialias: false`) |
| nugie-renderer | 0.2.0 + the benchmark scenarios on `improvement-1` |
| Measured | 2026-10-11, Vite **dev** server (unminified, no production build) for both engines |

This is a different machine from the macOS / Apple M1 run in the static report, so absolute numbers are not comparable across the two documents.

## Results: 1,000 animated characters (768,000 triangles)

Medians in ms, run A / run B. `GPU*` is `total - cpu`, a rough estimate (it includes a fixed submit-to-idle latency of about a millisecond).

| Scenario | Contender | draws | cpu | total | anim | GPU* |
|---|---|---|---|---|---|---|
| skin | nugie (batched) | 1 | 3.3 / 4.2 | 13.8 / 13.9 | 1.0 / 1.2 | 10.5 / 9.7 |
| skin | nugie (unsorted) | 1,000 | 3.8 / 4.5 | 13.9 / 14.0 | 0.9 / 1.1 | 10.1 / 9.5 |
| skin | three (default) | 1,001 | 24.3 / 24.7 | 42.0 / 48.4 | 1.7 / 1.9 | 17.7 / 23.7 |
| skin | three (tuned) | 1,001 | 23.3 / 24.2 | 42.0 / 48.3 | 1.6 / 1.9 | 18.7 / 24.1 |
| morph | nugie (batched) | 1 | 1.7 / 1.7 | 20.6 / 20.7 | 0.3 / 0.3 | 18.9 / 19.0 |
| morph | nugie (unsorted) | 1,000 | 2.1 / 2.2 | 20.7 / 20.8 | 0.3 / 0.4 | 18.6 / 18.6 |
| morph | three (default) | 1,001 | 12.6 / 12.3 | 28.0 / 28.1 | 0.4 / 0.4 | 15.4 / 15.8 |
| morph | three (tuned) | 1,001 | 12.5 / 11.4 | 27.9 / 27.9 | 0.4 / 0.4 | 15.4 / 16.5 |
| skin + morph | nugie (batched) | 1 | 4.4 / 5.1 | 20.6 / 20.7 | 1.4 / 1.6 | 16.2 / 15.6 |
| skin + morph | nugie (unsorted) | 1,000 | 4.9 / 5.7 | 20.9 / 21.0 | 1.3 / 1.5 | 16.0 / 15.3 |
| skin + morph | three (default) | 1,001 | 26.6 / 26.1 | 55.5 / 55.5 | 2.3 / 2.3 | 28.9 / 29.4 |
| skin + morph | three (tuned) | 1,001 | 26.4 / 26.1 | 55.4 / 55.3 | 2.3 / 2.3 | 29.0 / 29.2 |

## Results: 100 animated characters (76,800 triangles)

| Scenario | Contender | draws | cpu | total |
|---|---|---|---|---|
| skin | nugie (batched) | 1 | 0.7 / 0.8 | 4.2 / 4.3 |
| skin | nugie (unsorted) | 100 | 0.8 / 0.9 | 5.1 / 5.0 |
| skin | three (default) | 101 | 2.0 / 2.1 | 6.9 / 6.4 |
| skin | three (tuned) | 101 | 1.9 / 2.0 | 7.0 / 6.9 |
| morph | nugie (batched) | 1 | 0.5 / 0.5 | 4.2 / 4.2 |
| morph | nugie (unsorted) | 100 | 0.5 / 0.6 | 5.4 / 5.1 |
| morph | three (default) | 101 | 1.6 / 1.6 | 6.0 / 5.9 |
| morph | three (tuned) | 101 | 1.5 / 1.5 | 6.2 / 6.0 |
| skin + morph | nugie (batched) | 1 | 0.8 / 0.9 | 4.9 / 5.0 |
| skin + morph | nugie (unsorted) | 100 | 0.9 / 0.9 | 6.1 / 6.0 |
| skin + morph | three (default) | 101 | 2.2 / 2.3 | 7.5 / 8.0 |
| skin + morph | three (tuned) | 101 | 2.1 / 2.2 | 8.0 / 8.2 |

## Reading the numbers

* **CPU cost per frame**: nugie is about 5 to 7x lower at 1,000 characters (skin 3.3 to 4.5 ms against 23 to 25 ms; morph 1.7 to 2.2 ms against 11 to 13 ms; both 4.4 to 5.7 ms against
  26 ms), and about 2 to 3x lower at 100. The like-for-like `nugie (unsorted)` row (one draw per character) is within about 25% of the batched row on CPU, so
  most of the gap is not draw-call collapsing: it is Three.js doing per-object work (matrix updates, per-skeleton buffer updates, bind-group and node updates)
  inside `render()`.
* **Animation evaluation alone** (`anim`) is much closer: 0.9 to 1.2 ms against 1.6 to 1.9 ms for skinning, and 1.3 to 1.6 ms against 2.3 ms for both. For morphing the cost
  is just writing the weights (0.3 to 0.4 ms in both). The CPU advantage is therefore mainly in the matrix / skeleton / submission path, not in clip sampling.
* **Total (submit to GPU idle)**: nugie is 3 to 3.5x faster for skinning at 1,000 characters (13.8 against 42 to 48 ms) and 2.7x faster for skin + morph (20.6 against 55.5 ms), but only 1.35x
  faster for morph only (20.6 against 28.0 ms).
* **Three.js is ahead on the GPU side of morphing.** In the morph-only 1,000-character row nugie's frame is GPU bound (about 19 ms of its 20.6 ms) while Three.js needs
  about 15.5 ms of GPU time (both estimated as `total - cpu`), so with a faster CPU path Three.js would catch up or pass nugie on this scene. The cause was not investigated
  (the depth prepass is off in this benchmark, so it is not prepass overdraw); candidates are how the active-target pairs are fetched from the deform arena and the cost of the
  per-vertex target loop. In the skinning rows the estimate points the other way (nugie about 10 ms, Three.js 18 to 24 ms).
* **`three (tuned)` buys nothing here.** Disabling culling and sorting and freezing root matrices changes `cpu` by under 10% and the differences are inside run-to-run noise.
  The dominant cost is per-skinned-mesh work that these switches do not remove.
* **Batching**: nugie draws 1,000 skinned characters in one draw because skinned and morphed meshes share arenas and per-instance joint / morph state is
  looked up by instance. Three.js cannot instance skinned meshes (`InstancedMesh` / `BatchedMesh` do not skin), so it issues one draw per character.

## Caveats

* One machine (an integrated Intel GPU), one browser, two runs of 4 x 60 frames per row. The two runs agree within about 25% on `cpu` and 15% on `total` (the largest `total` gap is `three skin 1000`, 42.0 and 48.4 ms),
  so treat differences under about 20% as noise. The 100-character `total` values (4 to 8 ms) are dominated by the submit-to-idle round trip.
* Results come from the Vite dev server (unminified code, dev-mode assertions in both engines), unlike the static report which used a production build.
* The browser pane was hidden while measuring, which may change scheduling compared with a visible window.
* **Harness detail that matters for Three.js**: `WebGPURenderer` only advances its internal frame id inside `setAnimationLoop`, and its once-per-frame skeleton update is gated
  on that id, so calling `render()` directly froze skinning after the first frame (the image check caught it: 0.7 mean error, lit ratio 0.47). The Three.js contenders therefore call
  `nodeFrame.update()` before each render, which is what the animation loop does. The call is a private API (`renderer._nodes.nodeFrame`) and may break on other Three.js versions.
* The workload is small meshes (768 triangles, 3 joints, 4 active targets of 8) in large numbers. Rigs with many joints, many active targets or high vertex counts shift cost toward the GPU
  and the morph and skinning shaders, where this benchmark shows Three.js ahead on morphing; it does not measure those.
* No shadows, textures, IBL, blending or inverse-kinematics / blend-tree animation graphs: only a single looping clip per character.
