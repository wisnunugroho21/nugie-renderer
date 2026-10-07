import type { GPUContext } from '../../gpu/GPUContext';
import type { BindLayouts } from '../../gpu/BindLayouts';
import { registerEngineShaderChunks } from '../../shaders';
import volumetricSrc from '../../shaders/volumetric.wgsl?raw';
import type { SceneResources } from './SceneResources';

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

const PARAM_BYTES = 64 + 3 * 16;

/**
 * Froxel volumetric fog: a 3D texture (screen tiles x exponential depth slices) holding in-scattered light and transmittance
 * accumulated from the camera. A compute pass fills it each frame (directional + ranged lights, shadow-mapped); mesh and sky
 * shading apply it with one lookup (`applyFog` in scene_eval.wgsl).
 */
export class VolumetricFog {
  enabled = true;
  settings: FogSettings = { ...DEFAULT_FOG };
  readonly tile = 8;
  readonly slices = 48;
  volume: GPUTexture | null = null;
  private pipeline: GPUComputePipeline;
  private paramsBuf: GPUBuffer;
  private paramsBG: GPUBindGroup | null = null;
  private pdata = new ArrayBuffer(PARAM_BYTES);
  private pf = new Float32Array(this.pdata);
  private pu = new Uint32Array(this.pdata);
  private dims: [number, number, number] = [1, 1, 1];
  private width = 0;
  private height = 0;

  constructor(private gpu: GPUContext, layouts: BindLayouts, private scene: SceneResources) {
    const { device, resources: r } = gpu;
    registerEngineShaderChunks(r.shaders);
    const volLayout = device.createBindGroupLayout({
      label: 'layout-volume',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
      ],
    });
    this.volLayout = volLayout;
    this.paramsBuf = r.buffers.create('VolumetricParams', PARAM_BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.pipeline = device.createComputePipeline({
      label: 'volumetric-fog', layout: device.createPipelineLayout({ bindGroupLayouts: [layouts.frame, layouts.scene, volLayout] }),
      compute: { module: r.shaders.get('volumetric', volumetricSrc, { HAS_SKINNING: false, HAS_MORPH_TARGETS: false }), entryPoint: 'main' },
    });
  }

  private volLayout: GPUBindGroupLayout;

  get froxels(): [number, number, number] { return this.dims; }

  /** Mirror the settings into the scene uniform; call every frame before the uniform is written. */
  applySettings(): void {
    const f = this.scene.fog, s = this.settings;
    f.enabled = this.enabled; f.density = s.density; f.heightFalloff = s.heightFalloff; f.anisotropy = s.anisotropy; f.far = s.maxDistance; f.tile = this.tile; f.ambient = s.ambient;
  }

  /** (Re)allocate the volume for a render-target size. */
  resize(width: number, height: number): void {
    if (this.volume && width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    this.dims = [Math.max(1, Math.ceil(width / this.tile)), Math.max(1, Math.ceil(height / this.tile)), this.slices];
    if (this.volume) this.gpu.resources.textures.destroy(this.volume);
    this.volume = this.gpu.resources.textures.create({
      label: 'fog-volume', size: this.dims, dimension: '3d', format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this.paramsBG = this.gpu.device.createBindGroup({
      label: 'volume-params', layout: this.volLayout,
      entries: [{ binding: 0, resource: { buffer: this.paramsBuf } }, { binding: 1, resource: this.volume.createView({ dimension: '3d' }) }],
    });
    this.scene.setFogVolume(this.volume.createView({ dimension: '3d' }));
  }

  /** Append the volume fill. `camWorld` is the camera world matrix (inverse view). `frameBG` is the renderer's frame bind group. */
  encode(enc: GPUCommandEncoder, frameBG: GPUBindGroup, camWorld: ArrayLike<number>, proj00: number, proj11: number, near: number, timestampWrites?: GPUComputePassTimestampWrites): void {
    if (!this.enabled || !this.volume) return;
    const f = this.pf, u = this.pu;
    for (let i = 0; i < 16; i++) f[i] = camWorld[i];
    u[16] = this.dims[0]; u[17] = this.dims[1]; u[18] = this.dims[2]; u[19] = this.tile;
    f[20] = this.width; f[21] = this.height; f[22] = near; f[23] = this.settings.maxDistance;
    f[24] = proj00; f[25] = proj11;
    this.gpu.device.queue.writeBuffer(this.paramsBuf, 0, this.pdata);
    const pass = enc.beginComputePass({ label: 'volumetric-fog', timestampWrites });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, frameBG);
    pass.setBindGroup(1, this.scene.volumePassBindGroup);
    pass.setBindGroup(2, this.paramsBG!);
    pass.dispatchWorkgroups(Math.ceil(this.dims[0] / 8), Math.ceil(this.dims[1] / 8));
    pass.end();
  }
}
