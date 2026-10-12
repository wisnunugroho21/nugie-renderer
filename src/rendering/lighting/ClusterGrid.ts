import type { GPUContext } from '../../gpu/GPUContext';
import { registerEngineShaderChunks } from '../../shaders';
import cullSrc from '../../shaders/cluster_cull.wgsl?raw';
import { LIGHT_BYTES, type LightData } from './LightData';
import { technique } from '../graph/TechniqueBuilder';
import { TechniqueInstance } from '../graph/TechniqueInstance';
import type { Technique } from '../graph/TechniqueTypes';
import type { VariableValue } from '../graph/Flatten';
import type { SceneResources } from './SceneResources';
import { FeatureOrder, type FeatureFrame, type RenderFeature } from '../RenderFeature';
import type { FrameBuilder } from '../graph/FrameGraph';

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
 * The pass is a technique (see TECHNIQUES.md): the light buffer, the grid, the index lists and the overflow counter are imported resources, the camera and grid
 * description are variables. In a frame its nodes are part of the frame's graph (`addPasses`); `encode` runs the same technique on its own (tests, tools).
 */
export class ClusterGrid implements RenderFeature {
  readonly name = 'light-clusters';
  order = FeatureOrder.clusters;
  /** false = every fragment loops over every light (the naive baseline). */
  enabled = true;
  /** Clustered shading is used this frame: it is `enabled` and the scene has ranged lights to assign. Set by `beginFrame`. */
  active = false;
  dims: [number, number, number] = [1, 1, 1];
  private grid: GPUBuffer | null = null;
  private indices: GPUBuffer | null = null;
  private overflowBuf: GPUBuffer;
  private fx: TechniqueInstance;
  private readonly tech: Technique;
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
    const lights = g.importedBuffer('lights', 'Light', LIGHT_BYTES);
    const grid = g.importedBuffer('clusterGrid', 'vec2<u32>');
    const indices = g.importedBuffer('clusterIndices', 'u32');
    const overflow = g.importedBuffer('overflow', 'atomic<u32>', 4);
    g.clear('clear-overflow', overflow);
    g.compute('cluster-cull', {
      shader: cullSrc, reads: [lights], writes: [grid, indices], readWrites: [overflow],
      dispatch: { threads: [g.variableNamed('clusters')] },
    });
    this.tech = g.build();
    this.fx = TechniqueInstance.create(gpu, this.tech, { label: 'light-clusters', imports: { overflow: this.overflowBuf } });
  }

  // ---- RenderFeature hooks ----

  /** Stop assigning lights and free the pass. The grid and index buffers stay: the scene bind group still points at them. */
  dispose(): void {
    this.active = false;
    this.fx.dispose();
    this.gpu.resources.buffers.destroy(this.overflowBuf);
  }

  /** Decide whether clusters are used this frame and size the grid for the canvas (before the scene uniform is written). */
  beginFrame(f: FeatureFrame): void {
    this.active = this.enabled && f.lights.count > f.lights.globalCount;
    if (this.active) this.resize(f.width, f.height);
  }

  /** The light-assignment compute pass: the technique's nodes join the frame, reading the light buffer and writing the grid and index lists. */
  addPasses(graph: FrameBuilder, f: FeatureFrame): void {
    if (!this.active || !f.hasCamera || !this.grid) return;
    const cam = f.camera;
    graph.include('clusters', this.tech, {
      imports: {
        lights: { as: 'lights', resource: this.scene.lightBuffer }, clusterGrid: { as: 'clusterGrid', resource: this.grid },
        clusterIndices: { as: 'clusterIndices', resource: this.indices! }, overflow: this.overflowBuf,
      },
      variables: this.frameValues(cam.view, cam.projection[0], cam.projection[5], cam.near, cam.far, f.lights),
      publish: ['clusterGrid', 'clusterIndices'],
    });
    const timestampWrites = f.profiler.writes('clusters');
    graph.timestamps('clusters', () => timestampWrites);
    this.dispatches++;
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
    const fx = this.fx;
    fx.setImport('lights', this.scene.lightBuffer);
    fx.setImport('clusterGrid', this.grid);
    fx.setImport('clusterIndices', this.indices!);
    for (const [name, value] of Object.entries(this.frameValues(view, proj00, proj11, near, far, lights))) fx.setVariable(name, value);
    fx.execute(enc, { timestampWrites: () => timestampWrites });
    this.dispatches++;
  }

  /** The technique's variables for a camera and the frame's lights. */
  private frameValues(view: ArrayLike<number>, proj00: number, proj11: number, near: number, far: number, lights: LightData): Record<string, VariableValue> {
    const column = (i: number) => [view[i * 4], view[i * 4 + 1], view[i * 4 + 2], view[i * 4 + 3]];
    return {
      view0: column(0), view1: column(1), view2: column(2), view3: column(3),
      screen: [this.width, this.height, near, far], proj: [proj00, proj11, 0, 0],
      dimX: this.dims[0], dimY: this.dims[1], dimZ: this.dims[2], tile: this.config.tileSize,
      lightCount: lights.count, globalCount: lights.globalCount, maxLights: this.config.maxLightsPerCluster, clusters: this.clusterCount,
    };
  }
}
