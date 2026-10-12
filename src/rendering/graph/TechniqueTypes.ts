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
  /** `@group(n)` of the shader; must differ from the node's own `group`. */
  group: number;
  /** Name of the layout, registered with `TechniqueInstance` (`hostLayouts`); the bind group is supplied with `setHostBindGroup(layout, ...)`. */
  layout: string;
}

export interface ComputeNode extends NodeBase {
  type: 'compute';
  shader: ShaderSource;
  /** `@group` of the bindings the technique generates (resources, variables). Default 0. */
  group?: number;
  /** Bind groups the host supplies at other group indices. */
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
  /** `@group` of the bindings the technique generates (resources, variables). Default 0. */
  group?: number;
  /** Bind groups the host supplies at other group indices. */
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

export interface CopyNode extends NodeBase {
  type: 'copy';
  source: string;
  dest: string;
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

/** Engine code as a node (how the renderer's own passes plug in): declares what it reads and writes and records commands itself. */
export interface CallbackNode extends NodeBase {
  type: 'callback';
  reads?: string[];
  writes?: string[];
  execute: (encoder: GPUCommandEncoder) => void;
}

export type NodeDecl = ComputeNode | DrawNode | CopyNode | SubGraphNode | CallbackNode;

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
