import { TechniqueBuilder, type BufferHandle, type TextureHandle } from './TechniqueBuilder';
import type { VariableValue } from './Flatten';
import type { TechniqueHost, TechniqueInstance, TechniqueInstanceOptions } from './TechniqueInstance';
import type { ResourceRef } from './TechniqueBuilder';
import type { Technique, VariableType } from './TechniqueTypes';

/** What {@link FrameBuilder.include} needs to run a sub-technique inside the frame. */
export interface IncludeOptions {
  /**
   * The host's object behind each imported resource of the sub-technique, by the sub-technique's name for it. The frame declares it as `<node>/<name>`; give
   * `{ as, resource }` to use a frame-level name several passes share (the depth buffer, the light buffer).
   */
  imports?: Record<string, GPUTexture | GPUBuffer | { as: string; resource: GPUTexture | GPUBuffer }>;
  /** Sub-technique exported resource -> frame resource that receives it. */
  outputs?: Record<string, ResourceRef>;
  /** This frame's values of the sub-technique's variables (the frame declares them as `<node>/<name>`, so the plan survives value changes). */
  variables?: Record<string, VariableValue>;
  /** Keep the nodes even if nothing consumes their outputs. */
  keep?: boolean;
  /** Resources whose producers must run first (see `NodeBase.after`). */
  after?: ResourceRef[];
  /** Frame resources (by their frame names) these nodes produce for the scene passes: see {@link FrameBuilder.publish}. */
  publish?: string[];
}

type Timestamps = GPUComputePassTimestampWrites | GPURenderPassTimestampWrites | undefined;

/** A callback or render node of a technique (or of the sub-techniques inside it): their code is the host's, and a reused frame plan only refreshes the frame's own top-level nodes. */
function hostCodeNode(technique: Technique): { type: string; name: string } | undefined {
  for (const n of technique.nodes) {
    if (n.type === 'callback' || n.type === 'render') return n;
    if (n.type === 'subgraph' && typeof n.technique === 'object') { const inner = hostCodeNode(n.technique); if (inner) return inner; }
  }
  return undefined;
}

/**
 * One frame's technique under construction: a {@link TechniqueBuilder} that also carries what the frame supplies at run time. The host's textures and buffers are
 * *imported* resources (declared from the object itself, so the declaration always matches), variable values change from frame to frame without changing the plan,
 * and bind groups, dynamic offsets and GPU timestamps are attached to nodes by path. {@link FrameGraph.run} hands all of it to the (possibly reused) instance.
 */
export class FrameBuilder extends TechniqueBuilder {
  /** The host's objects behind the imported resources. */
  readonly imports = new Map<string, GPUTexture | GPUBuffer>();
  readonly values = new Map<string, VariableValue>();
  readonly hostGroups = new Map<string, GPUBindGroup>();
  readonly dynamicOffsets: { node: string; binding: string; offset: number }[] = [];
  private readonly stamps: [string, (path: string) => Timestamps][] = [];
  /** Resources the scene passes (the main pass) must wait for: what shadow, light, fog and particle passes produce. */
  readonly published = new Set<string>();

  /**
   * Declare (once) an imported texture that describes `texture` and supply it. Asking again for the same name with the same texture returns the handle; another texture under
   * a name already in use is a mistake. A cube or array texture is declared as an array of layers.
   */
  importTexture(name: string, texture: GPUTexture): TextureHandle {
    if (this.hasResource(name)) {
      if (this.imports.get(name) !== texture) throw new Error(`frame resource '${name}' is imported twice with different textures`);
      return this.resourceNamed(name) as TextureHandle;
    }
    const layers = texture.depthOrArrayLayers, size = layers > 1 ? [texture.width, texture.height, layers] : [texture.width, texture.height];
    const handle = this.texture(name, {
      format: texture.format, size, visibility: 'imported',
      ...(texture.dimension === '3d' ? { dimension: '3d' as const } : layers > 1 ? { dimension: '2d-array' as const } : {}),
      ...(texture.mipLevelCount > 1 ? { mips: texture.mipLevelCount } : {}),
      ...(texture.sampleCount > 1 ? { samples: texture.sampleCount as 1 | 4 } : {}),
    });
    this.imports.set(name, texture);
    return handle;
  }

  /** Declare (once) an imported buffer of `element` type (`stride` bytes each when the type is a struct) and supply it. The element count is left to the buffer. */
  importBuffer(name: string, buffer: GPUBuffer, element: string, stride?: number): BufferHandle {
    if (this.hasResource(name)) {
      if (this.imports.get(name) !== buffer) throw new Error(`frame resource '${name}' is imported twice with different buffers`);
      return this.resourceNamed(name) as BufferHandle;
    }
    const handle = this.importedBuffer(name, element, stride);
    this.imports.set(name, buffer);
    return handle;
  }

  /** Declare (once) a variable of the frame technique and set its value for this frame. Sub-techniques bind their own variables to it. */
  value(name: string, type: VariableType, value: VariableValue): void {
    if (!this.hasVariable(name)) {
      if (type === 'float4') this.float4(name); else if (type === 'float') this.float(name); else if (type === 'int') this.int(name); else this.uint(name);
    }
    this.values.set(name, value);
  }

  /**
   * Run a finished technique (a pass or system of the engine) as part of the frame. Its imported resources are declared from the host's objects, its variables are
   * declared on the frame and bound, and its nodes join the frame's graph under the path `<node>/...`, ordered by what they really read and write. Pass the same
   * `technique` object every frame (the frame plan is reused only while it is the same object).
   */
  include(node: string, technique: Technique, o: IncludeOptions = {}): void {
    if (!FrameBuilder.checked.has(technique)) {
      const code = hostCodeNode(technique);
      if (code) throw new Error(`frame node '${node}': technique '${technique.name}' has the ${code.type} node '${code.name}', whose code cannot be swapped in when the frame plan is reused; declare such a node on the frame itself`);
      FrameBuilder.checked.add(technique);
    }
    const inputs: Record<string, string> = {};
    for (const decl of technique.resources ?? []) {
      if (decl.visibility !== 'imported') continue;
      const given = o.imports?.[decl.name];
      if (!given) throw new Error(`frame node '${node}': no object was given for the imported resource '${decl.name}' of technique '${technique.name}'`);
      const shared = 'as' in given && !('createView' in given) ? given : undefined;
      const outer = shared ? shared.as : `${node}/${decl.name}`, resource = shared ? shared.resource : (given as GPUTexture | GPUBuffer);
      if (decl.kind === 'texture') this.importTexture(outer, resource as GPUTexture); else this.importBuffer(outer, resource as GPUBuffer, decl.element ?? 'u32', decl.stride);
      inputs[decl.name] = outer;
    }
    const bound: Record<string, string> = {};
    for (const decl of technique.variables ?? []) {
      const outer = `${node}/${decl.name}`;
      this.declareVariable(outer, decl.type);
      this.values.set(outer, o.variables?.[decl.name] ?? decl.value ?? (decl.type === 'float4' ? [0, 0, 0, 0] : 0));
      bound[decl.name] = outer;
    }
    this.pushSubgraph(node, technique, inputs, bound, { outputs: o.outputs, keep: o.keep, after: o.after });
    if (o.publish) this.publish(...o.publish);
  }

  /** Techniques already checked for nodes whose code a reused plan cannot refresh. */
  private static checked = new WeakSet<Technique>();

  /** Say that the passes declared so far produce these frame resources for the scene passes: the main pass is ordered after their producers. */
  publish(...names: string[]): void { for (const name of names) this.published.add(name); }

  /** Supply the bind group of host layout `layout` for every node that declares it. */
  hostGroup(layout: string, bindGroup: GPUBindGroup): void { this.hostGroups.set(layout, bindGroup); }

  /** Set the dynamic offset of a node's binding for this frame. */
  dynamicOffset(node: string, binding: string, offset: number): void { this.dynamicOffsets.push({ node, binding, offset }); }

  /** GPU timestamps for the pass of the node at `path`, or of every node below it (a sub-technique's path is a prefix of its nodes'). Return nothing to skip. */
  timestamps(path: string, writes: (path: string) => Timestamps): void { this.stamps.push([path, writes]); }

  /** The timestamp source `TechniqueInstance.execute` wants: the entry for the node's path, else the entry of the nearest path above it. */
  timestampSource(): ((path: string) => Timestamps) | undefined {
    if (this.stamps.length === 0) return undefined;
    return (path) => {
      let best: [string, (path: string) => Timestamps] | undefined;
      for (const s of this.stamps) if ((path === s[0] || path.startsWith(s[0] + '/')) && (!best || s[0].length > best[0].length)) best = s;
      return best?.[1](path);
    };
  }
}

/**
 * The renderer's frame as one technique. Each frame the renderer (and its features) declares the passes on a fresh builder from `begin()`, then `run` compiles them
 * (dependencies, culling, ordering) and records them in order. Most frames declare the same passes as the one before; then the compiled plan is reused and only
 * the frame's own data (imports, variable values, the passes' code) is handed over, so a steady scene pays for building the list but not for compiling it.
 */
export class FrameGraph {
  private key: string | null = null;
  private instance: TechniqueInstance | null = null;
  private readonly pipelines = new Map<string, GPUComputePipeline | GPURenderPipeline>();

  constructor(private host: TechniqueHost, private name = 'frame', private options: TechniqueInstanceOptions = {}) {}

  /** A fresh builder for one frame's passes. */
  begin(): FrameBuilder {
    return new FrameBuilder(this.name);
  }

  /** Compile the declared passes (or reuse the previous plan if they are the same) and record them into `encoder`. */
  run(builder: FrameBuilder, encoder: GPUCommandEncoder): TechniqueInstance {
    const key = builder.structureKey();
    if (this.instance && key === this.key) this.instance.setHostCode(builder.hostNodes());
    else {
      this.instance?.dispose();
      this.instance = null; this.key = null;   // a failed compile must not leave the freed instance to be reused
      this.instance = builder.instantiate(this.host, { label: this.name, pipelineCache: this.pipelines, ...this.options });
      this.key = key;
    }
    const fx = this.instance;
    for (const [name, resource] of builder.imports) fx.setImport(name, resource);
    for (const [name, value] of builder.values) fx.setVariable(name, value);
    for (const [layout, group] of builder.hostGroups) fx.setHostBindGroup(layout, group);
    for (const { node, binding, offset } of builder.dynamicOffsets) fx.setDynamicOffset(node, binding, offset);
    fx.execute(encoder, { timestampWrites: builder.timestampSource() });
    return fx;
  }

  /** The instance of the last frame (its `plan` lists the order and the culled passes), or null before the first. */
  get last(): TechniqueInstance | null { return this.instance; }

  /** Free the compiled frame (the next `run` builds it again). */
  dispose(): void { this.instance?.dispose(); this.instance = null; this.key = null; }
}
