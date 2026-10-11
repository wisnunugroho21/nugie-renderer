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

Working examples: [tests/fixtures/blur.technique.json](../tests/fixtures/blur.technique.json) + [blur-pass.technique.json](../tests/fixtures/blur-pass.technique.json) (files),
`src/selftest/techniqueTests.ts` (compute chains, a looped sub-graph, a draw node; checked against CPU results on a real GPU at `/selftest.html`).

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
* **draw**: `shader.code` with `vs_main` / `fs_main` (names configurable), `colorTargets` (`loadOp`, `clearValue`, `blend: 'alpha' | 'additive'`), optional `depthTarget`,
  `vertexCount` (a number or variable), `instanceCount`, `topology`, `cullMode`, read-only `bindings`. Geometry is procedural or read from bound storage buffers.
* **copy**: `source` -> `dest`, same kind, format and size.
* **subgraph**: `technique` (inline or a registry name), `inputs` / `outputs` map the sub-technique's imported / exported resources to this technique's,
  `variables` bind or override its variables, `loop` repeats it (a count or a variable's value; unrolled; a sub-technique variable named `loopIndex` gets the iteration).
  Resources of a sub-graph that are neither mapped nor imported are internal to each instance.
* **callback** (code only, not in files): `{ type: 'callback', reads, writes, execute(encoder) }`. This is how engine passes live in the graph.
* Every node may have `condition: { variable, op, value }` (the node is dropped while it is false) and `sideEffect: true` (never cull it).

`parseTechnique(json)` checks the whole structure and names the first problem (`technique.nodes[2].bindings[0].access: expected one of ...`); unknown keys are errors.
`techniqueToJSON` writes one back (callbacks cannot be stored).

## Shader tokens

Written inside WGSL block comments, replaced before the shader module is created:

| Token | Becomes |
|---|---|
| `$(Variable:radius)` | `gigi.radius`, a field of a generated uniform struct (only variables the shader mentions; `float4` is `vec4<f32>`, aligned as WGSL requires) |
| `$(Size:img)` | `vec3<u32>(w, h, d)` for a texture, `<count>u` for a buffer: baked in at compile time |
| `$(Bindings)` | the generated declarations: the uniform, then one `@group(0) @binding(n) var ...` per binding (`name`, or `name_sampler` when `sampler` is set). Without the token they are put in front of the code |

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
* **Variables**: `setVariable(name, value)`, `getVariable`, `variables('user')` (what a UI would list). Variables that size resources, count loops or switch nodes are
  *structural*: changing one recompiles on the next `execute` (resources whose description is unchanged keep their contents, persistent history included). Others only update uniform buffers and
  dispatch / draw counts. Only the top-level technique's variables can be set; sub-graph ones are bound or overridden in the sub-graph node.
* `execute(encoder)` records everything; `resource(name)` returns the GPU object (exported ones are readable after the work is submitted); `plan` exposes the compiled plan; `dispose()` frees what was created.
* Uniforms are written with `queue.writeBuffer` inside `execute`, so submit between two executes of the same instance.

### In the engine's frame graph

`RenderGraph` (the engine's per-frame pass graph) is the same model with callback nodes: passes declare `reads` / `writes` and it orders, culls and records them.
It now also reports `spans` (first / last use per logical resource), `stats` (resource transitions, node-kind switches, versus declaration order) and accepts
`strategy = 'transitions'`. A technique plugs in as one pass: `graph.addPass(fx.asPass({ reads: ['sceneColor'], writes: ['sceneColor'] }))`.

### Visualising

`techniqueToDot(instance.plan)` returns Graphviz DOT: nodes in execution order, resources coloured by visibility (dashed = transient), reads and writes as edges, and
memory shared through aliasing drawn as a cluster. `dot -Tsvg graph.dot -o graph.svg`.

## Differences from Gigi, and limits

* No visual editor or viewer application, no code generation: techniques are JSON (or TypeScript objects) interpreted by `TechniqueInstance`.
* WGSL only; no ray tracing nodes; draw nodes have no vertex buffers (procedural or storage-buffer vertex fetch), no MSAA targets, and always use bind group 0.
* Conditions and loop counts are evaluated at compile time (a change recompiles) rather than per frame on the GPU.
* Copies cover mip 0 (and all layers); textures sampled by a node see every mip, storage and render targets use one mip.
* Variables are scalars and `float4`; sub-graph variables cannot be changed from the host except through binding to a parent variable.
