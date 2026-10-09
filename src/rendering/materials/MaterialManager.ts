import type { GPUResources } from '../../gpu/GPUResources';
import type { BindLayouts } from '../../gpu/BindLayouts';
import { pipelineKeyString, type PipelineKey } from '../../gpu/PipelineCache';
import { ShaderManager } from '../../gpu/ShaderManager';
import { COMMON_PRELUDE, ERROR_SOURCE, PBR_SOURCE, registerEngineShaderChunks } from '../../shaders';
import { STANDARD_VERTEX_LAYOUT, toGPUVertexBuffers } from '../VertexLayouts';
import { MaterialFeature, MaterialRecordFlags, featureDefines } from './MaterialFlags';
import { EXT_VEC4, needsExtParams, packPBRExt, pbrFeatureMask, type TexPresence } from './PBRExtension';
import { DeformMask } from '../MeshManager';
import {
  TextureSlot, TEXTURE_SLOT_COUNT,
  type CustomMaterialDesc, type Material, type PBRMaterialDesc, type ParamValues,
  type RenderQueue, type TextureRef, type TextureSlots,
} from './Material';
import {
  generateParamAccessors, hashString, layoutParams, packParams, validateCustomShader, type ParamLayout,
} from './CustomShader';

const RECORD_WORDS = 16; // 64 bytes (matches MaterialRecord in common_types.wgsl)
const TEX_SLOTS = TEXTURE_SLOT_COUNT;

export interface PassTarget {
  /** null for depth-only passes. */
  colorFormat: GPUTextureFormat | null;
  depthFormat: GPUTextureFormat;
  sampleCount: number;
  /** Depth was laid down by a prepass: opaque / alpha-masked pipelines test 'equal' and do not write depth. */
  depthEqual?: boolean;
  /** The view is mirrored (planar reflection): triangle winding is reversed, so front faces are clockwise. */
  flipWinding?: boolean;
}

export class MaterialError extends Error {
  /** `details` lists the individual validation problems (appended to the message). */
  constructor(message: string, readonly details: string[] = []) { super(message + (details.length ? `: ${details.join('; ')}` : '')); }
}

const ALPHA_BLEND: GPUBlendState = {
  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

/**
 * Shared material runtime. Every material (PBR, custom, error) is one 64-byte record in ONE shared MaterialBuffer; custom
 * parameters live in the same buffer, in a region after the records (viewed as vec4s: see `paramVec4` in common_bind_material.wgsl).
 * Material id == record index. Per-material GPU state is only a (cached) bind group of textures.
 */
export class MaterialManager {
  readonly materials: Material[] = [];
  readonly shaderErrors: string[] = [];
  /** Bumped whenever a shared buffer is reallocated (bind groups rebuild). */
  generation = 0;
  uploadedBytes = 0;
  /** Material ids that are always valid. */
  readonly defaultMaterial: number;
  readonly errorMaterial: number;

  materialBuffer: GPUBuffer;

  private recCap = 64;
  private recBuf = new ArrayBuffer(this.recCap * RECORD_WORDS * 4);
  private recF32 = new Float32Array(this.recBuf);
  private recU32 = new Uint32Array(this.recBuf);
  private recDirtyMin = Infinity;
  private recDirtyMax = -1;

  private paramCapVec4 = 256;
  private paramF32 = new Float32Array(this.paramCapVec4 * 4);
  private paramUsedVec4 = 0;
  private paramDirtyMin = Infinity;
  private paramDirtyMax = -1;

  private layouts_ = new Map<string, ParamLayout>(); // by shaderId
  private customSources = new Map<string, string>(); // shaderId -> full WGSL
  private sortIds = new Map<string, number>();
  // depth-only / aux / shadow pipelines, created on first use
  private prepassPipelines = new Map<string, GPURenderPipeline>();
  private auxPipelines = new Map<string, GPURenderPipeline>();
  private shadowPipelines = new Map<string, GPURenderPipeline>();
  private defaults!: { white: TextureRef; flatNormal: TextureRef; blackCube: GPUTextureView };

  /** Create the shared material / parameter buffers, the 1x1 default textures, the default PBR material and the error material. */
  constructor(private device: GPUDevice, private res: GPUResources, private layouts: BindLayouts) {
    registerEngineShaderChunks(res.shaders);
    this.createDefaultTextures();
    this.materialBuffer = this.makeMaterialBuffer();
    this.defaultMaterial = this.createPBR({ name: 'default', baseColor: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.6 });
    this.errorMaterial = this.createErrorMaterial();
  }

  // ---------------------------------------------------------------- creation

  /** Create a PBR material (any shading model; the description selects the shader variant). Returns its id. */
  createPBR(desc: PBRMaterialDesc = {}): number {
    const t = desc.textures;
    const alphaMode = desc.alphaMode ?? (t?.alpha ? 'BLEND' : 'OPAQUE');
    const full: PBRMaterialDesc = { ...desc, alphaMode };
    const features = pbrFeatureMask(full, this.presenceOf(t), !!desc.environment);
    const m = this.newMaterial({
      name: desc.name ?? `pbr${this.materials.length}`, kind: 'pbr',
      queue: alphaMode === 'BLEND' ? 'transparent' : alphaMode === 'MASK' ? 'alphaMask' : 'opaque',
      alphaMode, doubleSided: desc.doubleSided ?? false, features, shaderId: 'pbr',
      vertexEntry: 'vs_main', fragmentEntry: 'fs_main', depthEntry: null,
      state: {
        cullMode: desc.doubleSided ? 'none' : 'back',
        blend: alphaMode === 'BLEND' ? ALPHA_BLEND : null,
        depthWrite: alphaMode !== 'BLEND',
        depthCompare: 'less',
      },
      passes: { main: true, depth: alphaMode !== 'BLEND', shadow: alphaMode !== 'BLEND' },
      samplerDesc: desc.sampler ?? DEFAULT_SAMPLER,
    });
    this.setTextureRaw(m, TextureSlot.BaseColor, t?.baseColor ?? null);
    this.setTextureRaw(m, TextureSlot.MetalRough, t?.metalRough ?? null);
    this.setTextureRaw(m, TextureSlot.Normal, t?.normal ?? null);
    this.setTextureRaw(m, TextureSlot.Occlusion, t?.occlusion ?? null);
    this.setTextureRaw(m, TextureSlot.Emissive, t?.emissive ?? null);
    this.setTextureRaw(m, TextureSlot.Height, t?.height ?? null);
    this.setTextureRaw(m, TextureSlot.Alpha, t?.alpha ?? null);
    this.setTextureRaw(m, TextureSlot.Aux, t?.aux ?? null);
    m.environment = desc.environment ?? null;
    m.pbr = { ...desc };                      // as given: an alpha mode the caller left out stays "unspecified" (an alpha map may still switch it to BLEND)
    this.applyExtParams(m);
    this.writeRecord(m.id, full);
    return m.id;
  }

  /** Which optional textures a texture-slot list contains (they select shader variants). */
  private presenceOf(t: PBRMaterialDesc['textures'] | undefined): TexPresence {
    return { normal: !!t?.normal, height: !!t?.height, alpha: !!t?.alpha, aux: !!t?.aux };
  }

  /** Allocate (once) and fill the extension parameter block of a PBR material that uses any extension. */
  private applyExtParams(m: Material): void {
    const d = m.pbr;
    if (!d || !needsExtParams(m.features, d)) return;
    if (m.paramCount === 0) { m.paramCount = EXT_VEC4; m.paramBase = this.allocParams(EXT_VEC4); }
    packPBRExt(d, this.paramF32, m.paramBase);
    this.paramDirtyMin = Math.min(this.paramDirtyMin, m.paramBase);
    this.paramDirtyMax = Math.max(this.paramDirtyMax, m.paramBase + m.paramCount - 1);
  }

  /** Recompute a PBR material's shader features after its description, textures or environment changed. */
  private refreshPBRFeatures(m: Material): void {
    if (m.kind !== 'pbr' || !m.pbr) return;
    const tex = { normal: !!m.textures[TextureSlot.Normal], height: !!m.textures[TextureSlot.Height], alpha: !!m.textures[TextureSlot.Alpha], aux: !!m.textures[TextureSlot.Aux] };
    m.features = pbrFeatureMask({ ...m.pbr, alphaMode: m.alphaMode }, tex, !!m.environment);
    this.refreshSortId(m);
  }

  /** Register a custom WGSL material (validated first; throws MaterialError). Returns its id. Parameters are read through generated `param_<name>(base)` accessors. */
  createCustom(desc: CustomMaterialDesc): number {
    const vs = desc.vertexEntry ?? 'vs_main', fs = desc.fragmentEntry ?? 'fs_main';
    const errors = validateCustomShader(desc.wgsl, vs, fs, desc.depthEntry ? [desc.depthEntry] : []);
    if (errors.length) throw new MaterialError(`Custom material '${desc.name}' rejected`, errors);

    const schema = desc.params ?? [];
    const layout = layoutParams(schema);
    const shaderId = `custom:${hashString(desc.wgsl + JSON.stringify(schema) + vs + fs)}`;
    if (!this.customSources.has(shaderId)) {
      this.layouts_.set(shaderId, layout);
      this.customSources.set(shaderId, COMMON_PRELUDE + generateParamAccessors(layout) + '\n' + desc.wgsl);
    }
    const blend = desc.blend === undefined ? null : desc.blend;
    const queue: RenderQueue = desc.queue ?? (blend ? 'transparent' : 'opaque');
    const m = this.newMaterial({
      name: desc.name, kind: 'custom', queue,
      alphaMode: blend ? 'BLEND' : 'OPAQUE', doubleSided: desc.cullMode === 'none', features: 0, shaderId,
      vertexEntry: vs, fragmentEntry: fs, depthEntry: desc.depthEntry ?? null,
      state: {
        cullMode: desc.cullMode ?? 'back', blend,
        depthWrite: desc.depthWrite ?? !blend, depthCompare: desc.depthCompare ?? 'less',
      },
      passes: { main: true, depth: desc.passes?.depth ?? false, shadow: desc.passes?.shadow ?? false },
      samplerDesc: desc.sampler ?? DEFAULT_SAMPLER,
    });
    m.paramSchema = schema;
    m.paramCount = layout.vec4Count;
    m.paramBase = this.allocParams(layout.vec4Count);
    for (let s = 0; s < TEX_SLOTS; s++) this.setTextureRaw(m, s, desc.textures?.[s] ?? null);
    this.writeRecord(m.id, {}, MaterialRecordFlags.Custom);
    if (desc.values) this.setParams(m.id, desc.values);
    return m.id;
  }

  /** Create the bright fallback material shown when a custom shader fails to build. */
  private createErrorMaterial(): number {
    this.customSources.set('error', ERROR_SOURCE);
    const m = this.newMaterial({
      name: 'error', kind: 'error', queue: 'opaque', alphaMode: 'OPAQUE', doubleSided: true, features: 0, shaderId: 'error',
      vertexEntry: 'vs_main', fragmentEntry: 'fs_main', depthEntry: null,
      state: { cullMode: 'none', blend: null, depthWrite: true, depthCompare: 'less' },
      passes: { main: true, depth: false, shadow: false }, samplerDesc: DEFAULT_SAMPLER,
    });
    for (let s = 0; s < TEX_SLOTS; s++) this.setTextureRaw(m, s, null);
    this.writeRecord(m.id, {});
    return m.id;
  }

  /** Allocate a material record (growing the shared buffer if needed) and add it to the registry. */
  private newMaterial(p: Omit<Material, 'id' | 'textures' | 'paramBase' | 'paramCount' | 'paramSchema' | 'version' | 'failed' | 'pipelineSortId' | 'environment' | 'pbr'>): Material {
    const id = this.materials.length;
    if (id >= this.recCap) this.growRecords(id + 1);
    const m: Material = {
      ...p, id, textures: new Array(TEX_SLOTS).fill(null) as TextureSlots,
      paramBase: 0, paramCount: 0, paramSchema: [], version: 0, failed: false, pipelineSortId: 0, environment: null, pbr: null,
    };
    this.materials.push(m);
    this.refreshSortId(m);
    return m;
  }

  // ---------------------------------------------------------------- mutation

  /**
   * Update a PBR material: scalar data, shading model and extension parameters (partial updates merge with what was set before).
   * Changing something that selects shader code (alpha mode, an extension switching on / off, the environment) switches the material to
   * another pipeline variant; plain value changes only rewrite data.
   */
  setPBR(id: number, desc: PBRMaterialDesc): void {
    const m = this.materials[id];
    if (m.kind !== 'pbr' || !m.pbr) throw new Error('setPBR on non-PBR material');
    const { textures: _ignored, ...scalars } = desc;
    void _ignored;
    const merged: PBRMaterialDesc = { ...m.pbr, ...scalars };
    if (desc.alphaMode !== undefined && desc.alphaMode !== m.alphaMode) {
      m.alphaMode = desc.alphaMode;
      m.queue = desc.alphaMode === 'BLEND' ? 'transparent' : desc.alphaMode === 'MASK' ? 'alphaMask' : 'opaque';
      m.state = { ...m.state, blend: desc.alphaMode === 'BLEND' ? ALPHA_BLEND : null, depthWrite: desc.alphaMode !== 'BLEND' };
      m.passes.depth = m.passes.shadow = desc.alphaMode !== 'BLEND';
    }
    if (desc.doubleSided !== undefined) {
      m.doubleSided = desc.doubleSided;
      m.state = { ...m.state, cullMode: desc.doubleSided ? 'none' : 'back' };
    }
    if (desc.environment !== undefined) { m.environment = desc.environment; m.version++; }
    merged.alphaMode = m.alphaMode;
    m.pbr = merged;
    this.refreshPBRFeatures(m);
    this.applyExtParams(m);
    this.writeRecord(id, merged);
  }

  /** Bind `tex` (or null = default) to texture slot `slot` of material `id`; slots that select shader code (normal, height, alpha, aux) switch the pipeline variant. */
  setTexture(id: number, slot: number, tex: TextureRef | null): void {
    const m = this.materials[id];
    this.setTextureRaw(m, slot, tex);
    m.version++;
    if (m.kind === 'pbr') {
      if (slot === TextureSlot.Alpha && tex && !m.pbr?.alphaMode && m.alphaMode === 'OPAQUE') this.setPBR(id, { alphaMode: 'BLEND' });
      this.refreshPBRFeatures(m);
      this.applyExtParams(m);
      if (m.pbr) this.writeRecord(id, m.pbr);
    }
  }

  /** Set custom parameter values (partial updates allowed). Pure data write: no pipeline impact. */
  setParams(id: number, values: ParamValues): void {
    const m = this.materials[id];
    const layout = this.layouts_.get(m.shaderId);
    if (m.kind !== 'custom' || !layout) throw new Error('setParams on non-custom material');
    packParams(layout, values, this.paramF32, m.paramBase * 4);
    this.paramDirtyMin = Math.min(this.paramDirtyMin, m.paramBase);
    this.paramDirtyMax = Math.max(this.paramDirtyMax, m.paramBase + m.paramCount - 1);
  }

  // ---------------------------------------------------------------- GPU data

  /** Upload only the dirty record/param ranges. Call once per frame before drawing. */
  flush(): void {
    if (this.recDirtyMax >= 0) {
      const first = this.recDirtyMin, last = this.recDirtyMax;
      this.device.queue.writeBuffer(this.materialBuffer, first * RECORD_WORDS * 4, this.recBuf, first * RECORD_WORDS * 4, (last - first + 1) * RECORD_WORDS * 4);
      this.uploadedBytes += (last - first + 1) * RECORD_WORDS * 4;
      this.recDirtyMin = Infinity; this.recDirtyMax = -1;
    }
    if (this.paramDirtyMax >= 0) {
      const first = this.paramDirtyMin, last = this.paramDirtyMax;
      this.device.queue.writeBuffer(this.materialBuffer, this.recCap * RECORD_WORDS * 4 + first * 16, this.paramF32.buffer, first * 16, (last - first + 1) * 16);
      this.uploadedBytes += (last - first + 1) * 16;
      this.paramDirtyMin = Infinity; this.paramDirtyMax = -1;
    }
  }

  /** Group-2 bind group for a material (cached; invalidated by buffer growth or texture changes). */
  getBindGroup(id: number): GPUBindGroup {
    const m = this.materials[id];
    const key = `mat:m${this.managerId}:${id}:v${m.version}:g${this.generation}`;
    return this.res.bindGroups.get(key, () => this.device.createBindGroup({
      label: key, layout: this.layouts.material,
      entries: [
        { binding: 0, resource: { buffer: this.materialBuffer } },
        { binding: 1, resource: this.res.samplers.get(m.samplerDesc) },
        ...m.textures.map((t, s) => ({
          binding: 2 + s,
          resource: (t ?? (s === TextureSlot.Normal ? this.defaults.flatNormal : this.defaults.white)).view,
        })),
        { binding: 2 + TEX_SLOTS, resource: m.environment ? m.environment.specularView : this.defaults.blackCube },
      ],
    }));
  }

  /**
   * Cached render pipeline for a material in a given pass target. `deformMask` (DeformMask bits, from the MESH)
   * selects the static / skinned / morphed / skinned+morphed vertex variant. Built on first use and cached after that (`warmup` builds them ahead of time).
   */
  getPipeline(id: number, target: PassTarget, deformMask = 0): GPURenderPipeline {
    let m = this.materials[id];
    if (m.failed) m = this.materials[this.errorMaterial];
    const key = this.pipelineKey(m, target, deformMask);
    return this.res.pipelines.getRender(key, () => this.createPipeline(m, target, key, deformMask));
  }

  /** True when the pass follows a depth prepass for this material (so it only shades pixels whose depth matches). */
  private prepassed(m: Material, t: PassTarget): boolean { return !!t.depthEqual && m.queue !== 'transparent'; }
  /** Depth writes are disabled after a prepass; otherwise the material's own setting. */
  private depthWrite(m: Material, t: PassTarget): boolean { return this.prepassed(m, t) ? false : m.state.depthWrite; }
  /** 'equal' after a prepass; otherwise the material's own comparison. */
  private depthCompare(m: Material, t: PassTarget): GPUCompareFunction { return this.prepassed(m, t) ? 'equal' : m.state.depthCompare; }

  /** Depth-only pipeline matching the main pass geometry exactly (same vertex shader, no bias); alpha-masked PBR keeps cutouts. */
  getPrepassPipeline(id: number, deformMask: number, depthFormat: GPUTextureFormat, sampleCount = 1): GPURenderPipeline {
    let m = this.materials[id];
    if (m.failed) m = this.materials[this.errorMaterial];
    const features = m.features | deformFeatures(deformMask);
    const masked = m.shaderId === 'pbr' && m.queue === 'alphaMask';
    const key = `${ShaderManager.key(m.shaderId, featureDefines(features))}|${m.vertexEntry}|${masked}|${m.state.cullMode}|${depthFormat}|${sampleCount}`;
    let p = this.prepassPipelines.get(key);
    if (p) return p;
    const source = m.shaderId === 'pbr' ? PBR_SOURCE : this.customSources.get(m.shaderId)!;
    const module = this.res.shaders.get(m.shaderId, source, featureDefines(features));
    p = this.device.createRenderPipeline({
      label: `prepass:${key}`, layout: this.layouts.pipelineLayout,
      vertex: { module, entryPoint: m.vertexEntry, buffers: toGPUVertexBuffers(STANDARD_VERTEX_LAYOUT) },
      fragment: masked ? { module, entryPoint: 'fs_shadow', targets: [] } : undefined,
      primitive: { topology: 'triangle-list', cullMode: m.state.cullMode, frontFace: 'ccw' },
      depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: m.state.depthCompare },
      multisample: { count: sampleCount },
    });
    this.prepassPipelines.set(key, p);
    return p;
  }

  /**
   * Pipeline of the "aux" pass that writes view-space normal / roughness / metallic for SSAO and SSR (opaque and alpha-masked PBR
   * materials only: returns null for custom shaders and blended materials). Depth-tests against the main pass depth, writes none.
   */
  getAuxPipeline(id: number, deformMask: number, depthFormat: GPUTextureFormat, sampleCount: number, auxFormat: GPUTextureFormat): GPURenderPipeline | null {
    const m = this.materials[id];
    if (m.failed || m.shaderId !== 'pbr' || m.queue === 'transparent') return null;
    const features = m.features | deformFeatures(deformMask);
    const key = `${ShaderManager.key(m.shaderId, featureDefines(features))}|${m.vertexEntry}|${m.state.cullMode}|${depthFormat}|${sampleCount}|${auxFormat}`;
    let p = this.auxPipelines.get(key);
    if (p) return p;
    const module = this.res.shaders.get(m.shaderId, PBR_SOURCE, featureDefines(features));
    p = this.device.createRenderPipeline({
      label: `aux:${key}`, layout: this.layouts.pipelineLayout,
      vertex: { module, entryPoint: m.vertexEntry, buffers: toGPUVertexBuffers(STANDARD_VERTEX_LAYOUT) },
      fragment: { module, entryPoint: 'fs_aux', targets: [{ format: auxFormat }] },
      primitive: { topology: 'triangle-list', cullMode: m.state.cullMode, frontFace: 'ccw' },
      depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'less-equal' },
      multisample: { count: sampleCount },
    });
    this.auxPipelines.set(key, p);
    return p;
  }

  /** A streamed texture changed its GPU view: invalidate the bind groups of the materials that use it. */
  textureChanged(ref: TextureRef): void { for (const m of this.materials) if (m.textures.includes(ref)) m.version++; }

  private static nextId = 0;
  private readonly managerId = MaterialManager.nextId++;
  /** Depth-only pipeline for rendering this material into a shadow map (alpha-masked PBR keeps its cutout via fs_shadow). */
  getShadowPipeline(id: number, deformMask: number, depthFormat: GPUTextureFormat): GPURenderPipeline {
    let m = this.materials[id];
    if (m.failed) m = this.materials[this.errorMaterial];
    const features = m.features | deformFeatures(deformMask);
    const masked = m.shaderId === 'pbr' && m.queue === 'alphaMask';
    const key = `${ShaderManager.key(m.shaderId, featureDefines(features))}|${m.vertexEntry}|${masked}|${depthFormat}`;
    let p = this.shadowPipelines.get(key);
    if (p) return p;
    const source = m.shaderId === 'pbr' ? PBR_SOURCE : this.customSources.get(m.shaderId)!;
    const module = this.res.shaders.get(m.shaderId, source, featureDefines(features));
    p = this.device.createRenderPipeline({
      label: `shadow:${key}`, layout: this.layouts.pipelineLayout,
      vertex: { module, entryPoint: m.vertexEntry, buffers: toGPUVertexBuffers(STANDARD_VERTEX_LAYOUT) },
      fragment: masked ? { module, entryPoint: 'fs_shadow', targets: [] } : undefined,
      primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
      depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.5 },
    });
    this.shadowPipelines.set(key, p);
    return p;
  }

  /** The cache key identifying the pipeline for (material, pass target, deform variant). */
  pipelineKey(m: Material, target: PassTarget, deformMask = 0): PipelineKey {
    return {
      shader: ShaderManager.key(m.shaderId, featureDefines(m.features | deformFeatures(deformMask))),
      vertexEntry: m.vertexEntry, fragmentEntry: target.colorFormat ? m.fragmentEntry : null,
      vertexLayout: STANDARD_VERTEX_LAYOUT,
      topology: 'triangle-list', cullMode: m.state.cullMode, frontFace: target.flipWinding ? 'cw' : 'ccw',
      depth: { format: target.depthFormat, write: this.depthWrite(m, target), compare: this.depthCompare(m, target) },
      targets: target.colorFormat ? [{ format: target.colorFormat, blend: m.state.blend }] : [],
      sampleCount: target.sampleCount, layout: 'engine-v1',
    };
  }

  /** Build the WebGPU pipeline descriptor for the material in `target` (shader variant, standard vertex layout, depth state). */
  private pipelineDescriptor(m: Material, key: PipelineKey, target: PassTarget, deformMask: number): GPURenderPipelineDescriptor {
    const source = m.shaderId === 'pbr' ? PBR_SOURCE : this.customSources.get(m.shaderId)!;
    const module = this.res.shaders.get(m.shaderId, source, featureDefines(m.features | deformFeatures(deformMask)));
    return {
      label: `${m.name}:${key.shader}`,
      layout: this.layouts.pipelineLayout,
      vertex: { module, entryPoint: m.vertexEntry, buffers: toGPUVertexBuffers(STANDARD_VERTEX_LAYOUT) },
      fragment: target.colorFormat
        ? { module, entryPoint: m.fragmentEntry, targets: [{ format: target.colorFormat, blend: m.state.blend ?? undefined }] }
        : undefined,
      primitive: { topology: 'triangle-list', cullMode: m.state.cullMode, frontFace: target.flipWinding ? 'cw' : 'ccw' },
      depthStencil: { format: target.depthFormat, depthWriteEnabled: this.depthWrite(m, target), depthCompare: this.depthCompare(m, target) },
      multisample: { count: target.sampleCount },
    };
  }

  /**
   * Build the pipelines for every material x deform variant ahead of time with createRenderPipelineAsync, so the first frame that
   * uses them does not hitch. Resolves when all are cached.
   */
  async warmup(target: PassTarget, deformMasks: number[] = [0]): Promise<number> {
    const jobs: Promise<void>[] = [], seen = new Set<string>();
    for (const m of this.materials) {
      if (m.failed || m.kind === 'custom') continue;   // custom materials are validated at first use (error scopes)
      for (const dm of deformMasks) {
        const key = this.pipelineKey(m, target, dm);
        const k = pipelineKeyString(key);
        if (seen.has(k)) continue;   // many materials share one pipeline
        seen.add(k);
        jobs.push(this.res.pipelines.primeRender(key, () => this.device.createRenderPipelineAsync(this.pipelineDescriptor(m, key, target, dm))));
      }
    }
    await Promise.all(jobs);
    return jobs.length;
  }

  /** Create the render pipeline; custom shaders are wrapped in a validation error scope so a bad shader marks its materials `failed` (drawn with the error material) instead of crashing. */
  private createPipeline(m: Material, target: PassTarget, key: PipelineKey, deformMask: number): GPURenderPipeline {
    const guard = m.kind === 'custom';
    if (guard) this.device.pushErrorScope('validation');
    const pipeline = this.device.createRenderPipeline(this.pipelineDescriptor(m, key, target, deformMask));
    if (guard) {
      this.device.popErrorScope().then((err) => {
        if (!err) return;
        const msg = `Custom material '${m.name}' failed to build: ${err.message}`;
        this.shaderErrors.push(msg);
        console.error(msg);
        for (const mm of this.materials) if (mm.shaderId === m.shaderId) { mm.failed = true; mm.version++; }
      });
    }
    return pipeline;
  }

  // ---------------------------------------------------------------- queries

  get(id: number): Material { return this.materials[id]; }
  /** Number of materials (including the built-in default and error materials). */
  get count(): number { return this.materials.length; }
  /** The custom-parameter layout (names, offsets) of material `id`'s shader, if it has one. */
  paramLayout(id: number): ParamLayout | undefined { return this.layouts_.get(this.materials[id].shaderId); }

  // ---------------------------------------------------------------- internals

  private refreshSortId(m: Material): void {
    const s = m.state;
    const key = [m.shaderId, m.features, s.cullMode, JSON.stringify(s.blend), s.depthWrite, s.depthCompare, m.vertexEntry, m.fragmentEntry].join('|');
    let id = this.sortIds.get(key);
    if (id === undefined) { id = this.sortIds.size; this.sortIds.set(key, id); }
    m.pipelineSortId = id;
  }

  /** Store the texture reference without touching versions or shader features. */
  private setTextureRaw(m: Material, slot: number, tex: TextureRef | null): void { m.textures[slot] = tex; }


  /** Write a material's PBR parameters and flags into its 64-byte record in the shared buffer and extend the dirty range. */
  private writeRecord(id: number, d: PBRMaterialDesc, extraFlags = 0): void {
    const m = this.materials[id];
    const o = id * RECORD_WORDS, f = this.recF32, u = this.recU32;
    const bc = d.baseColor ?? [1, 1, 1, 1], em = d.emissive ?? [0, 0, 0];
    f[o] = bc[0]; f[o + 1] = bc[1]; f[o + 2] = bc[2]; f[o + 3] = bc[3];
    f[o + 4] = em[0]; f[o + 5] = em[1]; f[o + 6] = em[2]; f[o + 7] = d.emissiveStrength ?? 1;
    f[o + 8] = d.metallic ?? 1; f[o + 9] = d.roughness ?? 1;
    f[o + 10] = d.normalScale ?? 1; f[o + 11] = d.occlusionStrength ?? 1;
    f[o + 12] = d.alphaCutoff ?? 0.5;
    const hasEmissive = em[0] > 0 || em[1] > 0 || em[2] > 0;
    u[o + 13] = (m.doubleSided ? MaterialRecordFlags.DoubleSided : 0) | (hasEmissive ? MaterialRecordFlags.Emissive : 0) | extraFlags
      | (m.kind === 'custom' ? MaterialRecordFlags.Custom : 0);
    u[o + 14] = m.paramCount > 0 ? this.recCap * 4 + m.paramBase : 0;   // absolute vec4 index: the param region follows the records
    u[o + 15] = 0;
    this.recDirtyMin = Math.min(this.recDirtyMin, id);
    this.recDirtyMax = Math.max(this.recDirtyMax, id);
  }

  /** Reserve `vec4s` vec4 slots in the shared custom-parameter buffer (growing it, and bumping `generation`, if needed); returns the base index. */
  private allocParams(vec4s: number): number {
    const base = this.paramUsedVec4;
    if (base + vec4s > this.paramCapVec4) {
      let cap = this.paramCapVec4;
      while (cap < base + vec4s) cap *= 2;
      const n = new Float32Array(cap * 4); n.set(this.paramF32);
      this.paramF32 = n; this.paramCapVec4 = cap;
      this.res.buffers.destroy(this.materialBuffer);
      this.materialBuffer = this.makeMaterialBuffer();
      this.generation++;
      this.paramDirtyMin = 0; this.paramDirtyMax = Math.max(0, base - 1);   // re-upload existing parameters
      this.recDirtyMin = 0; this.recDirtyMax = Math.max(0, this.materials.length - 1);   // ... and the records of the new buffer
    }
    this.paramUsedVec4 = base + vec4s;
    return base;
  }

  /** Double the material record capacity, recreate the GPU buffer and re-upload all records. */
  private growRecords(needed: number): void {
    let cap = this.recCap;
    while (cap < needed) cap *= 2;
    const nb = new ArrayBuffer(cap * RECORD_WORDS * 4);
    new Uint8Array(nb).set(new Uint8Array(this.recBuf));
    this.recBuf = nb; this.recF32 = new Float32Array(nb); this.recU32 = new Uint32Array(nb); this.recCap = cap;
    this.res.buffers.destroy(this.materialBuffer);
    this.materialBuffer = this.makeMaterialBuffer();
    this.generation++;
    // the parameter region starts after the records, so it moves: re-point every custom material and re-upload everything
    for (const m of this.materials) if (m.paramCount > 0) this.recU32[m.id * RECORD_WORDS + 14] = this.recCap * 4 + m.paramBase;
    this.recDirtyMin = 0; this.recDirtyMax = Math.max(0, this.materials.length - 1);
    if (this.paramUsedVec4 > 0) { this.paramDirtyMin = 0; this.paramDirtyMax = this.paramUsedVec4 - 1; }
  }

  /** Allocate the single GPU storage buffer: material records followed by the custom-parameter region. */
  private makeMaterialBuffer(): GPUBuffer {
    return this.res.buffers.create('MaterialBuffer', this.recCap * RECORD_WORDS * 4 + this.paramCapVec4 * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  }

  /** Create the 1x1 white and flat-normal textures bound to unused material slots. */
  private createDefaultTextures(): void {
    /** Create a 1x1 RGBA texture of the given colour. */
    const mk = (id: string, rgba: [number, number, number, number]): TextureRef => {
      const tex = this.res.textures.create({
        label: id, size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.device.queue.writeTexture({ texture: tex }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1]);
      return { id, view: tex.createView() };
    };
    const blackCube = this.res.textures.create({ label: 'default-black-cube', size: [1, 1, 6], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING }).createView({ dimension: 'cube' });
    this.defaults = { white: mk('default-white', [255, 255, 255, 255]), flatNormal: mk('default-flat-normal', [128, 128, 255, 255]), blackCube };
  }
}

/** Map a mesh's DeformMask to the shader feature bits. */
export function deformFeatures(deformMask: number): number {
  return ((deformMask & DeformMask.Skin) ? MaterialFeature.Skinning : 0) | ((deformMask & DeformMask.Morph) ? MaterialFeature.MorphTargets : 0);
}

const DEFAULT_SAMPLER: GPUSamplerDescriptor = {
  magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat',
};
