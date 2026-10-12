import type { TechniqueHost } from './TechniqueInstance';
import { compileTechnique, type CompiledTechnique, type CompileOptions } from './Compile';
import type { TrackedRenderPass } from './TrackedRenderPass';
import { TechniqueInstance, type TechniqueInstanceOptions } from './TechniqueInstance';
import { techniqueToJSON } from './TechniqueJSON';
import {
  TechniqueError, type BindingAccess, type BindingDecl, type BufferDecl, type CallbackNode, type ColorTarget, type ComputeNode, type DepthTarget, type DrawNode, type NodeCondition,
  type NodeDecl, type ResourceLifetime, type ResourceVisibility, type SizeDim, type TextureDecl, type Technique, type TechniqueRegistry, type VariableDecl, type VariableType,
  type CopyEnd, type CopyNode, type ClearNode, type VariableVisibility, type VertexBufferBinding, type IndexBufferBinding, type HostBindGroup, type RenderPassNode, type RenderPassSegment, type RenderPassUse,
} from './TechniqueTypes';

/**
 * Code-first API for the technique render graph: build a {@link Technique} (or run it directly) from TypeScript instead of writing JSON.
 *
 * ```ts
 * const g = technique('threshold');
 * const width = g.uint('width', 256, 'host'), level = g.float('level', 0.5);
 * const src = g.texture('src', { format: 'rgba8unorm', size: [width, 256], visibility: 'imported' });
 * const out = g.texture('out', { like: src, visibility: 'exported' });
 * g.compute('cut', {
 *   reads: [src], writes: [out], dispatch: { like: out },
 *   shader: wgsl`${bindings}
 *     @compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
 *       let c = textureLoad(${src}, vec2<i32>(id.xy), 0);
 *       textureStore(${out}, vec2<i32>(id.xy), select(vec4<f32>(0.0), c, c.r > ${level}));
 *     }`,
 * });
 * const fx = g.instantiate(gpu, { imports: { src: texture } });   // same as TechniqueInstance.create(gpu, g.build(), ...)
 * ```
 *
 * Handles returned by `uint` / `texture` / ... replace string names: a handle from another builder, or an unknown resource, fails when
 * the node is added (with the node's name in the message), not later in the compiler. Handles print as what a shader needs, so
 * `${level}` in a template string is the `Variable` token and `${src}` is the binding's WGSL name.
 */

// ---------------------------------------------------------------------------------------------------------------- handles

/** A variable of a technique under construction. */
export class VariableHandle {
  /** @internal */
  constructor(readonly name: string, readonly type: VariableType, readonly owner: TechniqueBuilder) {}
  /** `variable * k`, as a size entry. */
  times(k: number): SizeDim { return { variable: this.name, scale: k }; }
  /** `variable + offset`, as a size entry. */
  plus(offset: number): SizeDim { return { variable: this.name, offset }; }
  /** `variable * k + offset`, as a size entry. */
  scaled(k: number, offset = 0): SizeDim { return { variable: this.name, scale: k, offset }; }
  /** Conditions for `when`: the node runs while the comparison holds. */
  eq(value: number): NodeCondition { return { variable: this.name, op: 'eq', value }; }
  ne(value: number): NodeCondition { return { variable: this.name, op: 'ne', value }; }
  lt(value: number): NodeCondition { return { variable: this.name, op: 'lt', value }; }
  le(value: number): NodeCondition { return { variable: this.name, op: 'le', value }; }
  gt(value: number): NodeCondition { return { variable: this.name, op: 'gt', value }; }
  ge(value: number): NodeCondition { return { variable: this.name, op: 'ge', value }; }
  /** The shader token for this variable (so `${handle}` works in any template string). */
  toString(): string { return `/*$(Variable:${this.name})*/`; }
}

/** A texture or buffer of a technique under construction. */
export class ResourceHandle<K extends 'texture' | 'buffer' = 'texture' | 'buffer'> {
  /** @internal */
  constructor(readonly name: string, readonly kind: K, readonly owner: TechniqueBuilder) {}
  /** The name a shader uses for this resource when it is bound without an explicit `name` (so `${handle}` works in templates). */
  toString(): string { return this.name; }
}
export type TextureHandle = ResourceHandle<'texture'>;
export type BufferHandle = ResourceHandle<'buffer'>;

/** The `$(Size:resource)` shader token: the resource's size as a constant (`vec3<u32>` for textures, a count for buffers). */
export function sizeOf(resource: ResourceHandle | string): string { return `/*$(Size:${typeof resource === 'string' ? resource : resource.name})*/`; }
/** The `$(Bindings)` shader token: where the generated declarations go (they are put in front of the code when it is absent). */
export const bindings = '/*$(Bindings)*/';

/** Template tag for shader source: like a plain template string (handles print as tokens / names) but documents intent and rejects `undefined` holes. */
export function wgsl(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((out, s, i) => {
    if (i === 0) return s;
    const v = values[i - 1];
    if (v === undefined || v === null) throw new TechniqueError(`wgsl: placeholder ${i} is ${String(v)}`);
    return out + String(v) + s;
  }, '');
}

// ---------------------------------------------------------------------------------------------------------------- options

/** A size entry: a number, a variable handle, or an explicit `{ variable, scale?, offset? }`. */
export type Dim = number | VariableHandle | SizeDim;
/** A resource named by handle or by string. */
export type ResourceRef = ResourceHandle | string;

export interface TextureOptions {
  format?: GPUTextureFormat;
  /** MSAA sample count (1 or 4). Draw nodes render into it and resolve it with a color target's `resolve`. */
  samples?: 1 | 4;
  size?: Dim[];
  dimension?: TextureDecl['dimension'];
  mips?: number | 'full';
  like?: ResourceRef;
  scale?: number;
  visibility?: ResourceVisibility;
  lifetime?: ResourceLifetime;
}
export interface BufferOptions {
  element?: string;
  stride?: number;
  count?: Dim;
  like?: ResourceRef;
  visibility?: ResourceVisibility;
  lifetime?: ResourceLifetime;
}
export interface VariableOptions { value?: number | number[]; visibility?: VariableVisibility; }

/** A binding with a per-binding WGSL name or sampler; a bare handle / string is the same with defaults. */
export type BindingRef = ResourceRef | {
  resource: ResourceRef; name?: string; sampler?: GPUFilterMode; mip?: number; mipCount?: number;
  /** `@group` of this binding (default: the node's `group`). */
  group?: number;
  /** Buffer: bind as a `var<uniform>` single element (reads only). */
  uniform?: boolean;
  /** Buffer: the window moves by an offset given per execution (`setDynamicOffset`). */
  dynamicOffset?: boolean;
  /** Buffer: bytes of the window. */
  size?: number;
};

interface NodeOptions {
  /** Run only while the comparison holds, e.g. `when: quality.gt(0)`. */
  when?: NodeCondition;
  /** Keep the node even if nothing consumes its outputs. */
  keep?: boolean;
}

/** Bind-group options shared by compute and draw nodes. */
interface HostGroupOptions {
  /** Default `@group` of the generated bindings (default 0); use another index when the shader's group 0 is the engine's. Bindings may choose their own. */
  group?: number;
  /** Bind groups the host supplies at other group indices (see `TechniqueInstance.setHostBindGroup`). */
  hostGroups?: HostBindGroup[];
}

export interface ComputeOptions extends NodeOptions, HostGroupOptions {
  shader: string;
  entryPoint?: string;
  workgroupSize?: [number, number?, number?];
  /** Sampled textures / read-only storage buffers. */
  reads?: BindingRef[];
  /** Write-only storage textures / read-write storage buffers. */
  writes?: BindingRef[];
  /** Read-write storage (`r32float` / `r32uint` / `r32sint` textures, or buffers). */
  readWrites?: BindingRef[];
  dispatch: { threads: Dim[] } | { like: ResourceRef } | { indirect: ResourceRef; offset?: number };
}

/** A vertex buffer of a draw: a buffer handle (attributes still needed) is written as `{ resource, attributes }`. */
export type VertexBufferRef = Omit<VertexBufferBinding, 'resource'> & { resource: ResourceRef };

export interface DrawOptions extends NodeOptions, HostGroupOptions {
  shader: string;
  vertexEntry?: string;
  fragmentEntry?: string;
  reads?: BindingRef[];
  /** A color target by handle, or with options; `resolve` names the single-sample texture an MSAA target is resolved into. */
  colorTargets: (ResourceRef | (Omit<ColorTarget, 'resource' | 'resolve'> & { resource: ResourceRef; resolve?: ResourceRef }))[];
  depthTarget?: Omit<DepthTarget, 'resource'> & { resource: ResourceRef };
  /** Vertex input buffers (`{ resource, attributes: [{ location, format, offset }], stepMode?, arrayStride?, offset? }`). */
  vertexBuffers?: VertexBufferRef[];
  /** Makes the draw indexed (`format` defaults to `uint32`). */
  indexBuffer?: Omit<IndexBufferBinding, 'resource'> & { resource: ResourceRef };
  /** Indexed draws: added to every index (a constant or variable; may be negative). */
  baseVertex?: Dim;
  /** Draw arguments from a GPU buffer (4 x u32, or 5 x u32 when indexed); replaces `vertices`, `indices`, `instances` and `baseVertex`. */
  indirect?: { resource: ResourceRef; offset?: number };
  /** Indices to draw; defaults to every index in the buffer. */
  indices?: Dim;
  /** Vertices to draw; optional when a per-vertex vertex buffer supplies the count. */
  vertices?: Dim;
  instances?: Dim;
  topology?: GPUPrimitiveTopology;
  cullMode?: GPUCullMode;
}

export interface SubGraphOptions extends NodeOptions {
  /** Sub-technique resource name -> resource of this technique that feeds it. */
  inputs?: Record<string, ResourceRef>;
  /** Sub-technique resource name -> resource of this technique that receives it. */
  outputs?: Record<string, ResourceRef>;
  /** Sub-technique variable name -> a variable of this technique to bind to, or a value to override its default. */
  variables?: Record<string, VariableHandle | number | number[]>;
  /** Repeat this many times (a count, or a variable handle whose current value is used). */
  loop?: number | VariableHandle;
}

export interface RenderPassOptions extends NodeOptions {
  /** A colour target by handle, or with options (`resolve` names the single-sample texture an MSAA target resolves into). */
  colorTargets?: DrawOptions['colorTargets'];
  depthTarget?: DrawOptions['depthTarget'];
  /** What the draws read or write besides the attachments: `{ resource, usage: 'sampled' | 'storage' | 'uniform' | 'vertex' | 'index' | 'indirect', write? }`. */
  uses?: (Omit<RenderPassUse, 'resource'> & { resource: ResourceRef })[];
  /** Draws recorded first; more can be added as ordered segments (`segments`, or `passSegment` later). */
  record?: (pass: TrackedRenderPass) => void;
  segments?: (Omit<RenderPassSegment, 'uses'> & { uses?: (Omit<RenderPassUse, 'resource'> & { resource: ResourceRef })[] })[];
}

export interface CopyOptions extends NodeOptions {
  from?: CopyEnd;
  to?: CopyEnd;
  /** `[bytes]` for buffers, `[width, height?, depthOrLayers?]` for textures. */
  size?: Dim[];
}

export interface ClearOptions extends NodeOptions {
  offset?: number;
  size?: Dim;
}

export interface PassSegmentOptions {
  uses?: (Omit<RenderPassUse, 'resource'> & { resource: ResourceRef })[];
  record: (pass: TrackedRenderPass) => void;
}

export interface CallbackOptions extends NodeOptions {
  reads?: ResourceRef[];
  writes?: ResourceRef[];
  execute: (encoder: GPUCommandEncoder) => void;
}

// ---------------------------------------------------------------------------------------------------------------- builder

/** Start a technique: shorthand for `new TechniqueBuilder(name)`. */
export function technique(name: string): TechniqueBuilder { return new TechniqueBuilder(name); }

/** Builds a {@link Technique} step by step with typed handles. Names are unique per kind; mistakes throw a {@link TechniqueError} at the call that made them. */
export class TechniqueBuilder {
  private variables: VariableDecl[] = [];
  private resources: (TextureDecl | BufferDecl)[] = [];
  private nodes: NodeDecl[] = [];
  private variableHandles = new Map<string, VariableHandle>();
  private resourceHandles = new Map<string, ResourceHandle>();
  private nodeNames = new Set<string>();
  private logicalNames = new Set<string>();

  constructor(readonly name: string) {
    if (!name) throw new TechniqueError('a technique needs a name');
  }

  // ------------------------------------------------------------------------------------------------------------ variables

  /** Declare an `int` variable. `visibility` may be given in place of options: `g.int('n', 4, 'host')`. */
  int(name: string, value?: number, options?: VariableVisibility | VariableOptions): VariableHandle { return this.variable(name, 'int', value, options); }
  uint(name: string, value?: number, options?: VariableVisibility | VariableOptions): VariableHandle { return this.variable(name, 'uint', value, options); }
  float(name: string, value?: number, options?: VariableVisibility | VariableOptions): VariableHandle { return this.variable(name, 'float', value, options); }
  float4(name: string, value?: number[], options?: VariableVisibility | VariableOptions): VariableHandle { return this.variable(name, 'float4', value, options); }

  private variable(name: string, type: VariableType, value: number | number[] | undefined, options: VariableVisibility | VariableOptions = {}): VariableHandle {
    if (this.variableHandles.has(name)) throw new TechniqueError(`technique '${this.name}': variable '${name}' is already declared`);
    const o = typeof options === 'string' ? { visibility: options } : options;
    const decl: VariableDecl = { name, type, ...(value !== undefined || o.value !== undefined ? { value: value ?? o.value } : {}), ...(o.visibility ? { visibility: o.visibility } : {}) };
    this.variables.push(decl);
    const handle = new VariableHandle(name, type, this);
    this.variableHandles.set(name, handle);
    return handle;
  }

  /** The handle of a variable declared earlier (useful across helper functions). */
  variableNamed(name: string): VariableHandle {
    const h = this.variableHandles.get(name);
    if (!h) throw new TechniqueError(`technique '${this.name}' has no variable '${name}'`);
    return h;
  }

  // ------------------------------------------------------------------------------------------------------------ resources

  /** Declare a texture. */
  texture(name: string, options: TextureOptions = {}): TextureHandle {
    const decl: TextureDecl = { kind: 'texture', name };
    if (options.format) decl.format = options.format;
    if (options.size) decl.size = options.size.map((d) => this.dim(d, `texture '${name}'`));
    if (options.dimension) decl.dimension = options.dimension;
    if (options.mips !== undefined) decl.mips = options.mips;
    if (options.samples !== undefined) decl.samples = options.samples;
    this.common(decl, options, name);
    return this.addResource(decl) as TextureHandle;
  }

  /** Declare a buffer. */
  buffer(name: string, options: BufferOptions = {}): BufferHandle {
    const decl: BufferDecl = { kind: 'buffer', name };
    if (options.element) decl.element = options.element;
    if (options.stride !== undefined) decl.stride = options.stride;
    if (options.count !== undefined) decl.count = this.dim(options.count, `buffer '${name}'`);
    this.common(decl, options, name);
    return this.addResource(decl) as BufferHandle;
  }

  /** Declare a buffer the host supplies (shorthand for `buffer(name, { element, stride, visibility: 'imported' })`). The element count is left to the host's buffer. */
  importedBuffer(name: string, element: string, stride?: number): BufferHandle {
    return this.buffer(name, { element, ...(stride !== undefined ? { stride } : {}), visibility: 'imported' });
  }

  /**
   * A logical resource: a name for ordering that holds no memory (see `ResourceDecl.logical`). Only callback nodes use it. Asking again for a name declared
   * before returns the same handle, so independent helpers can each name what they touch.
   */
  logical(name: string): ResourceHandle {
    const known = this.resourceHandles.get(name);
    if (known) {
      if (!this.logicalNames.has(name)) throw new TechniqueError(`technique '${this.name}': '${name}' is declared as a real resource, not a logical one`);
      return known;
    }
    this.logicalNames.add(name);
    return this.addResource({ kind: 'buffer', name, logical: true });
  }

  private common(decl: TextureDecl | BufferDecl, o: { like?: ResourceRef; scale?: number; visibility?: ResourceVisibility; lifetime?: ResourceLifetime }, name: string): void {
    if (o.like !== undefined) decl.like = this.resource(o.like, `resource '${name}' (like)`).name;
    if (o.scale !== undefined) decl.scale = o.scale;
    if (o.visibility) decl.visibility = o.visibility;
    if (o.lifetime) decl.lifetime = o.lifetime;
  }

  private addResource(decl: TextureDecl | BufferDecl): ResourceHandle {
    if (this.resourceHandles.has(decl.name)) throw new TechniqueError(`technique '${this.name}': resource '${decl.name}' is already declared`);
    this.resources.push(decl);
    const handle = new ResourceHandle(decl.name, decl.kind, this);
    this.resourceHandles.set(decl.name, handle);
    return handle;
  }

  /** The handle of a resource declared earlier. */
  resourceNamed(name: string): ResourceHandle {
    const h = this.resourceHandles.get(name);
    if (!h) throw new TechniqueError(`technique '${this.name}' has no resource '${name}'`);
    return h;
  }

  // ------------------------------------------------------------------------------------------------------------ nodes

  /** Add a compute dispatch. */
  compute(name: string, o: ComputeOptions): this {
    const ctx = this.begin(name);
    const list: BindingDecl[] = [];
    this.collect(list, o.reads, 'read', ctx); this.collect(list, o.writes, 'write', ctx); this.collect(list, o.readWrites, 'readwrite', ctx);
    const d = o.dispatch;
    const dispatch: ComputeNode['dispatch'] = 'threads' in d ? { threads: d.threads.map((t) => this.dim(t, ctx)) }
      : 'like' in d ? { like: this.resource(d.like, ctx).name } : { indirect: this.resource(d.indirect, ctx).name, ...(d.offset !== undefined ? { offset: d.offset } : {}) };
    const node: ComputeNode = { type: 'compute', name, shader: { code: o.shader }, bindings: list, dispatch, ...this.base(o, ctx) };
    if (o.group !== undefined) node.group = o.group;
    if (o.hostGroups) node.hostGroups = o.hostGroups.map((h) => ({ ...h }));
    if (o.entryPoint) node.entryPoint = o.entryPoint;
    if (o.workgroupSize) node.workgroupSize = o.workgroupSize;
    return this.push(node);
  }

  /** Add a draw call (procedural geometry or storage-buffer vertex fetch). */
  draw(name: string, o: DrawOptions): this {
    const ctx = this.begin(name);
    const list: BindingDecl[] = [];
    this.collect(list, o.reads, 'read', ctx);
    const node: DrawNode = {
      type: 'draw', name, shader: { code: o.shader }, bindings: list,
      colorTargets: o.colorTargets.map((t) => (typeof t === 'string' || t instanceof ResourceHandle ? { resource: this.resource(t, ctx).name }
        : (({ resolve, ...rest }) => ({ ...rest, resource: this.resource(t.resource, ctx).name, ...(resolve !== undefined ? { resolve: this.resource(resolve, ctx).name } : {}) }))(t))),
      ...this.base(o, ctx),
    };
    if (o.depthTarget) node.depthTarget = { ...o.depthTarget, resource: this.resource(o.depthTarget.resource, ctx).name };
    if (o.vertices !== undefined) node.vertexCount = this.dim(o.vertices, ctx);
    if (o.vertexBuffers) node.vertexBuffers = o.vertexBuffers.map((v) => ({ ...v, resource: this.resource(v.resource, ctx).name }));
    if (o.indexBuffer) node.indexBuffer = { ...o.indexBuffer, resource: this.resource(o.indexBuffer.resource, ctx).name };
    if (o.baseVertex !== undefined) node.baseVertex = this.dim(o.baseVertex, ctx);
    if (o.indirect) node.indirect = { ...o.indirect, resource: this.resource(o.indirect.resource, ctx).name };
    if (o.indices !== undefined) node.indexCount = this.dim(o.indices, ctx);
    if (o.instances !== undefined) node.instanceCount = this.dim(o.instances, ctx);
    if (o.group !== undefined) node.group = o.group;
    if (o.hostGroups) node.hostGroups = o.hostGroups.map((h) => ({ ...h }));
    if (o.vertexEntry) node.vertexEntry = o.vertexEntry;
    if (o.fragmentEntry) node.fragmentEntry = o.fragmentEntry;
    if (o.topology) node.topology = o.topology;
    if (o.cullMode) node.cullMode = o.cullMode;
    return this.push(node);
  }

  /**
   * Add a render pass whose draws the host records (`record` receives a {@link TrackedRenderPass}): the technique owns the attachments and ordering, the host owns the pipelines,
   * bind groups and geometry of each draw. Code only (not storable as JSON).
   */
  renderPass(name: string, o: RenderPassOptions): this {
    const ctx = this.begin(name);
    const node: RenderPassNode = {
      type: 'render', name, ...(o.record ? { record: o.record } : {}), ...this.base(o, ctx),
      colorTargets: (o.colorTargets ?? []).map((t) => (typeof t === 'string' || t instanceof ResourceHandle ? { resource: this.resource(t, ctx).name }
        : (({ resolve, ...rest }) => ({ ...rest, resource: this.resource(t.resource, ctx).name, ...(resolve !== undefined ? { resolve: this.resource(resolve, ctx).name } : {}) }))(t))),
    };
    if (o.depthTarget) node.depthTarget = { ...o.depthTarget, resource: this.resource(o.depthTarget.resource, ctx).name };
    if (o.uses) node.uses = o.uses.map((u) => ({ ...u, resource: this.resource(u.resource, ctx).name }));
    this.push(node);
    for (const sg of o.segments ?? []) this.passSegment(name, sg.name, sg);
    return this;
  }

  /**
   * Add an ordered segment to the render node `pass` declared earlier: a part of its draws that one feature or system contributes. Segments are recorded after the node's own
   * `record`, in the order they are added, through the same tracking wrapper; their `uses` count as the pass's.
   */
  passSegment(pass: string, name: string, o: PassSegmentOptions): this {
    const ctx = `technique '${this.name}', render node '${pass}', segment '${name}'`;
    const node = this.nodes.find((n) => n.type === 'render' && n.name === pass) as RenderPassNode | undefined;
    if (!node) throw new TechniqueError(`${ctx}: there is no render node '${pass}' to add a segment to`);
    if (node.segments?.some((sg) => sg.name === name)) throw new TechniqueError(`${ctx}: the pass already has a segment of that name`);
    (node.segments ??= []).push({ name, record: o.record, ...(o.uses ? { uses: o.uses.map((u) => ({ ...u, resource: this.resource(u.resource, ctx).name })) } : {}) });
    return this;
  }

  /**
   * Copy between two resources: texture to texture (same format), buffer to buffer, texture to buffer or buffer to texture. Without options it copies what the two have in common
   * from the start (textures of the same format and size, mip 0); `from` / `to` name the mip, origin, byte offset or row layout of each side and `size` the extent (entries may be variables).
   */
  copy(name: string, source: ResourceRef, dest: ResourceRef, o: CopyOptions = {}): this {
    const ctx = this.begin(name);
    const node: CopyNode = { type: 'copy', name, source: this.resource(source, ctx).name, dest: this.resource(dest, ctx).name, ...this.base(o, ctx) };
    if (o.from) node.from = { ...o.from };
    if (o.to) node.to = { ...o.to };
    if (o.size) node.size = o.size.map((d) => this.dim(d, ctx));
    return this.push(node);
  }

  /** Zero a range of a buffer (default: all of it). */
  clear(name: string, resource: ResourceRef, o: ClearOptions = {}): this {
    const ctx = this.begin(name);
    const node: ClearNode = { type: 'clear', name, resource: this.resource(resource, ctx).name, ...this.base(o, ctx) };
    if (o.offset !== undefined) node.offset = o.offset;
    if (o.size !== undefined) node.size = this.dim(o.size, ctx);
    return this.push(node);
  }

  /** Run another technique (a builder, a finished technique, or a registry name) as part of this one. */
  subgraph(name: string, technique: TechniqueBuilder | Technique | string, o: SubGraphOptions = {}): this {
    const ctx = this.begin(name);
    const map = (record: Record<string, ResourceRef> | undefined) => record && Object.fromEntries(Object.entries(record).map(([k, v]) => [k, this.resource(v, ctx).name]));
    const variables = o.variables && Object.fromEntries(Object.entries(o.variables).map(([k, v]) => [k, v instanceof VariableHandle ? { bind: this.ownVariable(v, ctx).name } : { value: v }]));
    const node: NodeDecl = {
      type: 'subgraph', name, technique: technique instanceof TechniqueBuilder ? technique.build() : technique,
      ...(o.inputs ? { inputs: map(o.inputs) } : {}), ...(o.outputs ? { outputs: map(o.outputs) } : {}), ...(variables ? { variables } : {}),
      ...(o.loop !== undefined ? { loop: o.loop instanceof VariableHandle ? { variable: this.ownVariable(o.loop, ctx).name } : o.loop } : {}),
      ...this.base(o, ctx),
    };
    return this.push(node);
  }

  /** Add engine code (not storable as JSON): it declares what it reads and writes and records its own commands. */
  callback(name: string, o: CallbackOptions): this {
    const ctx = this.begin(name);
    const node: CallbackNode = {
      type: 'callback', name, execute: o.execute,
      reads: (o.reads ?? []).map((r) => this.resource(r, ctx).name), writes: (o.writes ?? []).map((r) => this.resource(r, ctx).name), ...this.base(o, ctx),
    };
    return this.push(node);
  }

  // ------------------------------------------------------------------------------------------------------------ results

  /**
   * Identifies the shape of a technique made of callback nodes only: node names, what each reads and writes, conditions and `keep`. Two builders with the same
   * key compile to the same plan, so a frame that declares the same passes again can reuse the previous instance (see `FrameGraph`).
   */
  callbackKey(): string {
    return this.nodes.map((n) => {
      if (n.type !== 'callback') throw new TechniqueError(`technique '${this.name}': callbackKey needs callback nodes only ('${n.name}' is a ${n.type} node)`);
      return `${n.name}|${(n.reads ?? []).join(',')}|${(n.writes ?? []).join(',')}|${n.sideEffect ? 1 : 0}`;
    }).join(';');
  }

  /** The callback nodes' `execute` functions by node name (what a reused instance needs to run this frame's closures). */
  callbacks(): [string, (encoder: GPUCommandEncoder) => void][] {
    return this.nodes.map((n) => [n.name, (n as CallbackNode).execute]);
  }

  /** The finished technique (a copy: later changes to the builder do not affect it). */
  build(): Technique {
    return {
      name: this.name,
      // variables and resources are plain data: copy them deeply so the result cannot be changed through the builder
      ...(this.variables.length ? { variables: JSON.parse(JSON.stringify(this.variables)) as VariableDecl[] } : {}),
      ...(this.resources.length ? { resources: JSON.parse(JSON.stringify(this.resources)) as (TextureDecl | BufferDecl)[] } : {}),
      nodes: this.nodes.map((n) => ({ ...n })),
    };
  }

  /** Compile now, to surface validation errors and warnings early. */
  compile(options: CompileOptions = {}): CompiledTechnique { return compileTechnique(this.build(), options); }

  /** Compile and create the GPU resources: shorthand for `TechniqueInstance.create(gpu, this.build(), options)`. */
  instantiate(gpu: TechniqueHost, options: TechniqueInstanceOptions = {}): TechniqueInstance { return TechniqueInstance.create(gpu, this.build(), options); }

  /** The technique as JSON text (fails if it contains callback nodes). */
  toJSON(): string { return techniqueToJSON(this.build()); }

  /** Register this technique by name, for sub-graph nodes written with strings. */
  registerIn(registry: TechniqueRegistry): this { registry[this.name] = this.build(); return this; }

  // ------------------------------------------------------------------------------------------------------------ internals

  private begin(name: string): string {
    if (!name) throw new TechniqueError(`technique '${this.name}': a node needs a name`);
    if (this.nodeNames.has(name)) throw new TechniqueError(`technique '${this.name}': node '${name}' is already declared`);
    return `technique '${this.name}', node '${name}'`;
  }

  private push(node: NodeDecl): this {
    this.nodeNames.add(node.name);
    this.nodes.push(node);
    return this;
  }

  private base(o: NodeOptions, ctx: string): { condition?: NodeCondition; sideEffect?: boolean } {
    if (o.when) this.ownVariableName(o.when.variable, ctx);
    return { ...(o.when ? { condition: o.when } : {}), ...(o.keep ? { sideEffect: true } : {}) };
  }

  /** Resolve a handle or name to a resource of this builder. */
  private resource(ref: ResourceRef, ctx: string): ResourceHandle {
    if (typeof ref === 'string') {
      const h = this.resourceHandles.get(ref);
      if (!h) throw new TechniqueError(`${ctx}: resource '${ref}' is not declared`);
      return h;
    }
    if (ref.owner !== this) throw new TechniqueError(`${ctx}: resource '${ref.name}' belongs to another technique builder`);
    return ref;
  }

  private ownVariable(v: VariableHandle, ctx: string): VariableHandle {
    if (v.owner !== this) throw new TechniqueError(`${ctx}: variable '${v.name}' belongs to another technique builder`);
    return v;
  }

  private ownVariableName(name: string, ctx: string): void {
    if (!this.variableHandles.has(name)) throw new TechniqueError(`${ctx}: variable '${name}' is not declared`);
  }

  private dim(d: Dim, ctx: string): SizeDim {
    if (d instanceof VariableHandle) return { variable: this.ownVariable(d, ctx).name };
    if (typeof d === 'number') return d;
    this.ownVariableName(d.variable, ctx);
    return d;
  }

  private collect(out: BindingDecl[], refs: BindingRef[] | undefined, access: BindingAccess, ctx: string): void {
    for (const ref of refs ?? []) {
      const plain = typeof ref === 'string' || ref instanceof ResourceHandle;
      const resource = this.resource(plain ? ref : ref.resource, ctx).name;
      const b: BindingDecl = { resource, access };
      if (!plain) {
        if (ref.name) b.name = ref.name;
        if (ref.sampler) b.sampler = ref.sampler;
        if (ref.mip !== undefined) b.mip = ref.mip;
        if (ref.mipCount !== undefined) b.mipCount = ref.mipCount;
        if (ref.group !== undefined) b.group = ref.group;
        if (ref.uniform) b.uniform = true;
        if (ref.dynamicOffset) b.dynamicOffset = true;
        if (ref.size !== undefined) b.size = ref.size;
      }
      out.push(b);
    }
  }
}
