import type { GPUContext } from '../../gpu/GPUContext';
import { registerEngineShaderChunks } from '../../shaders';
import cullSrc from '../../shaders/cluster_cull.wgsl?raw';
import { LIGHT_BYTES, type LightData } from './LightData';
import { technique } from '../graph/TechniqueBuilder';
import type { TechniqueInstance } from '../graph/TechniqueInstance';
import type { SceneResources } from './SceneResources';
import { FeatureOrder, type FeatureFrame, type RenderFeature } from '../RenderFeature';
import type { RenderGraph } from '../RenderGraph';

export interface ClusterConfig {
  /** Tile size in pixels (screen-space cluster XY). */
  tileSize: number;
  /** Exponential depth slices between near and far. */
  slices: number;
  /** Light-list capacity per cluster; extra lights are dropped (counted by the stats of the demo/benchmark). */
  maxLightsPerCluster: number;
}

export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = { tileSize: 64, slices: 24, maxLightsPerCluster: 256 };

/**
 * Clustered forward light assignment. A compute pass (one thread per cluster) builds, for every screen-tile x depth-slice
 * cluster, the list of ranged lights that can reach it. The fragment shader then loops only over its own cluster's list
 * (plus the few global lights). Buffers are the same ones bound in the scene bind group (2 = grid, 3 = indices).
 *
 * The pass is a compute node of a technique (see TECHNIQUES.md): the light buffer, the grid, the index lists and the overflow counter are imported
 * resources, the camera and grid description are variables.
 */
export class ClusterGrid implements RenderFeature {
  readonly name = 'light-clusters';
  order = FeatureOrder.clusters;
  readonly produces = ['clusterGrid'];
  /** false = every fragment loops over every light (the naive baseline). */
  enabled = true;
  /** Clustered shading is used this frame: it is `enabled` and the scene has ranged lights to assign. Set by `beginFrame`. */
  active = false;
  dims: [number, number, number] = [1, 1, 1];
  private grid: GPUBuffer | null = null;
  private indices: GPUBuffer | null = null;
  private overflowBuf: GPUBuffer;
  private fx: TechniqueInstance;
  private width = 0;
  private height = 0;
  /** Dispatches issued (diagnostics / tests). */
  dispatches = 0;

  /** Create the technique, and the overflow counter, for clustered light assignment (screen tiles x exponential depth slices). */
  constructor(private gpu: GPUContext, private scene: SceneResources, readonly config: ClusterConfig = { ...DEFAULT_CLUSTER_CONFIG }) {
    registerEngineShaderChunks(gpu.resources.shaders);
    this.overflowBuf = gpu.resources.buffers.create('ClusterOverflow', 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
    const g = technique('light-clusters');
    for (const v of ['view0', 'view1', 'view2', 'view3', 'screen', 'proj']) g.float4(v);
    for (const v of ['dimX', 'dimY', 'dimZ', 'tile', 'lightCount', 'globalCount', 'maxLights', 'clusters']) g.uint(v);
    const lights = g.buffer('lights', { element: 'Light', stride: LIGHT_BYTES, visibility: 'imported' });
    const grid = g.buffer('clusterGrid', { element: 'vec2<u32>', visibility: 'imported' });
    const indices = g.buffer('clusterIndices', { element: 'u32', visibility: 'imported' });
    const overflow = g.buffer('overflow', { element: 'atomic<u32>', stride: 4, count: 1, visibility: 'imported' });
    g.callback('clear-overflow', { writes: [overflow], execute: (enc) => enc.clearBuffer(this.overflowBuf) });
    g.compute('cluster-cull', {
      shader: cullSrc, reads: [lights], writes: [grid, indices], readWrites: [overflow],
      dispatch: { threads: [g.variableNamed('clusters')] },
    });
    this.fx = g.instantiate(gpu, { label: 'light-clusters', imports: { overflow: this.overflowBuf } });
  }

  // ---- RenderFeature hooks ----

  /** Decide whether clusters are used this frame and size the grid for the canvas (before the scene uniform is written). */
  beginFrame(f: FeatureFrame): void {
    this.active = this.enabled && f.lights.count > f.lights.globalCount;
    if (this.active) this.resize(f.width, f.height);
  }

  /** The light-assignment compute pass. */
  addPasses(graph: RenderGraph, f: FeatureFrame): void {
    if (!this.active || !f.hasCamera) return;
    const cam = f.camera;
    graph.addPass({
      name: 'clusters', reads: ['lights'], writes: ['clusterGrid'],
      execute: (enc) => this.encode(enc, cam.view, cam.projection[0], cam.projection[5], cam.near, cam.far, f.lights, f.profiler.writes('clusters')),
    });
  }

  // ---- implementation ----

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
  }

  /**
   * Append the light-assignment compute pass to `enc`. `view` is the camera view matrix; `proj00` / `proj11` are the
   * projection's x / y scale terms. Call after `scene.syncLights` (the light buffer must hold this frame's lights).
   */
  encode(enc: GPUCommandEncoder, view: ArrayLike<number>, proj00: number, proj11: number, near: number, far: number, lights: LightData, timestampWrites?: GPUComputePassTimestampWrites): void {
    if (!this.grid || lights.count === 0) return;
    const fx = this.fx, c = this.config;
    fx.setImport('lights', this.scene.lightBuffer);
    fx.setImport('clusterGrid', this.grid);
    fx.setImport('clusterIndices', this.indices!);
    for (let i = 0; i < 4; i++) fx.setVariable(`view${i}`, Array.from(view as ArrayLike<number>).slice(i * 4, i * 4 + 4));
    fx.setVariable('screen', [this.width, this.height, near, far]);
    fx.setVariable('proj', [proj00, proj11, 0, 0]);
    this.dims.forEach((d, i) => fx.setVariable(['dimX', 'dimY', 'dimZ'][i], d));
    fx.setVariable('tile', c.tileSize);
    fx.setVariable('lightCount', lights.count); fx.setVariable('globalCount', lights.globalCount); fx.setVariable('maxLights', c.maxLightsPerCluster);
    fx.setVariable('clusters', this.clusterCount);
    fx.execute(enc, { timestampWrites: () => timestampWrites });
    this.dispatches++;
  }
}
