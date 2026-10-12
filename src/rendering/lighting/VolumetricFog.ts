import type { GPUContext } from '../../gpu/GPUContext';
import type { BindLayouts } from '../../gpu/BindLayouts';
import { registerEngineShaderChunks } from '../../shaders';
import volumetricSrc from '../../shaders/volumetric.wgsl?raw';
import type { SceneResources } from './SceneResources';
import { FeatureOrder, type FeatureFrame, type RenderFeature } from '../RenderFeature';
import type { FrameBuilder } from '../graph/FrameGraph';
import { Mat4 } from '../../math/Mat4';
import { technique } from '../graph/TechniqueBuilder';
import { TechniqueInstance } from '../graph/TechniqueInstance';
import type { Technique } from '../graph/TechniqueTypes';
import type { VariableValue } from '../graph/Flatten';

export interface FogSettings {
  /** Extinction per world unit at height 0. */
  density: number;
  /** Exponential height falloff (0 = homogeneous fog). */
  heightFalloff: number;
  /** Henyey-Greenstein anisotropy g in (-1, 1): > 0 favours forward scattering (light shafts toward the sun). */
  anisotropy: number;
  /** Ambient in-scatter colour (sky glow inside the fog). */
  ambient: [number, number, number];
  /** Distance covered by the volume; pixels farther away get the full accumulated fog. */
  maxDistance: number;
}

export const DEFAULT_FOG: FogSettings = { density: 0.02, heightFalloff: 0.1, anisotropy: 0.4, ambient: [0.02, 0.025, 0.035], maxDistance: 120 };

/** The shader module is built without skinning / morphing, like the engine's other non-mesh passes. */
const DEFINES = 'const HAS_MORPH_TARGETS: bool = false;\nconst HAS_SKINNING: bool = false;\n';

/**
 * Froxel volumetric fog: a 3D texture (screen tiles x exponential depth slices) holding in-scattered light and transmittance
 * accumulated from the camera. A compute pass fills it each frame (directional + ranged lights, shadow-mapped); mesh and sky
 * shading apply it with one lookup (`applyFog` in scene_eval.wgsl).
 *
 * The fill is a compute node of a technique (see TECHNIQUES.md): the volume is an imported 3D texture (created here, sized by the froxel counts), the
 * camera and grid description are variables, and the engine's frame and scene bind groups are supplied by the host. In a frame its node is part of the frame's
 * graph (`addPasses`); `encode` runs the same technique on its own (tests, tools).
 */
export class VolumetricFog implements RenderFeature {
  readonly name = 'volumetric-fog';
  order = FeatureOrder.fog;
  enabled = true;
  settings: FogSettings = { ...DEFAULT_FOG };
  readonly tile = 8;
  readonly slices = 48;
  private fx: TechniqueInstance;
  private readonly tech: Technique;
  private volumeTex: GPUTexture | null = null;
  private dims: [number, number, number] = [1, 1, 1];
  private width = 0;
  private height = 0;

  /** Create the froxel-fill technique (frame + scene bind groups from the host, the volume and its parameters from the technique). */
  constructor(private gpu: GPUContext, layouts: BindLayouts, private scene: SceneResources) {
    registerEngineShaderChunks(gpu.resources.shaders);
    const g = technique('volumetric-fog');
    for (const v of ['camWorld0', 'camWorld1', 'camWorld2', 'camWorld3', 'screen', 'proj']) g.float4(v);
    const [dimX, dimY] = ['dimX', 'dimY', 'dimZ'].map((v) => g.uint(v, 1));
    g.uint('tile', this.tile);
    const volume = g.texture('fogVolume', { format: 'rgba16float', dimension: '3d', visibility: 'imported' });   // created by `resize`, sized by the froxel counts
    g.compute('volumetric-fog', {
      shader: DEFINES + volumetricSrc, writes: [{ resource: volume, name: 'volOut' }], dispatch: { threads: [dimX, dimY] }, workgroupSize: [8, 8, 1],
      group: 2, hostGroups: [{ group: 0, layout: 'frame' }, { group: 1, layout: 'scene' }],
    });
    this.tech = g.build();
    this.fx = TechniqueInstance.create(gpu, this.tech, { label: 'volumetric-fog', hostLayouts: { frame: layouts.frame, scene: layouts.scene } });
  }

  /** The froxel volume (rgba16float 3D: accumulated in-scatter and transmittance), once `resize` ran. */
  get volume(): GPUTexture | null { return this.width > 0 ? this.volumeTex : null; }

  // ---- RenderFeature hooks ----

  /** Switch the fog off in the scene and free the volume. */
  dispose(): void {
    this.scene.fog.enabled = false;
    this.scene.setFogVolume(null);
    this.width = 0;
    this.fx.dispose();
    if (this.volumeTex) this.gpu.resources.textures.destroy(this.volumeTex);
    this.volumeTex = null;
  }

  /** Size the volume for the canvas and mirror the settings into the scene uniform (before it is written). */
  beginFrame(f: FeatureFrame): void {
    if (!f.hasCamera) return;
    this.resize(f.width, f.height);
    this.applySettings();
  }

  /** The froxel fill pass: reads the shadow map and the light clusters. */
  addPasses(graph: FrameBuilder, f: FeatureFrame): void {
    if (!this.enabled || !f.hasCamera) return;
    const cam = f.camera, camWorld = Mat4.invert(Mat4.create(), cam.view);
    if (!camWorld || !this.volumeTex) return;
    graph.include('fog', this.tech, {
      imports: { fogVolume: { as: 'fogVolume', resource: this.volumeTex } },
      variables: this.frameValues(camWorld, cam.projection[0], cam.projection[5], cam.near),
      // the froxel shader reads the shadow map, the light clusters and the lights through the scene bind group
      after: ['shadowMap', 'clusterGrid', 'lights'].filter((name) => graph.hasResource(name)),
      publish: ['fogVolume'],
    });
    graph.hostGroup('frame', f.frameBindGroup);
    graph.hostGroup('scene', this.scene.volumePassBindGroup);
    const timestampWrites = f.profiler.writes('fog');
    graph.timestamps('fog', () => timestampWrites);
  }

  // ---- implementation ----

  /** Froxel grid size [x, y, z] (screen tiles x depth slices). */
  get froxels(): [number, number, number] { return this.dims; }

  /** Mirror the settings into the scene uniform; call every frame before the uniform is written. */
  applySettings(): void {
    const f = this.scene.fog, s = this.settings;
    f.enabled = this.enabled; f.density = s.density; f.heightFalloff = s.heightFalloff; f.anisotropy = s.anisotropy; f.far = s.maxDistance; f.tile = this.tile; f.ambient = s.ambient;
  }

  /** (Re)allocate the volume for a render-target size. */
  resize(width: number, height: number): void {
    if (this.width > 0 && width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    this.dims = [Math.max(1, Math.ceil(width / this.tile)), Math.max(1, Math.ceil(height / this.tile)), this.slices];
    if (this.volumeTex) this.gpu.resources.textures.destroy(this.volumeTex);
    this.volumeTex = this.gpu.resources.textures.create({
      label: 'fog-volume', size: { width: this.dims[0], height: this.dims[1], depthOrArrayLayers: this.dims[2] }, dimension: '3d', format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this.fx.setImport('fogVolume', this.volumeTex);
    this.scene.setFogVolume(this.volumeTex.createView({ dimension: '3d' }));
  }

  /** Append the volume fill. `camWorld` is the camera world matrix (inverse view). `frameBG` is the renderer's frame bind group. */
  encode(enc: GPUCommandEncoder, frameBG: GPUBindGroup, camWorld: ArrayLike<number>, proj00: number, proj11: number, near: number, timestampWrites?: GPUComputePassTimestampWrites): void {
    if (!this.enabled || this.width === 0) return;
    const fx = this.fx;
    for (const [name, value] of Object.entries(this.frameValues(camWorld, proj00, proj11, near))) fx.setVariable(name, value);
    fx.setHostBindGroup('frame', frameBG);
    fx.setHostBindGroup('scene', this.scene.volumePassBindGroup);
    fx.execute(enc, { timestampWrites: () => timestampWrites });
  }

  /** The technique's variables for a camera: its world matrix, the screen and projection description and the froxel grid. */
  private frameValues(camWorld: ArrayLike<number>, proj00: number, proj11: number, near: number): Record<string, VariableValue> {
    const column = (i: number) => [camWorld[i * 4], camWorld[i * 4 + 1], camWorld[i * 4 + 2], camWorld[i * 4 + 3]];
    return {
      camWorld0: column(0), camWorld1: column(1), camWorld2: column(2), camWorld3: column(3),
      screen: [this.width, this.height, near, this.settings.maxDistance], proj: [proj00, proj11, 0, 0],
      dimX: this.dims[0], dimY: this.dims[1], dimZ: this.dims[2], tile: this.tile,
    };
  }
}
