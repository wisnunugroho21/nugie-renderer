import type { GPUContext } from '../gpu/GPUContext';
import type { BatchList } from './BatchBuilder';
import { INSTANCE_BYTES } from './BatchBuilder';
import type { MeshManager } from './MeshManager';
import cullSrc from '../shaders/gpu_cull.wgsl?raw';

const PARAMS_FLOATS = 24 + 16 + 4 + 4 + 4 + 4;   // planes, viewProj, counts, bases, hiz, cam

/** A LOD group as seen by the culler (levels sorted from finest to coarsest, minScreenSize strictly decreasing). */
export interface GPULodGroup { levels: { meshId: number; minScreenSize: number }[]; cullBelowLast: boolean; }

/**
 * GPU-driven visibility: culls a frame's instances on the GPU (frustum, optionally Hi-Z occlusion and LOD selection), compacts the
 * survivors per DRAW and produces drawIndexedIndirect arguments. Only the first `batchCount` batches (opaque + alpha-masked)
 * take part. A batch whose mesh belongs to a LOD group expands into one virtual draw per level; the shader routes every
 * instance to the level its projected size selects (same thresholds as the CPU reference `selectLevel`, without hysteresis).
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
  /** One uniform buffer per phase: queue.writeBuffer lands before the whole submit, so phases must not share one. */
  private params: GPUBuffer[];
  private pipeline: GPUComputePipeline;
  private dummyHiz: GPUTextureView;
  private instCap = 0;
  private dstCap = 0;
  private batchCap = 0;
  private virtCap = 0;
  private pdata = new ArrayBuffer(PARAMS_FLOATS * 4);
  private pf = new Float32Array(this.pdata);
  private pu = new Uint32Array(this.pdata);

  /** Create the culling pipeline, per-phase parameter buffers and initial working buffers. */
  constructor(private gpu: GPUContext) {
    const { device, resources: r } = gpu;
    this.params = [0, 1, 2].map((i) => r.buffers.create(`GPUCullParams${i}`, PARAMS_FLOATS * 4, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST));
    this.pipeline = device.createComputePipeline({ label: 'gpu-cull', layout: 'auto', compute: { module: r.shaders.get('gpu-cull', cullSrc), entryPoint: 'main' } });
    this.dummyHiz = r.textures.create({ label: 'hiz-dummy', size: [1, 1], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING }).createView();
    this.ensure(1024, 1024, 64, 64);
  }

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
    const first = new Uint32Array(batchCount + 1), info = new Uint32Array(Math.max(batchCount, 1) * 4);
    const vMat: number[] = [], vMesh: number[] = [], thr: number[] = [];
    let dst = 0;
    for (let i = 0; i < batchCount; i++) {
      const group = lodOf?.(batches.meshId[i]) ?? null, levels = group ? group.levels.length : 1, n = batches.instanceCount[i];
      first[i] = batches.firstInstance[i] - instanceBase;
      info[i * 4] = levels; info[i * 4 + 1] = vMat.length; info[i * 4 + 2] = dst; info[i * 4 + 3] = group?.cullBelowLast ? 1 : 0;
      for (let l = 0; l < levels; l++) {
        vMat.push(batches.materialId[i]); vMesh.push(group ? group.levels[l].meshId : batches.meshId[i]); thr.push(group ? group.levels[l].minScreenSize : 0);
      }
      dst += n * levels;
    }
    first[batchCount] = total;
    const V = vMat.length;
    this.virtualCount = V; this.dstInstances = dst;
    this.virtualMaterial = Int32Array.from(vMat); this.virtualMesh = Int32Array.from(vMesh);
    this.ensure(Math.max(total, 1), Math.max(dst, 1), batchCount, Math.max(V, 1));
    this.ensureVisibility(1);
    const q = this.gpu.device.queue;
    if (total > 0) q.writeBuffer(this.spheres, 0, spheres.buffer, spheres.byteOffset, total * 16);
    const args = new Uint32Array(V * 10);
    for (let i = 0; i < batchCount; i++) {
      const levels = info[i * 4], vBase = info[i * 4 + 1], dstFirst = info[i * 4 + 2], n = batches.instanceCount[i];
      for (let l = 0; l < levels; l++) {
        const mesh = meshes.get(vMesh[vBase + l]), seg = dstFirst + l * n;
        for (const [set, base] of [[0, seg], [V, seg + dst]] as const) {
          const o = (set + vBase + l) * 5;
          args[o] = mesh.indexCount; args[o + 1] = 0; args[o + 2] = mesh.firstIndex; args[o + 3] = mesh.baseVertex >>> 0; args[o + 4] = base;
        }
      }
    }
    if (batchCount > 0) { q.writeBuffer(this.batchFirst, 0, first); q.writeBuffer(this.batchInfo, 0, info); q.writeBuffer(this.thresholds, 0, Float32Array.from(thr)); q.writeBuffer(this.argsBuffer, 0, args); }
  }

  /** Record one culling dispatch (`phase` 0 = single pass, 1 = last frame's visible set, 2 = the rest, tested against the Hi-Z pyramid `hiz`) into `enc`. */
  encode(
    enc: GPUCommandEncoder, srcBuffer: GPUBuffer, srcBase: number, planes: ArrayLike<number>, viewProj: ArrayLike<number>,
    hiz: { view: GPUTextureView; width: number; height: number; mips: number } | null, timestampWrites?: GPUComputePassTimestampWrites,
    phase: 0 | 1 | 2 = 0, camera?: { position: ArrayLike<number>; fovY: number },
  ): void {
    if (this.total === 0 || this.batchCount === 0) return;
    const f = this.pf, u = this.pu;
    for (let i = 0; i < 24; i++) f[i] = planes[i];
    for (let i = 0; i < 16; i++) f[24 + i] = viewProj[i];
    u[40] = this.total; u[41] = this.batchCount; u[42] = srcBase; u[43] = hiz ? 1 : 0;
    u[44] = 0; u[45] = phase; u[46] = phase === 2 ? this.virtualCount : 0; u[47] = phase === 2 ? this.dstInstances : 0;
    f[48] = hiz?.width ?? 1; f[49] = hiz?.height ?? 1; f[50] = hiz?.mips ?? 1; f[51] = this.lodBias;
    f[52] = camera?.position[0] ?? 0; f[53] = camera?.position[1] ?? 0; f[54] = camera?.position[2] ?? 0; f[55] = camera ? Math.tan(camera.fovY / 2) : 1;
    this.gpu.device.queue.writeBuffer(this.params[phase], 0, this.pdata);
    const bg = this.gpu.device.createBindGroup({
      label: 'gpu-cull-bg', layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params[phase] } }, { binding: 1, resource: { buffer: srcBuffer } },
        { binding: 2, resource: { buffer: this.instanceBuffer } }, { binding: 3, resource: { buffer: this.spheres } },
        { binding: 4, resource: { buffer: this.batchFirst } }, { binding: 5, resource: { buffer: this.argsBuffer } },
        { binding: 6, resource: hiz ? hiz.view : this.dummyHiz }, { binding: 7, resource: { buffer: this.visBits } },
        { binding: 8, resource: { buffer: this.batchInfo } }, { binding: 9, resource: { buffer: this.thresholds } },
      ],
    });
    const pass = enc.beginComputePass({ label: 'gpu-cull', timestampWrites });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(this.total / 64));
    pass.end();
  }
}
