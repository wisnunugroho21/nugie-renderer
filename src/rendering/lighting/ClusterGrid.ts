import type { GPUContext } from '../../gpu/GPUContext';
import { registerEngineShaderChunks } from '../../shaders';
import cullSrc from '../../shaders/cluster_cull.wgsl?raw';
import type { LightData } from './LightData';
import type { SceneResources } from './SceneResources';

export interface ClusterConfig {
  /** Tile size in pixels (screen-space cluster XY). */
  tileSize: number;
  /** Exponential depth slices between near and far. */
  slices: number;
  /** Light-list capacity per cluster; extra lights are dropped (counted by the stats of the demo/benchmark). */
  maxLightsPerCluster: number;
}

export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = { tileSize: 64, slices: 24, maxLightsPerCluster: 256 };

/** Params uniform size: mat4 + 4 x vec4 = 144 bytes. */
const PARAMS_BYTES = 64 + 4 * 16;

/**
 * Clustered forward light assignment. A compute pass (one thread per cluster) builds, for every screen-tile x depth-slice
 * cluster, the list of ranged lights that can reach it. The fragment shader then loops only over its own cluster's list
 * (plus the few global lights). Buffers are the same ones bound in the scene bind group (2 = grid, 3 = indices).
 */
export class ClusterGrid {
  dims: [number, number, number] = [1, 1, 1];
  private grid: GPUBuffer | null = null;
  private indices: GPUBuffer | null = null;
  private params: GPUBuffer;
  private overflowBuf: GPUBuffer;
  private pipeline: GPUComputePipeline;
  private bindGroup: GPUBindGroup | null = null;
  private lightBufferSeen: GPUBuffer | null = null;
  private data = new ArrayBuffer(PARAMS_BYTES);
  private f32 = new Float32Array(this.data);
  private u32 = new Uint32Array(this.data);
  private width = 0;
  private height = 0;
  /** Dispatches issued (diagnostics / tests). */
  dispatches = 0;

  /** Create the compute pipeline, parameter buffer and overflow counter for clustered light assignment (screen tiles x exponential depth slices). */
  constructor(private gpu: GPUContext, private scene: SceneResources, readonly config: ClusterConfig = { ...DEFAULT_CLUSTER_CONFIG }) {
    registerEngineShaderChunks(gpu.resources.shaders);
    this.params = gpu.resources.buffers.create('ClusterParams', PARAMS_BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.overflowBuf = gpu.resources.buffers.create('ClusterOverflow', 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
    this.pipeline = gpu.device.createComputePipeline({
      label: 'cluster-cull', layout: 'auto',
      compute: { module: gpu.resources.shaders.get('cluster-cull', cullSrc), entryPoint: 'main' },
    });
  }

  /** Buffers for inspection by tests / tools. */
  get buffers(): { grid: GPUBuffer; indices: GPUBuffer; overflow: GPUBuffer } { return { grid: this.grid!, indices: this.indices!, overflow: this.overflowBuf }; }

  /** Total clusters (tiles x tiles x slices) in the current grid. */
  get clusterCount(): number { return this.dims[0] * this.dims[1] * this.dims[2]; }

  /** (Re)allocate the grid for a render-target size. */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height && this.grid) return;
    this.width = width; this.height = height;
    const c = this.config;
    this.dims = [Math.max(1, Math.ceil(width / c.tileSize)), Math.max(1, Math.ceil(height / c.tileSize)), c.slices];
    const r = this.gpu.resources.buffers, S = GPUBufferUsage.STORAGE;
    if (this.grid) r.destroy(this.grid);
    if (this.indices) r.destroy(this.indices);
    this.grid = r.create('ClusterGridBuffer', this.clusterCount * 8, S | GPUBufferUsage.COPY_SRC);
    this.indices = r.create('ClusterLightIndexBuffer', this.clusterCount * c.maxLightsPerCluster * 4, S | GPUBufferUsage.COPY_SRC);
    this.scene.setClusterBuffers(this.grid, this.indices);
    this.bindGroup = null;
  }

  /**
   * Append the light-assignment compute pass to `enc`. `view` is the camera view matrix; `proj00` / `proj11` are the
   * projection's x / y scale terms. Call after `scene.syncLights` (the light buffer must hold this frame's lights).
   */
  encode(enc: GPUCommandEncoder, view: ArrayLike<number>, proj00: number, proj11: number, near: number, far: number, lights: LightData, timestampWrites?: GPUComputePassTimestampWrites): void {
    if (!this.grid || lights.count === 0) return;
    const lb = this.scene.lightBuffer;
    if (this.lightBufferSeen !== lb) { this.lightBufferSeen = lb; this.bindGroup = null; }
    this.bindGroup ??= this.gpu.device.createBindGroup({
      label: 'cluster-cull-bg', layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: { buffer: lb } },
        { binding: 2, resource: { buffer: this.grid } },
        { binding: 3, resource: { buffer: this.indices! } },
        { binding: 4, resource: { buffer: this.overflowBuf } },
      ],
    });
    const f = this.f32, u = this.u32;
    for (let i = 0; i < 16; i++) f[i] = view[i];
    u[16] = this.dims[0]; u[17] = this.dims[1]; u[18] = this.dims[2]; u[19] = this.config.tileSize;
    f[20] = this.width; f[21] = this.height; f[22] = near; f[23] = far;
    f[24] = proj00; f[25] = proj11;
    u[28] = lights.count; u[29] = lights.globalCount; u[30] = this.config.maxLightsPerCluster;
    this.gpu.device.queue.writeBuffer(this.params, 0, this.data);
    enc.clearBuffer(this.overflowBuf);
    const pass = enc.beginComputePass({ label: 'cluster-cull', timestampWrites });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.clusterCount / 64));
    pass.end();
    this.dispatches++;
  }
}
