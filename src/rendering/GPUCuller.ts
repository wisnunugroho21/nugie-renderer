import type { GPUContext } from '../gpu/GPUContext';
import type { BatchList } from './BatchBuilder';
import { INSTANCE_BYTES } from './BatchBuilder';
import type { MeshManager } from './MeshManager';
import cullSrc from '../shaders/gpu_cull.wgsl?raw';
import { technique } from './graph/TechniqueBuilder';
import { TechniqueInstance } from './graph/TechniqueInstance';
import type { FrameBuilder } from './graph/FrameGraph';
import type { VariableValue } from './graph/Flatten';
import type { Technique } from './graph/TechniqueTypes';

/** A LOD group as seen by the culler (levels sorted from finest to coarsest, minScreenSize strictly decreasing). */
export interface GPULodGroup { levels: { meshId: number; minScreenSize: number }[]; cullBelowLast: boolean; }

/**
 * GPU-driven visibility: culls a frame's instances on the GPU (frustum, optionally Hi-Z occlusion and LOD selection), compacts the
 * survivors per DRAW and produces drawIndexedIndirect arguments. Only the first `batchCount` batches (opaque + alpha-masked)
 * take part. A batch whose mesh belongs to a LOD group expands into one virtual draw per level; the shader routes every
 * instance to the level its projected size selects (same thresholds as the CPU reference `selectLevel`, without hysteresis).
 *
 * Each cull dispatch is a compute node of a technique (see TECHNIQUES.md): in a frame every phase is its own node (`addToFrame`) with its own parameters, and `encode`
 * runs the technique on its own, one instance per phase; the working buffers are imported resources and the frustum, camera and counts are variables.
 */
export class GPUCuller {
  /** Compacted instance records for the current frame (bind this as the object group's instance buffer). */
  instanceBuffer!: GPUBuffer;
  instanceGeneration = 0;
  argsBuffer!: GPUBuffer;
  total = 0;
  batchCount = 0;
  /** Virtual draws (batch x LOD level): material / mesh per draw, in args order. */
  virtualCount = 0;
  virtualMaterial = new Int32Array(0);
  virtualMesh = new Int32Array(0);
  /** Compacted-instance capacity needed per phase (instances x LOD levels). */
  dstInstances = 0;
  lodBias = 1;
  private spheres!: GPUBuffer;
  private batchFirst!: GPUBuffer;
  private batchInfo!: GPUBuffer;
  private thresholds!: GPUBuffer;
  private visBits!: GPUBuffer;
  private visCap = 0;
  /** The culling dispatch as a technique, shared by the frame's culling passes (each is its own node, with its own parameter buffer). */
  private readonly tech: Technique;
  /** One standalone instance per phase for `encode` (queue.writeBuffer lands before the whole submit, so phases must not share a parameter buffer). */
  private phases: TechniqueInstance[];
  private dummyHiz: GPUTexture;
  private instCap = 0;
  private dstCap = 0;
  private batchCap = 0;
  private virtCap = 0;

  /** Create the per-phase culling techniques and the initial working buffers. */
  constructor(private gpu: GPUContext) {
    const { resources: r } = gpu;
    this.tech = this.createTechnique();
    this.phases = [0, 1, 2].map((i) => TechniqueInstance.create(gpu, this.tech, { label: `gpu-cull-${i}` }));
    this.dummyHiz = r.textures.create({ label: 'hiz-dummy', size: [1, 1], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING });
    this.ensure(1024, 1024, 64, 64);
  }

  /** The culling dispatch as a technique: one compute node over the instances, the engine's working buffers imported. */
  private createTechnique(): Technique {
    const g = technique('gpu-cull');
    for (let i = 0; i < 6; i++) g.float4(`plane${i}`);
    for (let i = 0; i < 4; i++) g.float4(`viewProj${i}`);
    g.float4('hiz'); g.float4('cam');
    for (const v of ['total', 'batchCount', 'srcBase', 'hizOn', 'phase', 'virtualBase', 'dstBase']) g.uint(v);
    const buf = (name: string, element: string, stride?: number) => g.importedBuffer(name, element, stride);
    const src = buf('src', 'u32'), dst = buf('dst', 'u32'), spheres = buf('spheres', 'vec4<f32>'), batchFirst = buf('batchFirst', 'u32'), args = buf('args', 'atomic<u32>', 4);
    const visBits = buf('visBits', 'u32'), batchInfo = buf('batchInfo', 'vec4<u32>'), lodThresholds = buf('lodThresholds', 'f32');
    const hizTex = g.texture('hizTex', { format: 'r32float', visibility: 'imported' });
    g.compute('gpu-cull', {
      shader: cullSrc, workgroupSize: [64], dispatch: { threads: [g.variableNamed('total')] },
      reads: [src, spheres, batchFirst, batchInfo, lodThresholds, hizTex], writes: [dst], readWrites: [args, visBits],
    });
    return g.build();
  }

  /** Free the three phase techniques. */
  dispose(): void { for (const p of this.phases) p.dispose(); }

  /** Grow (by doubling) the sphere, culled-instance, batch, and indirect-argument buffers so they hold the requested counts. */
  private ensure(instances: number, dst: number, batches: number, virtuals: number): void {
    const { resources: r } = this.gpu, S = GPUBufferUsage.STORAGE, D = GPUBufferUsage.COPY_DST;
    if (instances > this.instCap) {
      this.instCap = Math.max(instances, this.instCap * 2);
      if (this.spheres) r.buffers.destroy(this.spheres);
      this.spheres = r.buffers.create('InstanceSpheres', this.instCap * 16, S | D);
    }
    if (dst * 2 > this.dstCap) {
      this.dstCap = Math.max(dst * 2, this.dstCap * 2);
      if (this.instanceBuffer) r.buffers.destroy(this.instanceBuffer);
      this.instanceBuffer = r.buffers.create('CulledInstances', this.dstCap * INSTANCE_BYTES, S | GPUBufferUsage.COPY_SRC);
      this.instanceGeneration++;
    }
    if (batches + 1 > this.batchCap) {
      this.batchCap = Math.max(batches + 1, this.batchCap * 2);
      if (this.batchFirst) { r.buffers.destroy(this.batchFirst); r.buffers.destroy(this.batchInfo); }
      this.batchFirst = r.buffers.create('CullBatchFirst', this.batchCap * 4, S | D);
      this.batchInfo = r.buffers.create('CullBatchInfo', this.batchCap * 16, S | D);
    }
    if (virtuals > this.virtCap) {
      this.virtCap = Math.max(virtuals, this.virtCap * 2);
      if (this.argsBuffer) { r.buffers.destroy(this.argsBuffer); r.buffers.destroy(this.thresholds); }
      this.argsBuffer = r.buffers.create('CullIndirectArgs', this.virtCap * 40, GPUBufferUsage.INDIRECT | S | D | GPUBufferUsage.COPY_SRC);
      this.thresholds = r.buffers.create('CullLodThresholds', this.virtCap * 4, S | D);
    }
  }

  private scratchFirst = new Uint32Array(0);
  private scratchInfo = new Uint32Array(0);
  private scratchThr = new Float32Array(0);
  private scratchArgs = new Uint32Array(0);

  /** Reusable CPU staging arrays for `prepare` (grown geometrically, never shrunk), sized for `batches` batches and `V` virtual draws. */
  private scratch(batches: number, V: number) {
    if (this.scratchFirst.length < batches + 1) {
      const n = Math.max(batches + 1, this.scratchFirst.length * 2, 64);
      this.scratchFirst = new Uint32Array(n); this.scratchInfo = new Uint32Array(n * 4);
    }
    if (this.scratchThr.length < V) {
      const n = Math.max(V, this.scratchThr.length * 2, 64);
      this.scratchThr = new Float32Array(n); this.scratchArgs = new Uint32Array(n * 10);
      this.virtualMaterial = new Int32Array(n); this.virtualMesh = new Int32Array(n);
    }
    return { first: this.scratchFirst, info: this.scratchInfo, thr: this.scratchThr, args: this.scratchArgs };
  }

  /** Per-object 'drawn last frame' flags for two-phase occlusion culling (zero-initialised; reset when it must grow). */
  ensureVisibility(objects: number): void {
    if (objects <= this.visCap) return;
    this.visCap = Math.max(objects, this.visCap * 2, 1024);
    if (this.visBits) this.gpu.resources.buffers.destroy(this.visBits);
    this.visBits = this.gpu.resources.buffers.create('ObjectVisibilityBits', this.visCap * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
  }

  /**
   * Upload this frame's per-instance spheres (`total` x 4 floats), the batch / LOD tables and the static indirect arguments.
   * `batches` must list the participating batches first; `instanceBase` is the absolute first-instance of batch 0.
   * `lodOf(meshId)` returns the LOD group a mesh belongs to (or null).
   */
  prepare(
    batches: BatchList, batchCount: number, total: number, spheres: Float32Array, instanceBase: number, meshes: MeshManager,
    lodOf?: (meshId: number) => GPULodGroup | null,
  ): void {
    this.total = total; this.batchCount = batchCount;
    // Pass 1: levels per batch -> virtual draw count V and compacted-instance count `dst` (no allocation: scratch arrays are reused).
    let V = 0, dst = 0;
    for (let i = 0; i < batchCount; i++) {
      const group = lodOf?.(batches.meshId[i]) ?? null, levels = group ? group.levels.length : 1;
      V += levels; dst += batches.instanceCount[i] * levels;
    }
    this.virtualCount = V; this.dstInstances = dst;
    const sc = this.scratch(batchCount, V);
    const { first, info, thr, args } = sc;
    // Pass 2: fill the batch / LOD tables and the virtual-draw lists.
    let v = 0; dst = 0;
    for (let i = 0; i < batchCount; i++) {
      const group = lodOf?.(batches.meshId[i]) ?? null, levels = group ? group.levels.length : 1, n = batches.instanceCount[i];
      first[i] = batches.firstInstance[i] - instanceBase;
      info[i * 4] = levels; info[i * 4 + 1] = v; info[i * 4 + 2] = dst; info[i * 4 + 3] = group?.cullBelowLast ? 1 : 0;
      for (let l = 0; l < levels; l++, v++) {
        this.virtualMaterial[v] = batches.materialId[i];
        this.virtualMesh[v] = group ? group.levels[l].meshId : batches.meshId[i];
        thr[v] = group ? group.levels[l].minScreenSize : 0;
      }
      dst += n * levels;
    }
    first[batchCount] = total;
    this.ensure(Math.max(total, 1), Math.max(this.dstInstances, 1), batchCount, Math.max(V, 1));
    this.ensureVisibility(1);
    const q = this.gpu.device.queue;
    if (total > 0) q.writeBuffer(this.spheres, 0, spheres.buffer, spheres.byteOffset, total * 16);
    // Indirect arguments: two argument sets (phase A / B) of V draws each; the shader fills instanceCount, the rest is static.
    for (let i = 0; i < batchCount; i++) {
      const levels = info[i * 4], vBase = info[i * 4 + 1], dstFirst = info[i * 4 + 2], n = batches.instanceCount[i];
      for (let l = 0; l < levels; l++) {
        const mesh = meshes.get(this.virtualMesh[vBase + l]), seg = dstFirst + l * n;
        for (let set = 0; set < 2; set++) {
          const o = ((set === 0 ? 0 : V) + vBase + l) * 5;
          args[o] = mesh.indexCount; args[o + 1] = 0; args[o + 2] = mesh.firstIndex; args[o + 3] = mesh.baseVertex >>> 0; args[o + 4] = set === 0 ? seg : seg + dst;
        }
      }
    }
    if (batchCount > 0) {
      q.writeBuffer(this.batchFirst, 0, first.buffer, 0, (batchCount + 1) * 4);
      q.writeBuffer(this.batchInfo, 0, info.buffer, 0, batchCount * 16);
      q.writeBuffer(this.thresholds, 0, thr.buffer, 0, V * 4);
      q.writeBuffer(this.argsBuffer, 0, args.buffer, 0, V * 40);
    }
  }

  /**
   * Add one culling dispatch to the frame as the node `name` (`phase` 0 = single pass, 1 = last frame's visible set, 2 = the rest, tested against the Hi-Z pyramid `hiz`): the
   * technique's compute node reads this frame's instance records and writes the compacted ones, the indirect arguments and the visibility flags.
   */
  addToFrame(
    g: FrameBuilder, name: string, srcBuffer: GPUBuffer, srcBase: number, planes: ArrayLike<number>, viewProj: ArrayLike<number>,
    hiz: { texture: GPUTexture; width: number; height: number; mips: number } | null, timestampWrites: GPUComputePassTimestampWrites | undefined,
    phase: 0 | 1 | 2 = 0, camera?: { position: ArrayLike<number>; fovY: number },
  ): void {
    if (this.total === 0 || this.batchCount === 0) return;
    g.include(name, this.tech, {
      imports: {
        src: { as: 'instances', resource: srcBuffer }, dst: { as: 'culledInstances', resource: this.instanceBuffer }, spheres: { as: 'cullSpheres', resource: this.spheres },
        batchFirst: { as: 'cullBatchFirst', resource: this.batchFirst }, args: { as: 'cullArgs', resource: this.argsBuffer }, visBits: { as: 'visBits', resource: this.visBits },
        batchInfo: { as: 'cullBatchInfo', resource: this.batchInfo }, lodThresholds: { as: 'cullThresholds', resource: this.thresholds },
        hizTex: hiz ? { as: 'hizTex', resource: hiz.texture } : { as: 'hizDummy', resource: this.dummyHiz },
      },
      variables: this.frameValues(srcBase, planes, viewProj, hiz, phase, camera),
      publish: ['culledInstances', 'cullArgs'],
    });
    g.timestamps(name, () => timestampWrites);
  }

  /** The technique's variables for one dispatch. */
  private frameValues(
    srcBase: number, planes: ArrayLike<number>, viewProj: ArrayLike<number>, hiz: { width: number; height: number; mips: number } | null,
    phase: 0 | 1 | 2, camera?: { position: ArrayLike<number>; fovY: number },
  ): Record<string, VariableValue> {
    const v: Record<string, VariableValue> = {
      total: this.total, batchCount: this.batchCount, srcBase, hizOn: hiz ? 1 : 0, phase,
      virtualBase: phase === 2 ? this.virtualCount : 0, dstBase: phase === 2 ? this.dstInstances : 0,
      hiz: [hiz?.width ?? 1, hiz?.height ?? 1, hiz?.mips ?? 1, this.lodBias],
      cam: [camera?.position[0] ?? 0, camera?.position[1] ?? 0, camera?.position[2] ?? 0, camera ? Math.tan(camera.fovY / 2) : 1],
    };
    for (let i = 0; i < 6; i++) v[`plane${i}`] = [planes[i * 4], planes[i * 4 + 1], planes[i * 4 + 2], planes[i * 4 + 3]];
    for (let i = 0; i < 4; i++) v[`viewProj${i}`] = [viewProj[i * 4], viewProj[i * 4 + 1], viewProj[i * 4 + 2], viewProj[i * 4 + 3]];
    return v;
  }

  /** Record one culling dispatch (`phase` 0 = single pass, 1 = last frame's visible set, 2 = the rest, tested against the Hi-Z pyramid `hiz`) into `enc`. */
  encode(
    enc: GPUCommandEncoder, srcBuffer: GPUBuffer, srcBase: number, planes: ArrayLike<number>, viewProj: ArrayLike<number>,
    hiz: { texture: GPUTexture; width: number; height: number; mips: number } | null, timestampWrites?: GPUComputePassTimestampWrites,
    phase: 0 | 1 | 2 = 0, camera?: { position: ArrayLike<number>; fovY: number },
  ): void {
    if (this.total === 0 || this.batchCount === 0) return;
    const fx = this.phases[phase];
    for (const [name, value] of Object.entries(this.frameValues(srcBase, planes, viewProj, hiz, phase, camera))) fx.setVariable(name, value);
    // buffers are replaced when they grow (and the source ring rotates): setImport only rebuilds the bind group when the object changed
    fx.setImport('src', srcBuffer); fx.setImport('dst', this.instanceBuffer); fx.setImport('spheres', this.spheres); fx.setImport('batchFirst', this.batchFirst);
    fx.setImport('args', this.argsBuffer); fx.setImport('visBits', this.visBits); fx.setImport('batchInfo', this.batchInfo); fx.setImport('lodThresholds', this.thresholds);
    fx.setImport('hizTex', hiz ? hiz.texture : this.dummyHiz);
    fx.execute(enc, { timestampWrites: () => timestampWrites });
  }
}
