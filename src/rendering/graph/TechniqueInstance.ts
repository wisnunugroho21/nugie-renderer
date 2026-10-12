import type { GPUContext } from '../../gpu/GPUContext';
import type { PassDesc } from '../RenderGraph';
import { compileTechnique, evalDim, type CompileOptions, type CompiledStep, type CompiledTechnique, type ResolvedBuffer, type ResolvedTexture, type ResourcePlan, type ResourceUse } from './Compile';
import type { VariableValue } from './Flatten';
import { expandShader, sampleTypeOf, writeUniform, type ExpandedShader } from './ShaderTokens';
import { TechniqueError, type BindingDecl, type ComputeNode, type DrawNode, type Technique, type TextureDecl, type VariableVisibility, type VertexBufferBinding } from './TechniqueTypes';

export interface TechniqueInstanceOptions extends CompileOptions {
  /** Host resources for the technique's `imported` resources. They can also be attached (or replaced) later with `setImport`. */
  imports?: Record<string, GPUTexture | GPUBuffer>;
  /** Prefix for GPU object labels. */
  label?: string;
}

type Physical = GPUTexture | GPUBuffer;
const isTexture = (r: Physical): r is GPUTexture => 'createView' in r;

/** Everything created for one step: pipeline, bind group, uniform buffer. */
interface StepRuntime {
  shader: ExpandedShader | null;
  pipeline: GPUComputePipeline | GPURenderPipeline | null;
  layout: GPUBindGroupLayout | null;
  bindGroup: GPUBindGroup | null;
  uniform: GPUBuffer | null;
  uniformData: DataView | null;
  workgroup: [number, number, number];
}

const BLEND: Record<string, GPUBlendState> = {
  alpha: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } },
  additive: { color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } },
};

const WORKGROUP = /@workgroup_size\(\s*(\d+)\s*(?:,\s*(\d+))?\s*(?:,\s*(\d+))?\s*\)/;

/** GPU usage flags for the ways a resource is used. */
function textureUsage(uses: Iterable<ResourceUse>): number {
  let flags = 0;
  for (const u of uses) {
    if (u === 'sampled') flags |= GPUTextureUsage.TEXTURE_BINDING;
    else if (u === 'storage') flags |= GPUTextureUsage.STORAGE_BINDING;
    else if (u === 'render') flags |= GPUTextureUsage.RENDER_ATTACHMENT;
    else if (u === 'copy-src') flags |= GPUTextureUsage.COPY_SRC;
    else if (u === 'copy-dst') flags |= GPUTextureUsage.COPY_DST;
  }
  return flags;
}
function bufferUsage(uses: Iterable<ResourceUse>): number {
  let flags = 0;
  for (const u of uses) {
    if (u === 'sampled' || u === 'storage') flags |= GPUBufferUsage.STORAGE;
    else if (u === 'indirect') flags |= GPUBufferUsage.INDIRECT;
    else if (u === 'vertex') flags |= GPUBufferUsage.VERTEX;
    else if (u === 'index') flags |= GPUBufferUsage.INDEX;
    else if (u === 'copy-src') flags |= GPUBufferUsage.COPY_SRC;
    else if (u === 'copy-dst') flags |= GPUBufferUsage.COPY_DST;
  }
  return flags;
}

/**
 * A technique running on the GPU: the compiled plan, the physical resources (transient ones share memory where lifetimes allow), a
 * pipeline and bind group for every compute / draw node, and the variables' uniform buffers. `execute` records the whole technique
 * into a command encoder. Changing a variable that sizes resources, counts loops or switches nodes recompiles (resources whose
 * description did not change keep their contents); other variables only update uniform buffers and dispatch / draw counts.
 *
 * Variables are written to their uniform buffers with `queue.writeBuffer` when `execute` runs, so run a technique once per submit.
 */
export class TechniqueInstance {
  private compiled!: CompiledTechnique;
  private allocations = new Map<string, Physical>();
  private imports = new Map<string, Physical>();
  private values = new Map<string, VariableValue>();
  private pipelines = new Map<string, GPUComputePipeline | GPURenderPipeline>();
  private runtimes = new Map<CompiledStep, StepRuntime>();
  private dirty = true;
  private bindingsDirty = true;
  private uniformDirty = true;
  /** Number of times the technique was compiled (1 after creation). */
  compileCount = 0;
  private listeners = new Set<(names: string[]) => void>();

  private constructor(readonly gpu: GPUContext, readonly technique: Technique, private options: TechniqueInstanceOptions) {}

  /** Compile `technique` and create its GPU resources. Throws a {@link TechniqueError} if it is invalid. */
  static create(gpu: GPUContext, technique: Technique, options: TechniqueInstanceOptions = {}): TechniqueInstance {
    const instance = new TechniqueInstance(gpu, technique, options);
    for (const [name, resource] of Object.entries(options.imports ?? {})) instance.imports.set(name, resource);
    for (const [name, value] of Object.entries(options.values ?? {})) instance.values.set(name, value);
    instance.build();
    return instance;
  }

  /** The current plan: execution order, lifetimes, memory slots, diagnostics, statistics. */
  get plan(): CompiledTechnique { if (this.dirty) this.build(); return this.compiled; }

  /**
   * Call `fn` after a recompile replaced the GPU object behind some resources (a size variable changed, or a node now needs a usage the old texture lacks);
   * `names` lists the exported resources whose `resource(name)` is now a different object. Hosts that hold a view of an exported texture
   * (a material, a bind group) must refresh it. Returns an unsubscribe function.
   */
  onResourcesReplaced(fn: (names: string[]) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  // ---------------------------------------------------------------------------------------------------------- variables

  /** Set a variable of the technique (a number, or four numbers for float4). */
  setVariable(name: string, value: VariableValue): void {
    const decl = this.technique.variables?.find((v) => v.name === name);
    if (!decl) throw new TechniqueError(`technique '${this.technique.name}' has no variable '${name}'`);
    const same = JSON.stringify(this.values.get(name) ?? this.current(name)) === JSON.stringify(value);
    if (same) return;
    this.values.set(name, value);
    if (this.compiled.structural.has(name)) this.dirty = true;
    else { this.compiled.variables.get(name)!.value = decl.type === 'float4' ? (value as number[]).slice() : Array.isArray(value) ? value[0] : value; this.uniformDirty = true; }
  }

  /** Current value of a variable. */
  getVariable(name: string): VariableValue { return this.current(name); }
  private current(name: string): VariableValue {
    const v = this.compiled.variables.get(name);
    if (!v) throw new TechniqueError(`technique '${this.technique.name}' has no variable '${name}'`);
    return v.value;
  }

  /** The technique's variables, optionally only those of one visibility (`user` ones are what a UI would show). */
  variables(visibility?: VariableVisibility): { name: string; type: string; value: VariableValue; visibility: VariableVisibility }[] {
    return (this.technique.variables ?? [])
      .filter((v) => visibility === undefined || (v.visibility ?? 'user') === visibility)
      .map((v) => ({ name: v.name, type: v.type, value: this.current(v.name), visibility: v.visibility ?? 'user' }));
  }

  // ---------------------------------------------------------------------------------------------------------- resources

  /** Attach (or replace) the host's resource for an `imported` resource. Throws if it cannot serve the nodes that use it. */
  setImport(name: string, resource: GPUTexture | GPUBuffer): void {
    const plan = this.plan.resources.get(name);
    if (!plan || plan.visibility !== 'imported') throw new TechniqueError(`'${name}' is not an imported resource of technique '${this.technique.name}'`);
    this.checkImport(plan, resource);
    this.imports.set(name, resource);
    this.bindingsDirty = true;
  }

  /** The GPU object behind a resource (an exported one after `execute`, or any resource for inspection), if it has one. */
  resource(name: string): GPUTexture | GPUBuffer | undefined {
    const plan = this.plan.resources.get(name);
    if (!plan) throw new TechniqueError(`technique '${this.technique.name}' has no resource '${name}'`);
    return plan.visibility === 'imported' ? this.imports.get(name) : plan.slot >= 0 ? this.allocations.get(this.slotKey(plan.slot)) : undefined;
  }

  private slotKey(slot: number): string { return `${this.compiled.slots[slot].key}`; }

  /** Verify a host resource against what the technique declared and needs. */
  private checkImport(plan: ResourcePlan, resource: Physical): void {
    const what = `imported resource '${plan.name}'`;
    if (plan.decl.kind === 'texture') {
      if (!isTexture(resource)) throw new TechniqueError(`${what} is a texture but a buffer was given`);
      const need = textureUsage(plan.uses), missing = need & ~resource.usage;
      if (missing) throw new TechniqueError(`${what}: the texture lacks usage flags the technique needs (missing 0x${missing.toString(16)}: sampled / storage / render attachment / copy source / copy destination)`);
      const r = plan.resolved as ResolvedTexture | null, d = plan.decl as TextureDecl;
      const format = d.format ?? r?.format;
      if (format && resource.format !== format) throw new TechniqueError(`${what}: expected ${format} but the texture is ${resource.format}`);
      if (resource.sampleCount !== (d.samples ?? 1)) throw new TechniqueError(`${what}: expected ${d.samples ?? 1} sample(s) but the texture has ${resource.sampleCount}`);
      if (r && (resource.width !== r.size[0] || resource.height !== r.size[1])) throw new TechniqueError(`${what}: expected ${r.size[0]}x${r.size[1]} but the texture is ${resource.width}x${resource.height}`);
    } else {
      if (isTexture(resource)) throw new TechniqueError(`${what} is a buffer but a texture was given`);
      const missing = bufferUsage(plan.uses) & ~resource.usage;
      if (missing) throw new TechniqueError(`${what}: the buffer lacks usage flags the technique needs (missing 0x${missing.toString(16)})`);
      const r = plan.resolved as ResolvedBuffer | null;
      if (r && resource.size < r.stride * r.count) throw new TechniqueError(`${what}: the buffer holds ${resource.size} bytes, the technique declares ${r.stride * r.count}`);
    }
  }

  // ---------------------------------------------------------------------------------------------------------- building

  /** Compile with the current variable values and (re)create what changed. */
  private build(): void {
    const values: Record<string, VariableValue> = {};
    for (const [k, v] of this.values) values[k] = v;
    const before = this.compileCount > 0 ? this.snapshotResources() : null;
    this.compiled = compileTechnique(this.technique, { ...this.options, values });
    this.compileCount++;
    this.dirty = false;
    // transient memory plan -> physical resources; an existing allocation with the same key and enough usage flags is kept
    const next = new Map<string, Physical>();
    for (const slot of this.compiled.slots) {
      const plan = this.compiled.resources.get(slot.resources[0])!;
      const old = this.allocations.get(slot.key);
      const label = `${this.options.label ?? this.technique.name}:${slot.resources.join('+')}`;
      if (plan.resolved?.kind === 'texture') {
        const r = plan.resolved;
        // multisampled textures are render targets that cannot be storage textures (the compiler rejects storage use)
        const flags = textureUsage(slot.uses) | (r.samples > 1 ? GPUTextureUsage.RENDER_ATTACHMENT : 0);
        if (old && isTexture(old) && (old.usage & flags) === flags) { next.set(slot.key, old); continue; }
        next.set(slot.key, this.gpu.resources.textures.create({
          label, size: r.dimension === '3d' ? { width: r.size[0], height: r.size[1], depthOrArrayLayers: r.size[2] } : [r.size[0], r.size[1], r.dimension === '2d' ? 1 : r.size[2]],
          dimension: r.dimension === '3d' ? '3d' : '2d', format: r.format, mipLevelCount: r.mips, sampleCount: r.samples, usage: flags | (flags === 0 ? GPUTextureUsage.TEXTURE_BINDING : 0),
        }));
      } else if (plan.resolved?.kind === 'buffer') {
        const flags = bufferUsage(slot.uses);
        if (old && !isTexture(old) && (old.usage & flags) === flags && old.size >= slot.bytes) { next.set(slot.key, old); continue; }
        next.set(slot.key, this.gpu.resources.buffers.create(label, Math.max(4, slot.bytes), flags | (flags === 0 ? GPUBufferUsage.STORAGE : 0)));
      }
    }
    for (const [key, old] of this.allocations) if (next.get(key) !== old) { if (isTexture(old)) this.gpu.resources.textures.destroy(old); else this.gpu.resources.buffers.destroy(old); }
    this.allocations = next;
    for (const [name, resource] of this.imports) { const plan = this.compiled.resources.get(name); if (plan?.visibility === 'imported') this.checkImport(plan, resource); }
    // per-step pipelines and uniforms
    for (const rt of this.runtimes.values()) rt.uniform?.destroy();
    this.runtimes.clear();
    for (const step of this.compiled.steps) this.runtimes.set(step, this.prepareStep(step));
    this.bindingsDirty = true;
    this.uniformDirty = true;
    if (before) {
      // only what a host can hold: exported resources that now live in a different object (internal ones that merely stopped being used do not count)
      const replaced = [...this.compiled.resources.values()].filter((p) => {
        const now = p.visibility === 'exported' ? this.resourceObject(p.name) : undefined;
        return now !== undefined && before.has(p.name) && before.get(p.name) !== now;
      }).map((p) => p.name);
      if (replaced.length) for (const fn of this.listeners) fn(replaced);
    }
  }

  /** The GPU object behind each resource that has one right now. */
  private snapshotResources(): Map<string, Physical> {
    const out = new Map<string, Physical>();
    for (const name of this.compiled.resources.keys()) { const r = this.resourceObject(name); if (r) out.set(name, r); }
    return out;
  }
  private resourceObject(name: string): Physical | undefined {
    const plan = this.compiled.resources.get(name)!;
    return plan.visibility === 'imported' ? this.imports.get(name) : plan.slot >= 0 ? this.allocations.get(this.slotKey(plan.slot)) : undefined;
  }

  /** Expand the shader and create the pipeline of a compute / draw step. */
  private prepareStep(step: CompiledStep): StepRuntime {
    const rt: StepRuntime = { shader: null, pipeline: null, layout: null, bindGroup: null, uniform: null, uniformData: null, workgroup: [8, 8, 1] };
    const node = step.node;
    if (node.type !== 'compute' && node.type !== 'draw') return rt;
    const device = this.gpu.device;
    const ctx = `node '${node.path}'`;
    rt.shader = expandShader(node, this.compiled);
    if (rt.shader.uniform) {
      rt.uniform = device.createBuffer({ label: `${node.path}:variables`, size: rt.shader.uniform.size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      rt.uniformData = new DataView(new ArrayBuffer(rt.shader.uniform.size));
    }
    const visibility = node.type === 'compute' ? GPUShaderStage.COMPUTE : GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    const entries: GPUBindGroupLayoutEntry[] = rt.shader.slots.map((slot) => {
      if (slot.kind === 'variables') return { binding: slot.binding, visibility, buffer: { type: 'uniform' } };
      const plan = this.compiled.resources.get(slot.decl!.resource)!;
      if (slot.kind === 'sampler') {
        const format = (plan.decl as TextureDecl).format ?? (plan.resolved as ResolvedTexture | null)?.format;
        const unfilterable = format ? sampleTypeOf(format) === 'unfilterable-float' || sampleTypeOf(format) === 'uint' || sampleTypeOf(format) === 'sint' : false;
        if (unfilterable && slot.decl!.sampler === 'linear') throw new TechniqueError(`${ctx}: '${slot.decl!.resource}' (${format}) cannot be filtered; use sampler: 'nearest'`);
        return { binding: slot.binding, visibility, sampler: { type: slot.decl!.sampler === 'linear' ? 'filtering' : 'non-filtering' } };
      }
      const b = slot.decl!;
      if (plan.decl.kind === 'buffer') return { binding: slot.binding, visibility, buffer: { type: b.access === 'read' ? 'read-only-storage' : 'storage' } };
      const r = plan.resolved as ResolvedTexture | null, d = plan.decl as TextureDecl;
      const format = d.format ?? r!.format, dimension = (d.dimension ?? r?.dimension ?? '2d') as GPUTextureViewDimension;
      if (b.access === 'read') {
        const multisampled = (r?.samples ?? d.samples ?? 1) > 1, type = sampleTypeOf(format);
        // WebGPU: a multisampled texture cannot be bound as filterable float
        return { binding: slot.binding, visibility, texture: { sampleType: multisampled && type === 'float' ? 'unfilterable-float' : type, viewDimension: dimension, multisampled } };
      }
      return { binding: slot.binding, visibility, storageTexture: { access: b.access === 'write' ? 'write-only' : 'read-write', format, viewDimension: dimension } };
    });
    rt.layout = device.createBindGroupLayout({ label: `${node.path}:layout`, entries });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [rt.layout] });
    const module = this.gpu.resources.shaders.get(`technique:${rt.shader.code}`, rt.shader.code);
    if (node.type === 'compute') {
      const wg = node.workgroupSize ?? WORKGROUP.exec(node.shader.code)?.slice(1).map((v) => (v ? Number(v) : 1));
      if (!wg) throw new TechniqueError(`${ctx}: set workgroupSize (the shader's @workgroup_size is not a plain number)`);
      rt.workgroup = [wg[0] ?? 1, wg[1] ?? 1, wg[2] ?? 1];
      const key = `c|${node.entryPoint ?? 'main'}|${rt.shader.code}`;
      rt.pipeline = (this.pipelines.get(key) as GPUComputePipeline | undefined) ?? device.createComputePipeline({ label: node.path, layout, compute: { module, entryPoint: node.entryPoint ?? 'main' } });
      this.pipelines.set(key, rt.pipeline);
    } else {
      const targets: GPUColorTargetState[] = node.colorTargets.map((t) => {
        const plan = this.compiled.resources.get(t.resource)!;
        const format = (plan.decl as TextureDecl).format ?? (plan.resolved as ResolvedTexture).format;
        const blend = BLEND[t.blend ?? 'none'];
        return blend ? { format, blend } : { format };
      });
      const depth = node.depthTarget && (() => {
        const plan = this.compiled.resources.get(node.depthTarget!.resource)!;
        return { format: ((plan.decl as TextureDecl).format ?? (plan.resolved as ResolvedTexture).format), depthWriteEnabled: node.depthTarget!.write !== false, depthCompare: node.depthTarget!.compare ?? 'less' } as GPUDepthStencilState;
      })();
      const samples = this.sampleCountOf(node);
      const buffers: GPUVertexBufferLayout[] = (node.vertexBuffers ?? []).map((v) => ({
        arrayStride: this.vertexStride(v, ctx), stepMode: v.stepMode ?? 'vertex',
        attributes: v.attributes.map((a) => ({ shaderLocation: a.location, format: a.format, offset: a.offset })),
      }));
      // strip topologies need the index format in the pipeline when drawn indexed
      const stripFormat = node.indexBuffer && /strip$/.test(node.topology ?? '') ? node.indexBuffer.format ?? 'uint32' : undefined;
      const key = `r|${node.vertexEntry}|${node.fragmentEntry}|${node.topology}|${node.cullMode}|${samples}|${stripFormat ?? ''}|${JSON.stringify(buffers)}|${JSON.stringify(targets)}|${JSON.stringify(depth)}|${rt.shader.code}`;
      rt.pipeline = (this.pipelines.get(key) as GPURenderPipeline | undefined) ?? device.createRenderPipeline({
        label: node.path, layout,
        vertex: { module, entryPoint: node.vertexEntry ?? 'vs_main', ...(buffers.length ? { buffers } : {}) },
        fragment: node.colorTargets.length ? { module, entryPoint: node.fragmentEntry ?? 'fs_main', targets } : undefined,
        primitive: { topology: node.topology ?? 'triangle-list', cullMode: node.cullMode ?? 'none', ...(stripFormat ? { stripIndexFormat: stripFormat } : {}) },
        ...(samples > 1 ? { multisample: { count: samples } } : {}),
        ...(depth ? { depthStencil: depth } : {}),
      });
      this.pipelines.set(key, rt.pipeline);
    }
    return rt;
  }

  /** Sample count of a draw's attachments (the compiler guarantees they agree). */
  private sampleCountOf(node: DrawNode): number {
    const first = node.colorTargets[0]?.resource ?? node.depthTarget?.resource;
    if (first === undefined) return 1;
    const plan = this.compiled.resources.get(first)!;
    return (plan.resolved as ResolvedTexture | null)?.samples ?? (plan.decl as TextureDecl).samples ?? 1;
  }

  /** Bytes between the elements of a vertex buffer: the draw's override, else the buffer's element size. */
  private vertexStride(v: VertexBufferBinding, ctx: string): number {
    const stride = v.arrayStride ?? (this.compiled.resources.get(v.resource)!.resolved as ResolvedBuffer | null)?.stride;
    if (stride === undefined) throw new TechniqueError(`${ctx}: vertex buffer '${v.resource}' has no known element size; set arrayStride (or declare 'stride' on the buffer)`);
    return stride;
  }

  /** Elements of a vertex buffer that follow its start offset. */
  private vertexElements(v: VertexBufferBinding, ctx: string): number {
    // a declared buffer may sit in a larger shared allocation, so its declared size wins over the GPU object's
    const declared = (this.compiled.resources.get(v.resource)!.resolved as ResolvedBuffer | null);
    const bytes = declared ? declared.stride * declared.count : (this.physical(v.resource, ctx) as GPUBuffer).size;
    return Math.max(0, Math.floor((bytes - (v.offset ?? 0)) / this.vertexStride(v, ctx)));
  }

  /** The physical resource of a plan (host import or technique allocation). */
  private physical(name: string, context: string): Physical {
    const plan = this.compiled.resources.get(name)!;
    const r = plan.visibility === 'imported' ? this.imports.get(name) : this.allocations.get(this.slotKey(plan.slot));
    if (!r) throw new TechniqueError(`${context}: imported resource '${name}' has not been attached (call setImport('${name}', ...))`);
    return r;
  }

  /** Create the bind group of a step from the current physical resources. */
  private bindStep(step: CompiledStep, rt: StepRuntime): void {
    if (!rt.shader || !rt.layout) return;
    const ctx = `node '${step.node.path}'`;
    const entries: GPUBindGroupEntry[] = rt.shader.slots.map((slot) => {
      if (slot.kind === 'variables') return { binding: slot.binding, resource: { buffer: rt.uniform! } };
      const b = slot.decl as BindingDecl;
      if (slot.kind === 'sampler') return { binding: slot.binding, resource: this.gpu.resources.samplers.get({ magFilter: b.sampler, minFilter: b.sampler, mipmapFilter: b.sampler, addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }) };
      const res = this.physical(b.resource, ctx);
      if (!isTexture(res)) return { binding: slot.binding, resource: { buffer: res } };
      const plan = this.compiled.resources.get(b.resource)!;
      const dimension = ((plan.decl as TextureDecl).dimension ?? (plan.resolved as ResolvedTexture | null)?.dimension ?? '2d') as GPUTextureViewDimension;
      return { binding: slot.binding, resource: res.createView(b.access === 'read' ? { dimension } : { dimension, baseMipLevel: 0, mipLevelCount: 1 }) };
    });
    rt.bindGroup = this.gpu.device.createBindGroup({ label: `${step.node.path}:bindings`, layout: rt.layout, entries });
  }

  // ---------------------------------------------------------------------------------------------------------- execution

  /** Record every live node, in order, into `encoder`. */
  execute(encoder: GPUCommandEncoder): void {
    if (this.dirty) this.build();
    if (this.bindingsDirty) { for (const [step, rt] of this.runtimes) this.bindStep(step, rt); this.bindingsDirty = false; }
    if (this.uniformDirty) {
      for (const rt of this.runtimes.values()) if (rt.uniform && rt.shader?.uniform) { writeUniform(rt.shader.uniform, this.compiled.variables, rt.uniformData!); this.gpu.queue.writeBuffer(rt.uniform, 0, rt.uniformData!.buffer as ArrayBuffer); }
      this.uniformDirty = false;
    }
    for (const step of this.compiled.steps) {
      const node = step.node, rt = this.runtimes.get(step)!;
      switch (node.type) {
        case 'compute': this.runCompute(encoder, node, rt); break;
        case 'draw': this.runDraw(encoder, node, rt); break;
        case 'copy': this.runCopy(encoder, node.path, node.source, node.dest); break;
        case 'callback': node.execute(encoder); break;
      }
    }
  }

  private runCompute(encoder: GPUCommandEncoder, node: ComputeNode & { path: string }, rt: StepRuntime): void {
    const pass = encoder.beginComputePass({ label: node.path });
    pass.setPipeline(rt.pipeline as GPUComputePipeline);
    pass.setBindGroup(0, rt.bindGroup);
    const d = node.dispatch;
    if ('indirect' in d) pass.dispatchWorkgroupsIndirect(this.physical(d.indirect, `node '${node.path}'`) as GPUBuffer, d.offset ?? 0);
    else {
      const threads = 'like' in d
        ? (this.compiled.resources.get(d.like)!.resolved as ResolvedTexture).size
        : d.threads.map((t) => evalDim(t, this.compiled.variables, `node '${node.path}'`));
      const groups = [0, 1, 2].map((i) => Math.ceil((threads[i] ?? 1) / rt.workgroup[i]));
      if (groups.every((g) => g > 0)) pass.dispatchWorkgroups(groups[0], groups[1], groups[2]);
    }
    pass.end();
  }

  private runDraw(encoder: GPUCommandEncoder, node: DrawNode & { path: string }, rt: StepRuntime): void {
    const ctx = `node '${node.path}'`;
    const view = (name: string, mip: number, layer: number) => (this.physical(name, ctx) as GPUTexture).createView({ dimension: '2d', baseMipLevel: mip, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
    const pass = encoder.beginRenderPass({
      label: node.path,
      colorAttachments: node.colorTargets.map((t) => ({
        view: view(t.resource, t.mip ?? 0, t.layer ?? 0), loadOp: t.loadOp ?? 'clear', storeOp: t.storeOp ?? 'store', clearValue: t.clearValue ?? [0, 0, 0, 0],
        ...(t.resolve !== undefined ? { resolveTarget: view(t.resolve, 0, 0) } : {}),
      })),
      ...(node.depthTarget ? {
        depthStencilAttachment: {
          view: (this.physical(node.depthTarget.resource, ctx) as GPUTexture).createView({ dimension: '2d', baseMipLevel: 0, mipLevelCount: 1 }),
          depthLoadOp: node.depthTarget.loadOp ?? 'clear', depthStoreOp: 'store' as const, depthClearValue: node.depthTarget.clearValue ?? 1,
        },
      } : {}),
    });
    pass.setPipeline(rt.pipeline as GPURenderPipeline);
    pass.setBindGroup(0, rt.bindGroup);
    const buffers = node.vertexBuffers ?? [];
    buffers.forEach((v, slot) => pass.setVertexBuffer(slot, this.physical(v.resource, ctx) as GPUBuffer, v.offset ?? 0));
    // counts not given explicitly come from the vertex buffers: every element of the first per-vertex / per-instance buffer
    const first = (mode: GPUVertexStepMode) => buffers.find((v) => (v.stepMode ?? 'vertex') === mode);
    const fromBuffer = (v: VertexBufferBinding | undefined, fallback: number) => (v ? this.vertexElements(v, ctx) : fallback);
    const vertices = node.vertexCount === undefined ? fromBuffer(first('vertex'), 0) : evalDim(node.vertexCount, this.compiled.variables, ctx);
    const instances = node.instanceCount === undefined ? fromBuffer(first('instance'), 1) : evalDim(node.instanceCount, this.compiled.variables, ctx);
    const ib = node.indexBuffer;
    if (node.indirect) {
      if (ib) pass.setIndexBuffer(this.physical(ib.resource, ctx) as GPUBuffer, ib.format ?? 'uint32', ib.offset ?? 0);
      const args = this.physical(node.indirect.resource, ctx) as GPUBuffer, offset = node.indirect.offset ?? 0;
      if (ib) pass.drawIndexedIndirect(args, offset); else pass.drawIndirect(args, offset);
      pass.end();
      return;
    }
    if (ib) {
      const format = ib.format ?? 'uint32', size = format === 'uint16' ? 2 : 4;
      pass.setIndexBuffer(this.physical(ib.resource, ctx) as GPUBuffer, format, ib.offset ?? 0);
      const declared = this.compiled.resources.get(ib.resource)!.resolved as ResolvedBuffer | null;
      const bytes = declared ? declared.stride * declared.count : (this.physical(ib.resource, ctx) as GPUBuffer).size;
      const indices = node.indexCount === undefined ? Math.max(0, Math.floor((bytes - (ib.offset ?? 0)) / size)) : evalDim(node.indexCount, this.compiled.variables, ctx);
      if (indices > 0 && instances > 0) pass.drawIndexed(indices, instances, 0, node.baseVertex === undefined ? 0 : evalDim(node.baseVertex, this.compiled.variables, ctx));
      pass.end();
      return;
    }
    if (vertices > 0 && instances > 0) pass.draw(vertices, instances);
    pass.end();
  }

  private runCopy(encoder: GPUCommandEncoder, path: string, source: string, dest: string): void {
    const ctx = `node '${path}'`, from = this.physical(source, ctx), to = this.physical(dest, ctx);
    if (isTexture(from) && isTexture(to)) {
      encoder.copyTextureToTexture({ texture: from }, { texture: to }, [Math.min(from.width, to.width), Math.min(from.height, to.height), Math.min(from.depthOrArrayLayers, to.depthOrArrayLayers)]);
    } else if (!isTexture(from) && !isTexture(to)) encoder.copyBufferToBuffer(from, 0, to, 0, Math.min(from.size, to.size));
  }

  /** This technique as a pass of a `RenderGraph`; `reads` / `writes` are the graph's logical names for what the technique consumes and produces. */
  asPass(pass: { name?: string; reads?: string[]; writes?: string[]; sideEffect?: boolean } = {}): PassDesc {
    return { name: pass.name ?? this.technique.name, reads: pass.reads, writes: pass.writes, sideEffect: pass.sideEffect, execute: (encoder) => this.execute(encoder) };
  }

  /** Free every GPU object the instance created (imported resources are the host's and stay). */
  dispose(): void {
    for (const r of this.allocations.values()) { if (isTexture(r)) this.gpu.resources.textures.destroy(r); else this.gpu.resources.buffers.destroy(r); }
    this.allocations.clear();
    for (const rt of this.runtimes.values()) rt.uniform?.destroy();
    this.runtimes.clear();
    this.dirty = true;
  }
}
