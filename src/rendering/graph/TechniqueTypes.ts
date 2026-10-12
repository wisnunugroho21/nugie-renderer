import type { TrackedRenderPass } from './TrackedRenderPass';

/**
 * Technique schema: a render graph written as data, modelled on EA SEED's Gigi (https://github.com/electronicarts/gigi).
 *
 * A technique is a set of **resources** (textures and buffers with a type, a size, a lifetime and a visibility), typed **variables**
 * (the knobs that size resources and dispatches and feed shaders) and **nodes** (the actions: compute dispatch, draw call, copy,
 * sub-graph, plus a callback node for engine code). Nodes name the resources they bind and how (read / write / read-write);
 * the compiler derives the order, drops unused work, plans resource lifetimes and aliases transient memory from that.
 * Techniques are plain JSON-compatible objects (except callback nodes), so they can be stored, edited and diffed as files.
 */

/** Gigi resource visibility: who owns the resource. */
export type ResourceVisibility =
  /** Supplied by the host (the engine or the game); the technique never creates or frees it. */
  | 'imported'
  /** Owned by the technique; the host cannot reach it. */
  | 'internal'
  /** Created by the technique but readable by the host after it ran (see `TechniqueInstance.resource`). */
  | 'exported';

/** Gigi resource lifetime. */
export type ResourceLifetime =
  /** Contents only matter within one execution; the memory may be shared with other transient resources. */
  | 'transient'
  /** Contents survive from one execution to the next (history buffers, accumulation targets); never aliased. */
  | 'persistent';

/** Gigi variable visibility: who may change it. */
export type VariableVisibility = 'user' | 'host' | 'internal';
export type VariableType = 'int' | 'uint' | 'float' | 'float4';

export interface VariableDecl {
  name: string;
  type: VariableType;
  /** Initial value: a number, or four numbers for `float4`. Defaults to zero. */
  value?: number | number[];
  /** `user`: shown to a person (UI / console), `host`: set by the application every frame, `internal`: only used inside the technique. Default `user`. */
  visibility?: VariableVisibility;
}

/** One extent of a resource or a dispatch: a constant, or a variable (optionally scaled and offset: `variable * scale + offset`, rounded down). */
export type SizeDim = number | { variable: string; scale?: number; offset?: number };

export type TextureDimension = '2d' | '2d-array' | '3d' | 'cube';

interface ResourceBase {
  name: string;
  /** Default `internal`. */
  visibility?: ResourceVisibility;
  /** Default `transient`. Imported resources ignore it. */
  lifetime?: ResourceLifetime;
  /**
   * A name for ordering only: no memory is allocated and no declaration is needed beyond the name. Only `callback` nodes may use it (they order
   * themselves by it); it is how a frame's engine passes say "this pass produces the shadow map, that one consumes it". Always internal and transient.
   */
  logical?: boolean;
  /**
   * Take size (and, where not given, format / element type) from another resource of the same kind. `scale` multiplies the
   * width and height (e.g. 0.5 for a half-resolution target). Explicit `size` entries win over the borrowed ones.
   */
  like?: string;
  scale?: number;
}

export interface TextureDecl extends ResourceBase {
  kind: 'texture';
  dimension?: TextureDimension;
  format?: GPUTextureFormat;
  /** Width, height, depth / layers (missing entries are 1). */
  size?: SizeDim[];
  /** Mip levels: a count or `'full'`. Default 1. */
  mips?: number | 'full';
  /**
   * MSAA sample count: 1 (default) or 4. A multisampled texture is a 2D, single-mip render target: draw nodes render into it (and `resolve` it into a
   * single-sample texture), shaders read it with `textureLoad(tex, p, sampleIndex)`. It cannot be a storage texture. `like` borrows size and format, never the sample count.
   */
  samples?: 1 | 4;
}

export interface BufferDecl extends ResourceBase {
  kind: 'buffer';
  /** WGSL element type the buffer is declared with in shaders (`f32`, `u32`, `vec4<f32>`, or a struct defined in the shader). Default `u32`. */
  element?: string;
  /** Bytes per element. Needed for struct element types; scalar and vector types are known. */
  stride?: number;
  /** Number of elements. */
  count?: SizeDim;
}

export type ResourceDecl = TextureDecl | BufferDecl;

/** How a node binds a resource: `read` = sampled texture / read-only storage buffer, `write` / `readwrite` = storage texture / read-write storage buffer. */
export type BindingAccess = 'read' | 'write' | 'readwrite';

export interface BindingDecl {
  resource: string;
  access: BindingAccess;
  /** Name of the WGSL variable the shader uses. Defaults to the resource name. */
  name?: string;
  /** Also declare `<name>_sampler` with this filter (sampled textures only). */
  sampler?: GPUFilterMode;
  /**
   * `@group` this binding is declared in. Default: the node's `group` (0 unless set). A node may spread its bindings over several groups (for example per-view data
   * in one group and per-object data in another); the host's groups (`hostGroups`) take other indices. Groups 0 to 3.
   */
  group?: number;
  /** Buffers, `read` only: declare `var<uniform> name: <element>` (one element, not an array) instead of a read-only storage array. The buffer needs the UNIFORM usage. */
  uniform?: boolean;
  /**
   * Buffers: the binding window moves by an offset chosen at run time, `TechniqueInstance.setDynamicOffset(node, binding, bytes)`, so one buffer can hold the
   * data of many views or objects (a ring of per-draw uniforms). The offset is a multiple of the device's offset alignment (256 on most devices).
   */
  dynamicOffset?: boolean;
  /** Buffers: bytes of the binding window. Default: the whole buffer, or one element (`stride`) when the binding has a `dynamicOffset`. */
  size?: number;
  /** Textures: first mip level of the view (default 0). */
  mip?: number;
  /**
   * Textures: mip levels in the view. With neither `mip` nor `mipCount` a `read` sees the whole chain and a `write` / `readwrite` one level (storage views have one
   * level). As soon as either is given, `mipCount` defaults to 1.
   */
  mipCount?: number;
}

/** WGSL source. It may contain Gigi-style tokens (`$(Variable:Name)`, `$(Bindings)`, `$(Size:Resource)` inside a block comment); see ShaderTokens.ts. */
export interface ShaderSource { code: string; }

export interface NodeCondition {
  variable: string;
  op: 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';
  value: number;
}

interface NodeBase {
  name: string;
  /** Run the node only while the condition holds (evaluated when the graph is compiled; changing the variable recompiles). */
  condition?: NodeCondition;
  /** Keep the node even if nothing consumes its outputs. */
  sideEffect?: boolean;
}

/** A bind group the host supplies to a node (the engine's frame and scene groups): the shader declares its bindings itself. */
export interface HostBindGroup {
  /** `@group(n)` of the shader; must differ from every group the node's generated bindings use. */
  group: number;
  /** Name of the layout, registered with `TechniqueInstance` (`hostLayouts`); the bind group is supplied with `setHostBindGroup(layout, ...)`. */
  layout: string;
}

export interface ComputeNode extends NodeBase {
  type: 'compute';
  shader: ShaderSource;
  /** Default `@group` of the bindings the technique generates (resources, variables); a binding can choose its own with `group`. Default 0. */
  group?: number;
  /** Bind groups the host supplies at group indices the generated bindings do not use. */
  hostGroups?: HostBindGroup[];
  entryPoint?: string;
  /** Must match the shader's `@workgroup_size`; read from the source when it uses plain numbers. */
  workgroupSize?: [number, number?, number?];
  bindings: BindingDecl[];
  /** Threads to launch (rounded up to whole workgroups): explicit extents, the size of a resource, or an indirect dispatch buffer. */
  dispatch: { threads: SizeDim[] } | { like: string } | { indirect: string; offset?: number };
}

export interface ColorTarget {
  resource: string;
  /** Default `clear`. */
  loadOp?: 'clear' | 'load';
  clearValue?: [number, number, number, number];
  blend?: 'none' | 'alpha' | 'additive';
  mip?: number;
  layer?: number;
  /**
   * MSAA targets: a single-sample texture (same size and format) the samples are averaged into when the pass ends.
   * Written at mip 0, layer 0.
   */
  resolve?: string;
  /** `discard` skips writing the multisampled samples back to memory; use it when `resolve` is the only consumer. Default `store`. */
  storeOp?: 'store' | 'discard';
}

export interface DepthTarget {
  resource: string;
  loadOp?: 'clear' | 'load';
  clearValue?: number;
  compare?: GPUCompareFunction;
  write?: boolean;
  /** Array layer of a `2d-array` depth texture (a shadow map with one layer per light / cascade). Default 0. */
  layer?: number;
  /** The pass only tests against the depth (load and store are not performed, no depth is written): the depth buffer can be sampled or shared meanwhile. */
  readOnly?: boolean;
  /** `discard` when nothing reads the depth after the pass (an off-screen view); default `store`. */
  storeOp?: 'store' | 'discard';
}

/** One attribute of a vertex buffer: the shader reads it with `@location(location)`. */
export interface VertexAttribute {
  location: number;
  format: GPUVertexFormat;
  /** Byte offset inside one element. */
  offset: number;
}

/** A buffer resource bound as vertex input of a draw node. */
export interface VertexBufferBinding {
  resource: string;
  /** `vertex`: one element per vertex (default). `instance`: one element per instance. */
  stepMode?: GPUVertexStepMode;
  /** Bytes between elements. Defaults to the buffer's element size (`stride`). */
  arrayStride?: number;
  /** Byte offset of the first element inside the buffer. Default 0. */
  offset?: number;
  attributes: VertexAttribute[];
}

/** A buffer resource bound as the index buffer of a draw node (the draw becomes indexed). */
export interface IndexBufferBinding {
  resource: string;
  /** Index width: `uint32` (default) or `uint16`. The buffer holds tightly packed indices of this width. */
  format?: GPUIndexFormat;
  /** Byte offset of the first index; a multiple of the index size. Default 0. */
  offset?: number;
}

export interface DrawNode extends NodeBase {
  type: 'draw';
  /** Default `@group` of the bindings the technique generates (resources, variables); a binding can choose its own with `group`. Default 0. */
  group?: number;
  /** Bind groups the host supplies at group indices the generated bindings do not use. */
  hostGroups?: HostBindGroup[];
  /** One WGSL module with both entry points. Geometry is procedural (`@builtin(vertex_index)`), read from bound storage buffers, or fed by `vertexBuffers`. */
  shader: ShaderSource;
  vertexEntry?: string;
  fragmentEntry?: string;
  bindings: BindingDecl[];
  colorTargets: ColorTarget[];
  depthTarget?: DepthTarget;
  /** Vertex input. The buffers are read-only for the node (they may be written by an earlier compute node or the host). Attribute locations must be unique across all buffers. */
  vertexBuffers?: VertexBufferBinding[];
  /** Makes the draw indexed. The buffer is read-only for the node (a compute node or the host can fill it). */
  indexBuffer?: IndexBufferBinding;
  /** Indices to draw when `indexBuffer` is set. Defaults to every index in the buffer after `offset`. */
  indexCount?: SizeDim;
  /**
   * Vertices to draw. Optional when a `vertex` step-mode buffer is bound: then every element of the first one is drawn.
   * Required for procedural geometry; ignored by indexed draws (use `indexCount`).
   */
  vertexCount?: SizeDim;
  /** Indexed draws: added to every index before the vertex fetch (a variable or constant; may be negative). Default 0. */
  baseVertex?: SizeDim;
  /**
   * Take the draw arguments from a GPU buffer (written by a compute node, e.g. after culling): 4 x u32 (`vertexCount, instanceCount, firstVertex, firstInstance`),
   * or 5 x u32 (`indexCount, instanceCount, firstIndex, baseVertex, firstInstance`) when `indexBuffer` is set. Replaces
   * `vertexCount`, `indexCount`, `instanceCount` and `baseVertex`, which must then be left out.
   */
  indirect?: { resource: string; offset?: number };
  /** Instances to draw. Defaults to every element of the first `instance` step-mode buffer, or 1. */
  instanceCount?: SizeDim;
  topology?: GPUPrimitiveTopology;
  cullMode?: GPUCullMode;
}

/** One side of a copy: where in the resource the copy starts. */
export interface CopyEnd {
  /** Textures: mip level (default 0). */
  mip?: number;
  /** Textures: first texel `[x, y, z or layer]` (missing entries are 0). */
  origin?: [number, number?, number?];
  /** Buffers: byte offset of the first byte (of the first row, when the other side is a texture). A multiple of 4. */
  offset?: number;
  /** The buffer side of a texture copy: bytes from one row to the next (a multiple of 256). Default: the extent's rows packed tightly, rounded up to 256. */
  bytesPerRow?: number;
  /** The buffer side of a texture copy: rows from one image (layer) to the next. Default: the extent's height. */
  rowsPerImage?: number;
}

/**
 * Copy between two resources on the GPU: texture to texture (any mips and layers, same format), buffer to buffer, texture to buffer (a readback or a buffer upload
 * staged for later) or buffer to texture. With no `from` / `to` / `size` it copies everything the two have in common from the start (textures: mip 0, same size).
 */
export interface CopyNode extends NodeBase {
  type: 'copy';
  source: string;
  dest: string;
  from?: CopyEnd;
  to?: CopyEnd;
  /** Extent of the copy: `[bytes]` for two buffers, `[width, height?, depthOrLayers?]` in texels when a texture is involved. Entries may be variables. */
  size?: SizeDim[];
}

/** Zero a range of a buffer on the GPU (`clearBuffer`). */
export interface ClearNode extends NodeBase {
  type: 'clear';
  resource: string;
  /** Byte offset (a multiple of 4). Default 0. */
  offset?: number;
  /** Bytes to clear (a multiple of 4). Default: to the end of the buffer. */
  size?: SizeDim;
}

export interface SubGraphNode extends NodeBase {
  type: 'subgraph';
  /** The technique to run, inline or by name in the registry passed to the compiler. */
  technique: Technique | string;
  /** Sub-technique imported resource -> resource of this technique that feeds it. */
  inputs?: Record<string, string>;
  /** Sub-technique exported resource -> resource of this technique that receives it (unlisted exports become internal). */
  outputs?: Record<string, string>;
  /** Sub-technique variable -> `{ bind }` a variable of this technique, or `{ value }` to override its default. Unlisted ones keep their defaults. */
  variables?: Record<string, { bind: string } | { value: number | number[] }>;
  /** Repeat the sub-graph this many times (a constant or a variable's current value). Loops are unrolled; a sub-technique variable named `loopIndex` receives the iteration. */
  loop?: number | { variable: string };
}

/** How a `render` node's recorded draws use a resource besides its attachments (so ordering, lifetimes and usage flags are right). */
export interface RenderPassUse {
  resource: string;
  usage: 'sampled' | 'storage' | 'uniform' | 'vertex' | 'index' | 'indirect';
  /** The draws write the resource (a storage buffer or texture). Default: read only. */
  write?: boolean;
}

/** One ordered part of a render node's draws, typically contributed by one feature (the sky, an overlay, the scene's opaque geometry ...). */
export interface RenderPassSegment {
  name: string;
  /** What this segment's draws read or write (added to the pass's own `uses`). */
  uses?: RenderPassUse[];
  /** Record the segment's draws into the pass; every segment of a pass gets the same tracking wrapper, so redundant state changes across segments are skipped too. */
  record: (pass: TrackedRenderPass) => void;
}

/**
 * A render pass whose draws the host records: the technique owns the attachments (colour targets with MSAA resolve, depth target with a layer or read-only), the pass
 * timestamps and the ordering, and the host issues the draws through a {@link TrackedRenderPass}, which skips redundant pipeline / bind group / buffer switches.
 * Use it where a draw node is not enough: many draws with different pipelines, bind groups (dynamic offsets) and geometry per draw, as in a batch list. Code only, like a callback node.
 */
export interface RenderPassNode extends NodeBase {
  type: 'render';
  colorTargets: ColorTarget[];
  depthTarget?: DepthTarget;
  /** What the draws read or write besides the attachments (host-owned resources the technique declares). */
  uses?: RenderPassUse[];
  /** Record the draws. Called once per `execute`, between the pass's begin and end, before the segments. */
  record?: (pass: TrackedRenderPass) => void;
  /** More draws, recorded in this order after `record`: each is a separate, nameable part of the pass (see {@link RenderPassSegment}); add them with `TechniqueBuilder.passSegment`. */
  segments?: RenderPassSegment[];
}

/** Engine code as a node (how the renderer's own passes plug in): declares what it reads and writes and records commands itself. */
export interface CallbackNode extends NodeBase {
  type: 'callback';
  reads?: string[];
  writes?: string[];
  execute: (encoder: GPUCommandEncoder) => void;
}

export type NodeDecl = ComputeNode | DrawNode | CopyNode | ClearNode | SubGraphNode | CallbackNode | RenderPassNode;

export interface Technique {
  name: string;
  variables?: VariableDecl[];
  resources?: ResourceDecl[];
  nodes: NodeDecl[];
}

/** Techniques by name, for sub-graph nodes that refer to them with a string. */
export type TechniqueRegistry = Record<string, Technique>;

/** A problem with a technique. Compile errors throw it; warnings are collected in the compiled graph. */
export class TechniqueError extends Error {}

/** One note the compiler made about a technique. */
export interface Diagnostic { level: 'error' | 'warning'; message: string; }
