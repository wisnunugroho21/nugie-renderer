import type { GPUContext } from '../../gpu/GPUContext';
import type { BindLayouts } from '../../gpu/BindLayouts';
import { registerEngineShaderChunks } from '../../shaders';
import volumetricSrc from '../../shaders/volumetric.wgsl?raw';
import type { SceneResources } from './SceneResources';
import { FeatureOrder, type FeatureFrame, type RenderFeature } from '../RenderFeature';
import type { RenderGraph } from '../RenderGraph';
import { Mat4 } from '../../math/Mat4';
import { technique } from '../graph/TechniqueBuilder';
import type { TechniqueInstance } from '../graph/TechniqueInstance';

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
 * The fill is a compute node of a technique (see TECHNIQUES.md): the volume is its exported 3D texture (sized by the froxel counts), the
 * camera and grid description are variables, and the engine's frame and scene bind groups are supplied by the host.
 */
export class VolumetricFog implements RenderFeature {
  readonly name = 'volumetric-fog';
  order = FeatureOrder.fog;
  readonly produces = ['fogVolume'];
  enabled = true;
  settings: FogSettings = { ...DEFAULT_FOG };
  readonly tile = 8;
  readonly slices = 48;
  private fx: TechniqueInstance;
  private dims: [number, number, number] = [1, 1, 1];
  private width = 0;
  private height = 0;

  /** Create the froxel-fill technique (frame + scene bind groups from the host, the volume and its parameters from the technique). */
  constructor(gpu: GPUContext, layouts: BindLayouts, private scene: SceneResources) {
    registerEngineShaderChunks(gpu.resources.shaders);
    const g = technique('volumetric-fog');
    for (const v of ['camWorld0', 'camWorld1', 'camWorld2', 'camWorld3', 'screen', 'proj']) g.float4(v);
    const [dimX, dimY, dimZ] = ['dimX', 'dimY', 'dimZ'].map((v) => g.uint(v, 1));
    g.uint('tile', this.tile);
    const volume = g.texture('fogVolume', { format: 'rgba16float', dimension: '3d', size: [dimX, dimY, dimZ], visibility: 'exported' });
    g.compute('volumetric-fog', {
      shader: DEFINES + volumetricSrc, writes: [{ resource: volume, name: 'volOut' }], dispatch: { threads: [dimX, dimY] }, workgroupSize: [8, 8, 1],
      group: 2, hostGroups: [{ group: 0, layout: 'frame' }, { group: 1, layout: 'scene' }],
    });
    this.fx = g.instantiate(gpu, { label: 'volumetric-fog', hostLayouts: { frame: layouts.frame, scene: layouts.scene } });
  }

  /** The froxel volume (rgba16float 3D: accumulated in-scatter and transmittance), once `resize` ran. */
  get volume(): GPUTexture | null { return this.width > 0 ? (this.fx.resource('fogVolume') as GPUTexture) : null; }

  // ---- RenderFeature hooks ----

  /** Switch the fog off in the scene and free the volume. */
  dispose(): void {
    this.scene.fog.enabled = false;
    this.scene.setFogVolume(null);
    this.width = 0;
    this.fx.dispose();
  }

  /** Size the volume for the canvas and mirror the settings into the scene uniform (before it is written). */
  beginFrame(f: FeatureFrame): void {
    if (!f.hasCamera) return;
    this.resize(f.width, f.height);
    this.applySettings();
  }

  /** The froxel fill pass: reads the shadow map and the light clusters. */
  addPasses(graph: RenderGraph, f: FeatureFrame): void {
    if (!this.enabled || !f.hasCamera) return;
    const cam = f.camera, camWorld = Mat4.invert(Mat4.create(), cam.view);
    if (!camWorld) return;
    graph.addPass({
      name: 'volumetrics', reads: ['shadowMap', 'clusterGrid', 'lights'], writes: ['fogVolume'],
      execute: (enc) => this.encode(enc, f.frameBindGroup, camWorld, cam.projection[0], cam.projection[5], cam.near, f.profiler.writes('fog')),
    });
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
    ['dimX', 'dimY', 'dimZ'].forEach((v, i) => this.fx.setVariable(v, this.dims[i]));   // sizes the volume: the technique recompiles and re-creates it
    this.scene.setFogVolume((this.fx.resource('fogVolume') as GPUTexture).createView({ dimension: '3d' }));
  }

  /** Append the volume fill. `camWorld` is the camera world matrix (inverse view). `frameBG` is the renderer's frame bind group. */
  encode(enc: GPUCommandEncoder, frameBG: GPUBindGroup, camWorld: ArrayLike<number>, proj00: number, proj11: number, near: number, timestampWrites?: GPUComputePassTimestampWrites): void {
    if (!this.enabled || this.width === 0) return;
    const fx = this.fx;
    fx.setVectors('camWorld', camWorld, 4);
    fx.setVariable('screen', [this.width, this.height, near, this.settings.maxDistance]);
    fx.setVariable('proj', [proj00, proj11, 0, 0]);
    fx.setHostBindGroup('frame', frameBG);
    fx.setHostBindGroup('scene', this.scene.volumePassBindGroup);
    fx.execute(enc, { timestampWrites: () => timestampWrites });
  }
}
