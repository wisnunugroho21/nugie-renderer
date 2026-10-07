import type { GPUContext } from '../gpu/GPUContext';
import type { BindLayouts } from '../gpu/BindLayouts';
import type { MeshManager } from '../rendering/MeshManager';
import type { TextureRef } from '../rendering/materials/Material';
import { STANDARD_VERTEX_LAYOUT, toGPUVertexBuffers } from '../rendering/VertexLayouts';
import { registerEngineShaderChunks } from '../shaders';
import simSource from '../shaders/particles_sim.wgsl?raw';
import billboardSource from '../shaders/particles_billboard.wgsl?raw';
import meshSource from '../shaders/particles_mesh.wgsl?raw';
import { EMITTER_BYTES, EMITTER_FLOATS, EmitterRuntime, packEmitter, type EmitterConfig } from './EmitterConfig';

export type BillboardOrientation = 'screen' | 'camera' | 'worldUp' | 'point';
const ORIENTATION_ID: Record<BillboardOrientation, number> = { screen: 0, camera: 1, worldUp: 2, point: 3 };

export interface ParticlePoolConfig {
  name?: string;
  /** Capacity of the pool (alive + dead). All particles of the pool live in shared buffers of this size. */
  maxCount: number;
  maxEmitters?: number;
  /** Billboard / point-sprite rendering (mutually exclusive with `mesh`). */
  billboard?: { orientation?: BillboardOrientation; blend?: 'alpha' | 'additive'; texture?: TextureRef; nearFade?: [start: number, range: number] };
  /** Mesh particles: ONE mesh per pool (batches into a single indirect instanced draw). */
  mesh?: { meshId: number; blend?: 'opaque' | 'alpha' };
}

export interface ParticleCounters { alive: number; dead: number; spawned: number; rejected: number; }

const WORKGROUP = 64;
const PARAM_BYTES = 48;
const ARGS_BYTES = 64;       // draw @0 (16 B), drawIndexed @16 (20 B), dispatch @48 (12 B)
const ARGS_DRAW = 0, ARGS_DRAW_INDEXED = 16, ARGS_DISPATCH = 48;

/** One pool = shared GPU buffers + a set of emitters + one render mode. */
export class ParticlePool {
  readonly emitters: EmitterRuntime[] = [];
  readonly emitterWorld: Float32Array;
  readonly maxEmitters: number;
  /** Per-frame diagnostics (CPU side). */
  spawnedThisFrame = 0;
  requestedThisFrame = 0;

  // GPU
  readonly particles: GPUBuffer; readonly aliveA: GPUBuffer; readonly aliveB: GPUBuffer; readonly deadList: GPUBuffer;
  readonly counters: GPUBuffer; readonly emitterBuf: GPUBuffer; readonly requestBuf: GPUBuffer; readonly args: GPUBuffer;
  readonly params: GPUBuffer; readonly renderParams: GPUBuffer;
  simBG!: GPUBindGroup;
  /** Bind group for the finalize kernel only: it alone gets the REAL args buffer as writable storage. */
  finalizeBG!: GPUBindGroup;
  renderBG!: GPUBindGroup;
  pipeline!: GPURenderPipeline;

  cur = 0;
  frame = 0;
  renderList = 0;
  private spawnTotal = 0;
  private packed: Float32Array;
  private requestData: Uint32Array;
  private paramData = new ArrayBuffer(PARAM_BYTES);
  private paramU32: Uint32Array;
  private paramF32: Float32Array;

  constructor(readonly system: ParticleSystem, readonly config: ParticlePoolConfig, readonly id: number) {
    const { resources: res, device } = system.gpu;
    const N = config.maxCount;
    this.maxEmitters = config.maxEmitters ?? 16;
    const label = config.name ?? `pool${id}`;
    const S = GPUBufferUsage.STORAGE, D = GPUBufferUsage.COPY_DST, C = GPUBufferUsage.COPY_SRC;
    this.particles = res.buffers.create(`${label}:ParticleStateBuffer`, N * 64, S | D | C);
    this.aliveA = res.buffers.create(`${label}:ParticleAliveBuffer.A`, N * 4, S | D | C);
    this.aliveB = res.buffers.create(`${label}:ParticleAliveBuffer.B`, N * 4, S | D | C);
    this.deadList = res.buffers.create(`${label}:ParticleDeadBuffer`, N * 4, S | D | C);
    this.counters = res.buffers.create(`${label}:ParticleCounters`, 32, S | D | C);
    this.emitterBuf = res.buffers.create(`${label}:EmitterBuffer`, this.maxEmitters * EMITTER_BYTES, S | D);
    this.requestBuf = res.buffers.create(`${label}:ParticleSpawnBuffer`, this.maxEmitters * 16, S | D);
    this.args = res.buffers.create(`${label}:ParticleIndirectArgsBuffer`, ARGS_BYTES, S | D | C | GPUBufferUsage.INDIRECT);
    this.params = res.buffers.create(`${label}:SimParams`, PARAM_BYTES, GPUBufferUsage.UNIFORM | D);
    this.renderParams = res.buffers.create(`${label}:RenderParams`, 32, GPUBufferUsage.UNIFORM | D);

    this.packed = new Float32Array(this.maxEmitters * EMITTER_FLOATS);
    this.emitterWorld = new Float32Array(this.maxEmitters * 16);
    for (let i = 0; i < this.maxEmitters; i++) { this.emitterWorld[i * 16] = this.emitterWorld[i * 16 + 5] = this.emitterWorld[i * 16 + 10] = this.emitterWorld[i * 16 + 15] = 1; }
    this.requestData = new Uint32Array(this.maxEmitters * 4);
    this.paramU32 = new Uint32Array(this.paramData); this.paramF32 = new Float32Array(this.paramData);

    // dead list = [0 .. N-1] (a stack), counters = {alive A, alive B, dead = N, spawned, rejected}
    const dead = new Uint32Array(N); for (let i = 0; i < N; i++) dead[i] = i;
    device.queue.writeBuffer(this.deadList, 0, dead);
    device.queue.writeBuffer(this.counters, 0, new Uint32Array([0, 0, N, 0, 0, 0, 0, 0]));
    device.queue.writeBuffer(this.args, 0, new Uint32Array(ARGS_BYTES / 4)); // dispatch (0,0,0): nothing to simulate yet

    // A buffer cannot be INDIRECT and writable storage in the same synchronization scope. simulate/emit never touch the
    // args, so they bind a dummy at slot 8; only finalize (which writes the args) gets the real buffer.
    const dummy = res.buffers.create(`${label}:ArgsDummy`, 64, S);
    const make = (args: GPUBuffer, tag: string) => device.createBindGroup({
      label: `${label}:${tag}`, layout: system.simLayout,
      entries: [this.params, this.emitterBuf, this.particles, this.aliveA, this.aliveB, this.deadList, this.counters, this.requestBuf, args]
        .map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    this.simBG = make(dummy, 'sim');
    this.finalizeBG = make(this.args, 'finalize');
  }

  /** Add an emitter (returns its index inside the pool). */
  addEmitter(config: EmitterConfig): number {
    if (this.emitters.length >= this.maxEmitters) throw new Error(`Pool '${this.config.name ?? this.id}' supports at most ${this.maxEmitters} emitters`);
    this.emitters.push(new EmitterRuntime({ seed: 1 + this.id * 977 + this.emitters.length * 31, ...config }));
    return this.emitters.length - 1;
  }

  /** Column-major 4x4 world matrix of an emitter (position/orientation/scale of the spawn shape). */
  setEmitterTransform(emitter: number, m: ArrayLike<number>): void { for (let i = 0; i < 16; i++) this.emitterWorld[emitter * 16 + i] = m[i]; }

  /** CPU tick: schedule spawns, pack emitters/requests/params for this frame's GPU work. */
  update(dt: number, time: number): void {
    const { device } = this.system.gpu;
    let total = 0, count = 0, requested = 0;
    for (let e = 0; e < this.emitters.length; e++) {
      const n = this.emitters[e].tick(dt);
      requested += n;
      if (n <= 0) continue;
      const take = Math.min(n, Math.max(0, this.config.maxCount - total)); // a single frame can never exceed the pool
      if (take <= 0) continue;
      this.requestData.set([e, take, total, 0], count * 4);
      total += take; count++;
    }
    this.spawnTotal = total;
    this.spawnedThisFrame = total; this.requestedThisFrame = requested;

    for (let e = 0; e < this.emitters.length; e++) packEmitter(this.emitters[e].source, this.emitterWorld.subarray(e * 16, e * 16 + 16), this.packed, e * EMITTER_FLOATS);
    if (this.emitters.length) device.queue.writeBuffer(this.emitterBuf, 0, this.packed.buffer, 0, this.emitters.length * EMITTER_BYTES);
    if (count) device.queue.writeBuffer(this.requestBuf, 0, this.requestData.buffer, 0, count * 16);

    const mesh = this.config.mesh ? this.system.meshes.get(this.config.mesh.meshId) : null;
    this.paramF32[0] = dt; this.paramF32[1] = time;
    this.paramU32[2] = this.frame; this.paramU32[3] = this.cur; this.paramU32[4] = this.config.maxCount; this.paramU32[5] = total; this.paramU32[6] = count;
    this.paramU32[7] = mesh ? mesh.indexCount : 0; this.paramU32[8] = mesh ? mesh.firstIndex : 0; this.paramU32[9] = mesh ? mesh.baseVertex : 0;
    device.queue.writeBuffer(this.params, 0, this.paramData);
  }

  /** Record this pool's compute kernels (reset -> simulate -> emit -> finalize) and flip the ping-pong lists. */
  encodeCompute(enc: GPUCommandEncoder): void {
    const sys = this.system;
    const pass = enc.beginComputePass({ label: `particles:${this.config.name ?? this.id}` });
    pass.setBindGroup(0, this.simBG);
    pass.setPipeline(sys.kernel('reset')); pass.dispatchWorkgroups(1);
    pass.setPipeline(sys.kernel('simulate')); pass.dispatchWorkgroupsIndirect(this.args, ARGS_DISPATCH);
    if (this.spawnTotal > 0) { pass.setPipeline(sys.kernel('emit')); pass.dispatchWorkgroups(Math.ceil(this.spawnTotal / WORKGROUP)); }
    pass.setBindGroup(0, this.finalizeBG);
    pass.setPipeline(sys.kernel('finalize')); pass.dispatchWorkgroups(1);
    pass.end();

    // survivors of this frame live in the NEXT list: that is what renders; it becomes `cur` for the next frame
    this.renderList = 1 - this.cur;
    const bb = this.config.billboard;
    const rp = new Float32Array(8), rpu = new Uint32Array(rp.buffer);
    rpu[0] = this.renderList; rpu[1] = bb ? ORIENTATION_ID[bb.orientation ?? 'screen'] : 0; rpu[2] = bb?.blend === 'additive' ? 1 : 0;
    rp[4] = bb?.nearFade?.[0] ?? 0; rp[5] = bb?.nearFade?.[1] ?? 0;
    sys.gpu.device.queue.writeBuffer(this.renderParams, 0, rp);
    this.cur = 1 - this.cur; this.frame++;
  }

  /** Record the indirect draw (alive count never leaves the GPU). */
  encodeDraw(pass: GPURenderPassEncoder, frameBG: GPUBindGroup): void {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameBG);
    pass.setBindGroup(1, this.renderBG);
    if (this.config.mesh) {
      pass.setVertexBuffer(0, this.system.meshes.vertexBuffer);
      pass.setIndexBuffer(this.system.meshes.indexBuffer, 'uint32');
      pass.drawIndexedIndirect(this.args, ARGS_DRAW_INDEXED);
    } else pass.drawIndirect(this.args, ARGS_DRAW);
  }

  /** DEBUG ONLY (stalls the GPU): read the live counters back. Never call from the frame loop. */
  async readCounters(): Promise<ParticleCounters> {
    const { device } = this.system.gpu;
    const rb = device.createBuffer({ size: 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(this.counters, 0, rb, 0, 32); device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const u = new Uint32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
    // alive[cur-from-last-frame...]: after encodeCompute, `renderList` holds this frame's survivors
    return { alive: u[this.renderList], dead: u[2], spawned: u[3], rejected: u[4] };
  }

  /** DEBUG ONLY: read `count` particle structs (16 floats each) back. */
  async readParticles(count: number): Promise<Float32Array> {
    const { device } = this.system.gpu;
    const rb = device.createBuffer({ size: count * 64, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(this.particles, 0, rb, 0, count * 64); device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const f = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
    return f;
  }

  /** DEBUG ONLY: read the first `count` entries of the dead-index stack. */
  async readDeadIndices(count: number): Promise<Uint32Array> {
    const { device } = this.system.gpu;
    const size = Math.max(4, count * 4);
    const rb = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(this.deadList, 0, rb, 0, size); device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const u = new Uint32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
    return u;
  }

  /** DEBUG ONLY: read the indirect argument buffer (16 u32). */
  async readArgs(): Promise<Uint32Array> {
    const { device } = this.system.gpu;
    const rb = device.createBuffer({ size: ARGS_BYTES, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(this.args, 0, rb, 0, ARGS_BYTES); device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const u = new Uint32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
    return u;
  }

  /** DEBUG ONLY: read the alive list of the current render list. */
  async readAliveIndices(count: number): Promise<Uint32Array> {
    const { device } = this.system.gpu;
    const rb = device.createBuffer({ size: Math.max(4, count * 4), usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(this.renderList === 0 ? this.aliveA : this.aliveB, 0, rb, 0, Math.max(4, count * 4)); device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const u = new Uint32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
    return u;
  }
}

/**
 * GPU-driven particle system. Owns the shared compute pipelines/layouts and a set of pools. Per frame:
 *   system.update(dt, time)        CPU: spawn scheduling + uniform packing (cheap)
 *   system.encodeCompute(encoder)  GPU: emit / simulate / compact (indirect dispatch sized by the alive count)
 *   system.encodeDraw(pass, frame) GPU: one indirect draw per pool (alive count never read back)
 */
export class ParticleSystem {
  readonly pools: ParticlePool[] = [];
  readonly simLayout: GPUBindGroupLayout;
  private spriteDefault: TextureRef | null = null;

  constructor(readonly gpu: GPUContext, readonly layouts: BindLayouts, readonly meshes: MeshManager, readonly target: { colorFormat: GPUTextureFormat; depthFormat: GPUTextureFormat; sampleCount: number }) {
    const { device, resources: res } = gpu;
    registerEngineShaderChunks(res.shaders);
    const C = GPUShaderStage.COMPUTE;
    const entries: GPUBindGroupLayoutEntry[] = [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: C, buffer: { type: 'storage' } },
      { binding: 3, visibility: C, buffer: { type: 'storage' } },
      { binding: 4, visibility: C, buffer: { type: 'storage' } },
      { binding: 5, visibility: C, buffer: { type: 'storage' } },
      { binding: 6, visibility: C, buffer: { type: 'storage' } },
      { binding: 7, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 8, visibility: C, buffer: { type: 'storage' } },
    ];
    this.simLayout = device.createBindGroupLayout({ label: 'particles-sim-layout', entries });
  }

  /** Cached compute pipeline for one kernel entry point (created once; never per frame). */
  kernel(entry: 'reset' | 'simulate' | 'emit' | 'finalize'): GPUComputePipeline {
    const { device, resources: res } = this.gpu;
    return res.pipelines.getCompute(`particles-sim:${entry}`, () => {
      const module = res.shaders.get('particles-sim', simSource);
      return device.createComputePipeline({
        label: `particles-sim:${entry}`, compute: { module, entryPoint: entry },
        layout: device.createPipelineLayout({ bindGroupLayouts: [this.simLayout] }),
      });
    });
  }

  /** 1x1-ish soft white disc (radial falloff) used when a pool has no texture. */
  private defaultSprite(): TextureRef {
    if (this.spriteDefault) return this.spriteDefault;
    const { device, resources: res } = this.gpu;
    const S = 64, data = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.hypot((x + 0.5) / S - 0.5, (y + 0.5) / S - 0.5) * 2;
      const a = Math.max(0, 1 - d); const v = Math.round(255 * a * a * (3 - 2 * a));
      data.set([255, 255, 255, v], (y * S + x) * 4);
    }
    const tex = res.textures.create({ label: 'particle-soft-disc', size: [S, S], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: S * 4 }, [S, S]);
    return (this.spriteDefault = { id: 'particle-soft-disc', view: tex.createView() });
  }

  createPool(config: ParticlePoolConfig): ParticlePool {
    if (!config.billboard === !config.mesh) throw new Error('A particle pool needs exactly one of `billboard` or `mesh`');
    const { device, resources: res } = this.gpu;
    const pool = new ParticlePool(this, config, this.pools.length);
    const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    const ro = (binding: number, vis: number): GPUBindGroupLayoutEntry => ({ binding, visibility: vis, buffer: { type: 'read-only-storage' } });
    const common: GPUBindGroupLayoutEntry[] = [ro(0, V), ro(1, V), ro(2, V), ro(3, V), { binding: 4, visibility: V | F, buffer: { type: 'uniform' } }];
    const isBillboard = !!config.billboard;
    const layout = device.createBindGroupLayout({
      label: 'particles-render-layout',
      entries: isBillboard ? [...common, { binding: 5, visibility: F, sampler: { type: 'filtering' } }, { binding: 6, visibility: F, texture: { sampleType: 'float' } }] : common,
    });
    const bufs = [pool.particles, pool.aliveA, pool.aliveB, pool.emitterBuf, pool.renderParams];
    const entries: GPUBindGroupEntry[] = bufs.map((buffer, binding) => ({ binding, resource: { buffer } }));
    if (isBillboard) {
      const tex = config.billboard!.texture ?? this.defaultSprite();
      entries.push({ binding: 5, resource: res.samplers.get({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }) });
      entries.push({ binding: 6, resource: tex.view });
    }
    pool.renderBG = device.createBindGroup({ label: `${config.name ?? pool.id}:render`, layout, entries });

    const blendMode = isBillboard ? (config.billboard!.blend ?? 'alpha') : (config.mesh!.blend ?? 'opaque');
    const blend: GPUBlendState | undefined = blendMode === 'additive'
      ? { color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } }
      : blendMode === 'alpha'
        ? { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } }
        : undefined;
    const t = this.target;
    pool.pipeline = res.pipelines.getRender({
      shader: isBillboard ? 'particles-billboard' : 'particles-mesh', vertexEntry: 'vs_main', fragmentEntry: 'fs_main',
      vertexLayout: isBillboard ? [] : STANDARD_VERTEX_LAYOUT, topology: 'triangle-list', cullMode: isBillboard ? 'none' : 'back',
      depth: { format: t.depthFormat, write: blendMode === 'opaque', compare: 'less-equal' },
      targets: [{ format: t.colorFormat, blend: blend ?? null }], sampleCount: t.sampleCount, layout: `particles-${isBillboard ? 'b' : 'm'}`,
    }, () => {
      const module = res.shaders.get(isBillboard ? 'particles-billboard' : 'particles-mesh', isBillboard ? billboardSource : meshSource);
      return device.createRenderPipeline({
        label: isBillboard ? 'particles-billboard' : 'particles-mesh',
        layout: device.createPipelineLayout({ bindGroupLayouts: [this.layouts.frame, layout] }),
        vertex: { module, entryPoint: 'vs_main', buffers: isBillboard ? [] : toGPUVertexBuffers(STANDARD_VERTEX_LAYOUT) },
        fragment: { module, entryPoint: 'fs_main', targets: [{ format: t.colorFormat, blend }] },
        primitive: { topology: 'triangle-list', cullMode: isBillboard ? 'none' : 'back' },
        depthStencil: { format: t.depthFormat, depthWriteEnabled: blendMode === 'opaque', depthCompare: 'less-equal' },
        multisample: { count: t.sampleCount },
      });
    });
    this.pools.push(pool);
    return pool;
  }

  update(dt: number, time: number): void { for (const p of this.pools) p.update(dt, time); }
  encodeCompute(enc: GPUCommandEncoder): void { for (const p of this.pools) p.encodeCompute(enc); }
  encodeDraw(pass: GPURenderPassEncoder, frameBG: GPUBindGroup): void { for (const p of this.pools) p.encodeDraw(pass, frameBG); }
}
