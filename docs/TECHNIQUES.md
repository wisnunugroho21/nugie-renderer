# Techniques: the render graph as data (Gigi style)

A **technique** describes GPU work the way [EA SEED's Gigi](https://github.com/electronicarts/gigi) does: as a graph of **resources** and **actions**, with
typed **variables** that drive sizes, dispatches and shader constants. You declare *what* runs and *what it touches*; the compiler works out
the order, drops work nobody needs, plans when each resource lives and lets transient resources share memory; the runtime creates the pipelines,
bind groups and textures and records the commands.

```ts
import { TechniqueInstance, parseTechnique, type Technique } from 'nugie-renderer';

const blur: Technique = parseTechnique(JSON.parse(await (await fetch('blur.technique.json')).text()));
const fx = TechniqueInstance.create(engine.gpu, blur, { registry: { 'blur-pass': blurPass }, imports: { source: sceneTexture } });
fx.setVariable('radius', 6);                       // a plain variable: only a uniform changes
const encoder = device.createCommandEncoder();
fx.execute(encoder);                               // records every live node, in order
device.queue.submit([encoder.finish()]);
const result = fx.resource('blurred');             // exported resources are readable by the host
```

You can write the same thing from code, without JSON, with the [builder API](#the-builder-api).

Run it: `/?scene=technique` (`src/demos/techniqueDemo.ts`) builds a plasma generator and a reusable blur sub-technique with the builder, runs them as a pass of the engine's frame graph through a `RenderFeature` and shows the exported texture on a panel and a sphere; `[` / `]` change the blur radius (0 switches the blur sub-graphs off by condition and the graph recompiles), `G` prints the graph as DOT.

Working examples: [tests/fixtures/blur.technique.json](../tests/fixtures/blur.technique.json) + [blur-pass.technique.json](../tests/fixtures/blur-pass.technique.json) (files),
`src/selftest/techniqueTests.ts` (compute chains, a looped sub-graph, a draw node; checked against CPU results on a real GPU at `/selftest.html`).

## The builder API

`technique(name)` returns a `TechniqueBuilder`: declare variables, resources and nodes with ordinary calls. Declarations return **typed handles** that you pass
around instead of strings, so a typo or a handle from another technique fails at the call that made it, naming the technique and the node.

```ts
import { technique, wgsl, bindings, sizeOf } from 'nugie-renderer';

const g = technique('threshold');
const level = g.float('level', 0.5);                                              // VariableHandle
const src = g.texture('src', { format: 'rgba8unorm', size: [256, 256], visibility: 'imported' });   // TextureHandle
const out = g.texture('out', { like: src, visibility: 'exported' });

g.compute('cut', {
  reads: [src], writes: [out], dispatch: { like: out },
  shader: wgsl`${bindings}
    @compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
      let p = vec2<i32>(id.xy);
      let c = textureLoad(${src}, p, 0);
      textureStore(${out}, p, select(vec4<f32>(0.0), c, c.r > ${level}));
    }`,
});

const fx = g.instantiate(gpu, { imports: { src: sceneTexture } });   // compile + create GPU resources
fx.setVariable('level', 0.75);
```

| Call | Does |
|---|---|
| `g.int / uint / float / float4(name, value?, visibility?)` | declare a variable; returns a `VariableHandle` (`.times(k)`, `.plus(n)`, `.scaled(k, n)` make size entries; `.eq / ne / lt / le / gt / ge(v)` make conditions) |
| `g.texture(name, { format, size, dimension, mips, samples, like, scale, visibility, lifetime })` | declare a texture; `size` entries may be numbers or variable handles; `samples: 4` makes it an MSAA target |
| `g.buffer(name, { element, stride, count, like, visibility, lifetime })` | declare a buffer |
| `g.compute(name, { shader, reads, writes, readWrites, dispatch, workgroupSize, when, keep })` | compute dispatch; each list entry is a handle or `{ resource, name?, sampler? }` |
| `g.draw(name, { shader, colorTargets, depthTarget, vertexBuffers, reads, vertices, instances, topology, ... })` | draw call (see [Draw nodes](#draw-nodes-vertex-buffers-and-msaa)) |
| `g.renderPass(name, { colorTargets, depthTarget, uses, record })` | a render pass whose draws the host records (see [Render nodes](#render-nodes-host-recorded-draws)) |
| `g.copy(name, from, to, { from, to, size })` | copy between textures and buffers (see [Copy and clear nodes](#copy-and-clear-nodes)) |
| `g.clear(name, buffer, { offset, size })` | zero a buffer range |
| `g.subgraph(name, builder \| technique \| 'registry-name', { inputs, outputs, variables, loop })` | sub-graph; `variables` values are a handle (bind to it) or a number / array (override); `loop` is a count or a handle |
| `g.callback(name, { reads, writes, execute })` | engine code |
| `g.build()` | the finished `Technique` (a copy) |
| `g.compile(options?)` | compile now: surfaces validation errors and diagnostics early |
| `g.instantiate(gpu, options?)` | `TechniqueInstance.create(gpu, g.build(), options)` |
| `g.toJSON()` / `g.registerIn(registry)` | the technique as JSON text / registered by name for string sub-graph references |

Shader helpers: a variable handle prints as its `$(Variable:name)` token and a resource handle as its WGSL binding name, so `${level}` and `${src}` work in `wgsl` templates
(and plain template strings); `sizeOf(handle)` is the `$(Size:...)` token and `bindings` the `$(Bindings)` token. `wgsl` throws on an `undefined` placeholder.
The builder and the JSON format are the same model: `g.build()` equals the parsed JSON file for the same graph (`tests/technique-builder.test.ts` checks this against the example files).

## Concepts (and how they map to Gigi)

| Gigi | Here |
|---|---|
| Resource nodes: textures (2D, 2D array, 3D, cube) and buffers | `TextureDecl`, `BufferDecl` (`resources`) |
| Resource **visibility**: imported / internal / exported | `visibility: 'imported' \| 'internal' \| 'exported'` (default internal) |
| Resource **lifetime**: transient / persistent across frames | `lifetime: 'transient' \| 'persistent'` (default transient) |
| Variables: int, uint, float, float4; user / host / internal visibility | `VariableDecl`, `visibility: 'user' \| 'host' \| 'internal'` |
| Action nodes: dispatch compute shader, draw call, copy resource, sub graph | `compute`, `draw`, `copy`, `subgraph` nodes (+ `callback`, see below) |
| Sub graph: imported -> input pins, exported -> output pins, variable binding / override, loop count (unrolled) | `inputs`, `outputs`, `variables: { bind } \| { value }`, `loop` |
| Shader tokens such as `/*$(Variable:x)*/` | `$(Variable:x)`, `$(Size:resource)`, `$(Bindings)` (see below) |
| Front end: flatten the DAG, read-only accesses link to the last write, reorder to cut transitions | `flatten` -> `compileTechnique` (`order: 'declaration' \| 'transitions'`) |
| Planned: de-duplicate transient resources | done: lifetimes + memory aliasing |
| Compiler backends (C++/DX12, WebGPU, Unreal) | not generated: `TechniqueInstance` interprets the compiled plan at run time |
| Viewer (debug, profile) | `techniqueToDot` (Graphviz), `plan.stats`, `plan.diagnostics` |

## The format

```jsonc
{
  "name": "example",
  "variables": [{ "name": "width", "type": "uint", "value": 256, "visibility": "host" }],
  "resources": [
    { "kind": "texture", "name": "src", "format": "rgba8unorm", "visibility": "imported", "size": [{ "variable": "width" }, 256] },
    { "kind": "texture", "name": "half", "like": "src", "scale": 0.5 },                    // size / format borrowed, scaled
    { "kind": "buffer", "name": "list", "element": "vec4<f32>", "count": 1024, "lifetime": "persistent" }
  ],
  "nodes": [ /* compute | draw | copy | subgraph */ ]
}
```

* **Sizes** (`SizeDim`): a number, or `{ variable, scale?, offset? }` (`variable * scale + offset`, rounded down). Textures take `[width, height, depthOrLayers]`.
* **`like`** copies size and format (or element type) from another resource of the same kind; explicit fields win.
* **compute**: `shader.code` (WGSL), `bindings` (`{ resource, access: 'read' | 'write' | 'readwrite', name?, sampler? }`), `dispatch`: `{ threads: [..] }`,
  `{ like: 'texture' }` or `{ indirect: 'buffer' }`. `workgroupSize` is read from `@workgroup_size(8, 8)` when it is plain numbers.
  `read` binds a sampled texture or read-only storage buffer, `write` / `readwrite` a storage texture or read-write storage buffer
  (`readwrite` textures must be `r32float` / `r32uint` / `r32sint`).
* **draw**: `shader.code` with `vs_main` / `fs_main` (names configurable), `colorTargets` (`loadOp`, `clearValue`, `blend: 'alpha' | 'additive'`, `resolve`, `storeOp`), optional `depthTarget`,
  `vertexBuffers`, `vertexCount` (a number or variable), `instanceCount`, `topology`, `cullMode`, read-only `bindings`. Geometry is procedural, read from bound storage buffers,
  or fed by vertex buffers; targets may be multisampled (see [Draw nodes](#draw-nodes-vertex-buffers-and-msaa)).
* **texture `samples`**: `1` (default) or `4`, a 2D single-mip MSAA render target.
* **copy**: `source` -> `dest`; with no options the two must match in kind, format and size (textures: mip 0). `from` / `to` / `size` turn it into a region copy (see [Copy and clear nodes](#copy-and-clear-nodes)).
* **clear**: `{ resource, offset?, size? }` zeroes a buffer range.
* **subgraph**: `technique` (inline or a registry name), `inputs` / `outputs` map the sub-technique's imported / exported resources to this technique's,
  `variables` bind or override its variables, `loop` repeats it (a count or a variable's value; unrolled; a sub-technique variable named `loopIndex` gets the iteration).
  Resources of a sub-graph that are neither mapped nor imported are internal to each instance.
* **callback** (code only, not in files): `{ type: 'callback', reads, writes, execute(encoder) }`. This is how engine passes live in the graph.
* Every node may have `condition: { variable, op, value }` (the node is dropped while it is false) and `sideEffect: true` (never cull it).

`parseTechnique(json)` checks the whole structure and names the first problem (`technique.nodes[2].bindings[0].access: expected one of ...`); unknown keys are errors.
`techniqueToJSON` writes one back (callbacks cannot be stored).

## Draw nodes: vertex buffers and MSAA

**Vertex buffers.** A draw node's `vertexBuffers` bind buffer resources as vertex input, like Gigi's vertex / instance buffers. Each entry names the buffer, its attributes
(the shader reads them with `@location(n)`) and optionally `stepMode` (`vertex`, the default, or `instance`), `arrayStride` (default: the buffer's declared `stride`) and `offset`.
Because the buffer is an ordinary resource, a compute node can generate it (it is a `write` binding there, a `vertex` read here, and the compiler orders and keeps the work),
or the host can import it (create it with `GPUBufferUsage.VERTEX`; `setImport` checks the flag).

```ts
const verts = g.buffer('verts', { element: 'f32', stride: 20, count: 3 });          // 3 vertices of (x, y, r, g, b)
g.draw('tri', {
  vertexBuffers: [{ resource: verts, attributes: [{ location: 0, format: 'float32x2', offset: 0 }, { location: 1, format: 'float32x3', offset: 8 }] }],
  colorTargets: [screen],
  shader: wgsl`@vertex fn vs_main(@location(0) p: vec2<f32>, @location(1) c: vec3<f32>) -> ...`,
});                                                                                    // no `vertices`: all 3 elements are drawn
```

`vertexCount` may be left out when a per-vertex buffer is bound (every element of the first one is drawn); `instanceCount` defaults to the first `instance` buffer, else 1.
The compiler checks attribute formats, alignment, fit inside the stride, unique `@location`s (0-15) and that the buffer is not also bound as a storage buffer in the same node.

**Index buffers.** `indexBuffer: { resource, format?, offset? }` makes the draw indexed (`format` is `uint32` by default or `uint16`; `offset` is in bytes and a multiple of the index size).
`indexCount` (builder: `indices`) defaults to every index after the offset; `vertexCount` is then not needed. Instances work as usual. Like vertex buffers, an index buffer is a
normal resource: a compute node can fill it, or the host can import it (create it with `GPUBufferUsage.INDEX`). For strip topologies the pipeline gets the matching `stripIndexFormat`.

**Base vertex and indirect draws.** `baseVertex` (a number or variable, may be negative; indexed draws only) is added to every index before the vertex fetch, so several meshes can share one vertex buffer.
`indirect: { resource, offset? }` takes the draw arguments from a buffer instead: 4 x u32 (`vertexCount, instanceCount, firstVertex, firstInstance`), or 5 x u32 (`indexCount, instanceCount, firstIndex, baseVertex, firstInstance`)
when `indexBuffer` is set. A compute node can write them (GPU culling), and the compiler orders it before the draw; an imported buffer needs `GPUBufferUsage.INDIRECT`. `vertexCount`, `indexCount`, `instanceCount` and `baseVertex` must be left out of an indirect draw.

**MSAA targets.** Give a texture `samples: 4` (WebGPU supports 1 and 4; `like` borrows size and format, never the sample count) and use it as a color or depth target. All attachments of one
draw must agree in size and sample count. To get a single-sample image, set the color target's `resolve` to a same-size, same-format, single-sample texture; the samples are averaged
into it at the end of the pass. Add `storeOp: 'discard'` when the resolve is the only consumer so the multisampled samples never go back to memory.

```ts
const msaa = g.texture('msaa', { format: 'rgba8unorm', size: [w, h], samples: 4 });
const image = g.texture('image', { like: msaa, visibility: 'exported' });
g.draw('scene', { shader, vertexBuffers, colorTargets: [{ resource: msaa, resolve: image, storeOp: 'discard' }] });
```

A multisampled texture can also be read by later nodes, without a sampler, as `texture_multisampled_2d<f32>` (`texture_depth_multisampled_2d` for depth): `textureLoad(msaa, p, sampleIndex)`.
It cannot be a storage texture. Memory accounting (`plan.stats.bytes`) counts all samples, and multisampled textures only alias with others of the same sample count.

Self-tests: `/selftest.html` (an anti-aliased triangle from a compute-generated vertex buffer, per-instance data from the host, per-sample reads).

## Copy and clear nodes

A **copy node** moves data on the GPU between any two resources: texture to texture, buffer to buffer, texture to buffer (a readback or a staged upload) and buffer to texture.

```ts
g.copy('mip-to-region', atlasMips, atlas, { from: { mip: 1 }, to: { origin: [64, 32] }, size: [128, 128] });   // texture region (mips, origins, array layers via origin z)
g.copy('slice', ring, scratch, { from: { offset: 256 }, to: { offset: 0 }, size: [bytesVariable] });          // buffer range; size entries may be variables
g.copy('readback', image, staging, { from: { mip: 0 }, size: [w, h] });                                          // texture -> buffer: rows padded to 256 bytes unless `to.bytesPerRow` says otherwise
```

`from` / `to` (`CopyEnd`) name where each side starts: `mip` and `origin: [x, y, z-or-layer]` for textures, `offset` (bytes, a multiple of 4) for buffers, and on the buffer side of a texture copy `bytesPerRow` (a multiple of 256) and
`rowsPerImage`. `size` is `[bytes]` for two buffers and `[width, height?, depthOrLayers?]` when a texture is involved; without it the copy takes what is left of the smaller side after the origins. Without any of the three the node keeps its
original strict meaning (same kind, format and size, mip 0). The compiler checks formats, sample counts, mip ranges, extents and buffer sizes against the declarations (including the bytes a texture-to-buffer copy needs), and the instance checks the
`COPY_SRC` / `COPY_DST` usage of imported resources. A texture side that names a `mip` only claims that mip level for the dependency analysis, so copies into different mips of one texture do not conflict.

A **clear node** (`g.clear`) zeroes a buffer range with `clearBuffer` (`ClusterGrid` clears its overflow counter before the culling compute this way). Textures are cleared by being a render target.

**Without a `GPUContext`.** Low-level code that only has a device (an allocator, the profiler) can run copy and clear nodes on imported resources with a device-only host: `{ device, queue: device.queue }` (`deviceHost(device)`);
a technique that owns resources or shaders asks for a full `GPUContext`. `runOnce(host, name, build, imports)` builds such a technique, records and submits it and frees it; `readBuffer` / `readTexture` (`graph/Readback.ts`) use it for tests and tools.

## Render nodes: host-recorded draws

A draw node issues one draw with a shader the technique owns. A **render node** (`g.renderPass`, code only like a callback node) is for passes made of many draws with different pipelines, bind groups and
geometry, such as a batch list. The technique owns the *pass*: colour targets (with MSAA `resolve` and `storeOp`), the depth target (`layer` of a `2d-array` map, `readOnly`), timestamps, ordering and the declared
`uses`; the host owns the *draws*, recorded in `record(pass)` through a `TrackedRenderPass`:

```ts
g.renderPass('shadow-layer-2', { depthTarget: { resource: shadowMap, layer: 2 }, record: (pass) => {
  pass.setBindGroup(0, layerFrame); pass.setVertexBuffer(0, vertices); pass.setIndexBuffer(indices, 'uint32');
  for (const batch of batches) {
    pass.setPipeline(pipelineOf(batch));                       // host-built, per material variant
    pass.setBindGroup(2, materialGroupOf(batch));              // or setBindGroup(2, group, [dynamicOffset])
    pass.drawIndexed(batch.indexCount, batch.instances, batch.firstIndex, batch.baseVertex, batch.firstInstance);
  }
} });
```

`TrackedRenderPass` remembers the pipeline, bind groups (per group index), vertex and index buffers and skips a call that would change nothing (`switches` / `skipped` count them); a bind group set with dynamic offsets is
always forwarded. Pipelines and bind groups are ordinary WebGPU objects the host built, so any number of material variants, vertex layouts and per-draw dynamic offsets are possible. `uses: [{ resource, usage }]` names host
resources the draws read (`sampled`, `storage`, `uniform`, `vertex`, `index`, `indirect`; `write: true` if they write) so the graph orders the pass and gives the resources the right usage flags.
Attachments are validated like a draw node's (same size and sample count, resolve target, depth format).

**Segments.** A render node's draws can be split into ordered, named parts that different owners contribute: `g.passSegment('main', 'sky', { record, uses })` (or `segments: [...]` on the node). The node's own
`record` runs first, then the segments in order, all through the *same* `TrackedRenderPass`, so a pipeline or bind group that two neighbouring segments share is set once. A segment's `uses` count as the pass's
(ordering, lifetimes, usage flags). The renderer's main pass is built this way: a segment for the scene's opaque geometry, one for each feature's `drawBackdrop`, one for the blended geometry, one for each feature's `drawMain`.

`TrackedRenderPass` wraps a render pass encoder *or a render bundle encoder* (`isBundle`), so one draw loop records into either. `executeBundles(bundles)` replays bundles and clears the cache (a replayed bundle leaves the
pass with nothing bound); `invalidate()` does the same after you used the raw `encoder` yourself. A pass whose draw callback depends on the frame (the target size, the set of active layers) is kept in a `CachedTechnique`, which rebuilds only when its key changes.

## Mip views, bind groups and imported contents

**Mip views.** A texture binding can name a sub-range of the mip chain: `{ resource, mip, mipCount }` (builder: `reads: [{ resource: t, mip: 1, mipCount: 1 }]`). Without them a `read` sees
the whole chain and a storage `write` mip 0. A draw's colour target already names a mip (`ColorTarget.mip`). Bindings of **disjoint** ranges of one texture may sit in the same node, which is
how a mip chain is built: node *i* reads level *i-1* and writes level *i* (compute pyramid: `HiZ.ts`; render blit chain: `TransmissionCopy.ts`). Overlapping ranges are a usage conflict.

**Several bind groups.** A node's bindings can be spread over up to four `@group`s. `group` on the node is the default (0 unless set; it also holds the variables uniform), and a binding can pick its own:
`reads: [{ resource: view, group: 1 }, { resource: shared, group: 2 }]`. The compiler numbers `@binding` inside each group, creates one layout and one bind group per group and puts them all in the
pipeline layout; a gap between groups gets an empty layout. Group an engine pass by how often its data changes (per frame / per view / per object), as the engine's own shaders do.

**Uniform buffers and dynamic offsets.** A buffer bound for reading can be a `var<uniform>` single element instead of a storage array: `{ resource, uniform: true }` (the element type is the buffer's `element`, usually a struct
defined in the shader; the buffer needs the UNIFORM usage). With `dynamicOffset: true` the binding's window slides along the buffer by an offset chosen at run time, so one buffer holds the data of many views or objects:

```ts
g.compute('shade', { reads: [{ resource: views, name: 'view', uniform: true, dynamicOffset: true, group: 1 }], ... });   // views: element 'ViewData', stride 256
for (let v = 0; v < viewCount; v++) {
  fx.setDynamicOffset('shade', 'view', v * 256);      // node path, WGSL name of the binding; a multiple of the device's offset alignment (256)
  fx.execute(encoder); device.queue.submit([encoder.finish()]);
}
```

The window is `size` bytes (default: one element, so the buffer needs a `stride` for struct elements). Offsets are read when `execute` records the passes. Variables are uploaded at `execute` too, so submit between runs
if they change; offsets alone can change between executes into the same encoder. Self-test: "bindings in three @groups ...".

**Host bind groups.** The engine's frame and scene bind groups are not resources a technique can generate. A compute or draw node can say that the host supplies them at the group indices its generated bindings do not use:
`hostGroups: [{ group: 0, layout: 'frame' }, { group: 1, layout: 'scene' }]` with `group: 2` for the generated bindings (default 0). The instance is created with
`hostLayouts: { frame, scene }` (the `GPUBindGroupLayout`s) and given the bind groups with `setHostBindGroup('frame', bindGroup)` before `execute` (`VolumetricFog.ts`).

**Reading incoming contents.** A node that reads an *imported* or *persistent* resource before any node writes it sees the contents from outside the execution (the host's texture, last frame's history);
it does not wait for a later writer, which instead waits for the reader. That lets an effect read the scene texture and a later copy write the result back over it (`FullscreenEffect.ts`).
A transient internal resource read before its first write still waits for its producer.

**Execute options.** `execute(encoder, { timestampWrites: (nodePath) => ... })` lets the host attach GPU timestamp queries to a node's pass (the engine's `GPUProfiler`).

## What the engine runs as techniques

The frame is one technique (`FrameGraph`, see [In the engine's frame graph](#in-the-engines-frame-graph)) and every engine pass is a set of data nodes in it (compute / draw / copy / clear / render nodes), ordered by
the resources they really read and write. Each was checked against the previous hand-written passes (pixel-identical output through the engine, or the GPU self-tests). Node paths in the plan are
`<pass>/<node>` for a pass that comes from a sub-technique (`clusters/cluster-cull`, `hiz/hiz-down-3`, `post/post-composite`):

| Pass | Where | Nodes |
|---|---|---|
| Post chain: view depth, SSAO (+2 blurs), SSR, bloom mip chain, composite, FXAA | `rendering/post/PostChain.ts` (+ `PostProcessor.ts`) | one draw node each; the scene, aux, depth and swap chain are imported, every other target is transient and memory-aliased |
| User full-screen effects | `FullscreenEffect.ts` | draw into a scratch image, copy back over the scene |
| Transmission copy + mip chain | `TransmissionCopy.ts` | copy, then one draw per mip |
| Light-cluster assignment | `ClusterGrid.ts` | clear the overflow counter, compute over the clusters |
| Volumetric fog fill | `VolumetricFog.ts` | compute with the engine's frame and scene bind groups from the host, imported 3D volume |
| GPU culling (frustum, Hi-Z, LOD), three phases | `GPUCuller.ts` | one compute node per phase (`gpu-cull`, `cull-A`, `cull-B`), each with its own parameters |
| Meshlet culling of opted-in meshes | `MeshletDraws.ts` (+ `MeshletCuller.ts`) | callback node `meshlet-cull` (one compute pass per meshlet draw), writes the logical `meshletDraws` the main pass waits for |
| Hi-Z pyramid | `HiZ.ts` | compute: copy depth, then one reduction per mip |
| GPU particles | `particles/ParticleSystem.ts` | per pool, compute: reset, simulate (indirect dispatch), emit, finalize |
| Ribbon trails | `particles/RibbonSystem.ts` | compute |
| Depth prepass | `Renderer.ts` | render node, depth target |
| Aux pass (normal / roughness / metallic for SSAO and SSR) | `Renderer.ts` | render node, MSAA colour with resolve, read-only depth |
| Shadow maps | `shadows/ShadowSystem.ts` | one render node per active layer, writing that layer of the shadow-map array |
| **Main pass(es)**: single pass, opaque + late around the transmission copy, the two Hi-Z culling phases | `rendering/MainPassNode.ts` (+ `Renderer.ts`) | one render node each: swap chain or HDR scene image, MSAA buffer with resolve, depth load / clear, clear colour; **segments** for the scene geometry and for every feature's `drawBackdrop` / `drawMain` |
| Scene draw loop (batches, GPU-culled indirect draws, meshlet-culled indirect draws, retained render bundles) | `DrawRecorder.ts` (`drawGeometry`) | records through `TrackedRenderPass`, into the pass or into a bundle encoder; bundles replay with `executeBundles` |
| Feature draws: sky, lines, points, sprites, particles, ribbons, custom features | `Skybox`, `overlay/*`, `particles/*` | the segment of the pass; state set through the shared tracker |
| Arena growth (mesh, index and deform buffers copy their contents into the bigger buffer) | `gpu/Arena.ts` | copy node (one-shot) |
| Streamed texture levels (the mips two residencies share are copied GPU-side) | `streaming/TextureStreamer.ts` | one copy node per level (one-shot) |
| GPU profiler: query results into the staging ring | `profiling/GPUProfiler.ts` | copy node whose size is a variable, in a technique kept across frames |
| Readbacks: `RenderTarget.readPixels`, particle / ribbon debug reads, the self-test helpers | `graph/Readback.ts` | copy node into a mappable staging buffer (one-shot) |
| Light-cluster overflow counter reset | `lighting/ClusterGrid.ts` | clear node |
| Render-to-texture views (mirrors, minimaps, security cameras) | `OffscreenViews.ts` (`renderDue` prepares, `declarePasses` declares) | one render node per due view (`view:<n>`), ahead of the frame's other passes: colour texture, depth discarded after the pass; segments for the geometry, the sky and the blended geometry. Each view has its own frame and scene uniform (`FrameUniform`, `ViewScene`) and draw state, so all the views record into the frame's one command encoder |
| Reflection-probe captures (`captureEnvironment`) | `OffscreenViews.ts` (`captureEnvironment`) | called between frames and baked straight away, so each face is a small render-node technique of its own, submitted right away |

 `IBLBaker` (offline environment baking), `MipmapGenerator` (texture import) and
`CompactVertexStream` (derived vertex data) are asset-preparation utilities that run outside the frame.

The only callback nodes left in a frame are the ones a game's own features declare (code the graph cannot see into, such as a technique with resources of its own that a material samples: `/?scene=technique`).
The off-screen views are render nodes of the frame, declared first (a view shows the last frame's shadow map and lights, as it always did); only the probe capture, which runs between frames, is a technique of its own.

The GPU-to-GPU copies the engine records are all copy / clear nodes now. What stays outside the graph are the *uploads* from the CPU (`queue.writeBuffer`, `writeTexture`, `copyExternalImageToTexture`): they are queue operations
that run in submission order rather than commands in an encoder.

## Shader tokens

Written inside WGSL block comments, replaced before the shader module is created:

| Token | Becomes |
|---|---|
| `$(Variable:radius)` | `gigi.radius`, a field of a generated uniform struct (only variables the shader mentions; `float4` is `vec4<f32>`, aligned as WGSL requires) |
| `$(Size:img)` | `vec3<u32>(w, h, d)` for a texture, `<count>u` for a buffer: baked in at compile time |
| `$(Bindings)` | the generated declarations: the uniform, then one `@group(g) @binding(n) var ...` per binding (g = the binding's `group`, else the node's `group`, default 0; `name`, or `name_sampler` when `sampler` is set; a `uniform` buffer is `var<uniform> name: Element`). Without the token they are put in front of the code |

Names in tokens are the ones used in the technique the node is written in; sub-graph renames are resolved for you.

## What the compiler does

`compileTechnique(technique, { registry?, values?, order?, alias? })` -> `CompiledTechnique`:

1. **Flatten**: sub-graphs are inlined (loops unrolled, names path-qualified: `blur#1/horizontal`).
2. **Resolve** sizes from variables (and `like`), validate every node: undeclared names, copy mismatches, storage-texture formats, colour / depth target rules,
   conflicting bindings of one resource in one node. Problems throw a `TechniqueError`; softer ones land in `plan.diagnostics`
   (e.g. a transient resource read before anything writes it).
3. **Dependencies** from the declared accesses: readers link to the last writer, a writer waits for earlier readers.
4. **Cull**: work is kept if it writes an imported, exported or persistent resource (or is `sideEffect`), plus everything that feeds it.
5. **Order**: stable (declaration order among independent nodes) or `transitions`, which also minimises resource state changes and compute / render / copy switches
   (`plan.stats.transitions` vs `declaredTransitions`).
6. **Lifetimes and memory**: first / last use of every resource; transient internal resources with the same description and disjoint lifetimes share one allocation
   (`plan.slots`, `stats.bytes` vs `stats.bytesAliased`). Persistent and exported resources never alias.

## Running it

`TechniqueInstance.create(gpu, technique, { imports?, registry?, values?, order?, alias?, label? })`:

* **Imported** resources are attached with `imports` or `setImport(name, resource)`; usage flags, format and size are checked against what the nodes need.
* `onResourcesReplaced(fn)` tells a host holding a view of an exported texture when a recompile (a size variable) swapped it for a new object. Toggling conditional nodes never does: an allocation covers every way the nodes a condition switched off could use it.
* **Variables**: `setVariable(name, value)`, `getVariable`, `variables('user')` (what a UI would list). Variables that size resources, count loops or switch nodes are
  *structural*: changing one recompiles on the next `execute` (resources whose description is unchanged keep their contents, persistent history included). Others only update uniform buffers and
  dispatch / draw counts. Only the top-level technique's variables can be set; sub-graph ones are bound or overridden in the sub-graph node.
* `execute(encoder)` records everything; `resource(name)` returns the GPU object (exported ones are readable after the work is submitted, and can be sampled by materials: they are created with copy-source and sampled-texture usage); `plan` exposes the compiled plan; `dispose()` frees what was created.
* Uniforms are written with `queue.writeBuffer` inside `execute`, so submit between two executes of the same instance.

### In the engine's frame graph

The engine's per-frame pass graph is itself a technique (`rendering/graph/FrameGraph.ts`). Each frame `FrameGraph.begin()` returns a fresh `FrameBuilder` (a `TechniqueBuilder` that also carries what the
frame supplies at run time); the renderer and the features add their passes to it and `FrameGraph.run(builder, encoder)` compiles (dependencies, culling, ordering) and records them.

* **The host's objects are imported resources.** `importTexture(name, texture)` / `importBuffer(name, buffer, element)` declare a resource from the object itself (format, size, layers, mips, samples), once per name, and supply it.
  The engine's names: `backbuffer` (the swap chain), `sceneColor` (the HDR scene), `sceneMsaa`, `depth`, `auxTex`, `shadowMap`, `lights`, `clusterGrid`, `fogVolume`, `hizTex`, `transmissionTex`, `culledInstances` ...
* **A system is a technique that the frame includes.** `include(node, technique, { imports, variables, outputs, after, publish })` runs a finished `Technique` (a stable object, kept by the system) as a sub-graph: its imported
  resources are declared from the objects in `imports` (`{ as: 'lights', resource }` uses a frame-level name several passes share), its variables are declared on the frame as `<node>/<name>` with this frame's values, and its
  nodes join the graph under the path `<node>/...`. `publish: ['shadowMap']` (or `publish(...)`) says the main pass has to come after what the node produces; `after` is the same for one node.
* **Render nodes** declare the frame's passes with the host recording the draws: the main passes (`declareMainPass`), the depth prepass, the aux pass and the shadow layers. A segment is one feature's part of a pass.
* **Run-time data** goes beside the nodes: `value(name, type, v)` (variable values), `hostGroup(layout, bindGroup)`, `dynamicOffset(node, binding, offset)` and `timestamps(path, writes)` (GPU timestamps for a node or everything below a path).
* **Logical resources** (`graph.logical('plasma')`, idempotent) hold no memory: they are names for ordering, usable by callback nodes (`reads` / `writes`) and by any node's `after`. They are how a game's own callback pass tells
  the main pass to wait for it (`produces` on the feature, or `after`).
* **The plan** (`plan.steps`, `plan.culled`, `plan.resources.get(name).first / last`, `plan.stats` with transitions and kind switches) is the technique's usual one, and `compile({ order: 'transitions' })` reorders independent passes.
* **Plan reuse.** Most frames declare the same passes as the one before. `FrameGraph` computes `structureKey()` (resources and nodes without the functions, sub-techniques by identity, no variables) and, when it matches a
  compiled plan it keeps, hands that instance this frame's imports, variable values, bind groups, offsets and code (`setHostCode`: callback `execute`, render-node `record` and segments). A steady scene does not recompile; a
  change in the set of passes, in a target's size or format, or in the clear colour does. The last few plans are kept (four by default; one unused for 120 frames is freed), so a frame that alternates between shapes, such as
  an off-screen view drawn every other frame (`interval: 2`) or transmission switching on and off, switches between compiled plans instead of compiling every frame. The kept plans share their textures and buffers through
  one `AllocationPool` (they never execute at the same time), so a kept plan costs pipelines and bind groups, not memory, and persistent / exported resources keep their contents across a switch. Pipelines survive a
  recompile (`pipelineCache`).
* **Steady-state cost.** Executing a reused plan creates no GPU objects: a step's bind groups are rebuilt only when a resource *it* binds is replaced, and the bind groups for an import that cycles through a few
  objects (the triple-buffered instance ring) are kept and reused; a variable change rewrites only the uniforms of the steps that read it.

A technique of your own that owns resources (a plasma texture a material samples) plugs in as one callback node: `fx.addTo(graph, { writes: [graph.logical('plasma')] })`.

### Visualising

`techniqueToDot(instance.plan)` returns Graphviz DOT: nodes in execution order, resources coloured by visibility (dashed = transient), reads and writes as edges, and
memory shared through aliasing drawn as a cluster. `dot -Tsvg graph.dot -o graph.svg`.

## Differences from Gigi, and limits

* No visual editor or viewer application, no code generation: techniques are JSON (or TypeScript objects) interpreted by `TechniqueInstance`.
* WGSL only; no ray tracing nodes; a draw node issues one draw with its own shader; per-batch pipeline and bind group switching is done by render nodes, whose pipelines the host builds; no pipeline-overridable constants.
* Conditions and loop counts are evaluated at compile time (a change recompiles) rather than per frame on the GPU.
* Copies cover mip 0 (and all layers); textures sampled by a node see every mip unless the binding names a range, storage and render targets use one mip.
* Variables are scalars and `float4`; sub-graph variables cannot be changed from the host except through binding to a parent variable.
