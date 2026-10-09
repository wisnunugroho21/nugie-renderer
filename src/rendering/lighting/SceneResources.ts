import type { GPUContext } from '../../gpu/GPUContext';
import type { BindLayouts } from '../../gpu/BindLayouts';
import { LIGHT_BYTES, type LightData } from './LightData';
import type { Environment } from './IBL';
import { LTC_SIZE, LTC_TABLE } from './ltcTable';
import { floatToHalf } from '../../assets/RGBE';

/** Scene uniform size (11 x vec4), mirrors `struct Scene` in common_types.wgsl. */
export const SCENE_UNIFORM_BYTES = 176;

export interface SceneUniformParams {
  lightCount: number;
  /** Lights [0, globalCount) are evaluated for every pixel; defaults to all of them. */
  globalCount?: number;
  clusterTileSize?: number;
  clusterDims?: [number, number, number];
  clustered?: boolean;
  clusterNear?: number;
  clusterFar?: number;
  envIntensity?: number;
  envRotation?: number;
  envMipCount?: number;
  envEnabled?: boolean;
  shadowCascades?: number;
  shadowPcfRadius?: number;
  shadowNormalBias?: number;
  shadowEnabled?: boolean;
  shadowMapSize?: number;
  shadowDepthBias?: number;
  cascadeSplits?: number[];
  ambientSky: ArrayLike<number>;
  ambientGround: ArrayLike<number>;
}

/**
 * Owns the GPU resources behind bind group 1 (Scene): the scene uniform, the shared LightBuffer, cluster buffers, shadow
 * maps, environment maps and LTC tables. Everything is created once with safe 1x1 / empty defaults; later phases swap in
 * real resources through the setters (which rebuild the bind group). One bind group serves every pipeline.
 */
export class SceneResources {
  readonly uniform: GPUBuffer;
  lightBuffer: GPUBuffer;
  clusterGrid: GPUBuffer;
  clusterIndices: GPUBuffer;
  shadowMatrices: GPUBuffer;
  shadowMap: GPUTextureView;
  shadowSampler: GPUSampler;
  envIrradiance: GPUTextureView;
  envSpecular: GPUTextureView;
  brdfLut: GPUTextureView;
  envSampler: GPUSampler;
  ltcMatrix: GPUTextureView;
  /** Copy of the opaque scene (HDR, mip chain) that transmissive materials refract; a 1x1 default until the renderer supplies one. */
  transmission!: GPUTextureView;
  /** Volumetric fog volume (rgb in-scatter, a transmittance); a 1x1x1 'no fog' volume until the fog system supplies one. */
  fogVolume: GPUTextureView;
  /** Fog state mirrored into the uniform. */
  fog = { enabled: false, density: 0, heightFalloff: 0, anisotropy: 0, far: 100, tile: 8, ambient: [0, 0, 0] as [number, number, number] };
  /** Bumped when the bind group had to be rebuilt (diagnostics). */
  generation = 0;
  uploadBytes = 0;
  /** Image-based lighting state mirrored into the scene uniform. */
  env = { enabled: false, intensity: 1, rotation: 0, mipCount: 1 };

  private bg: GPUBindGroup | null = null;
  private shadowBg: GPUBindGroup | null = null;
  private volumeBg: GPUBindGroup | null = null;
  private dummyFogView!: GPUTextureView;
  private dummyShadowView: GPUTextureView;
  private defaultTransmission!: GPUTextureView;
  private lightCapacity = 256;
  private lightsVersion = -1;
  private uniformData = new ArrayBuffer(SCENE_UNIFORM_BYTES);
  private f32 = new Float32Array(this.uniformData);
  private u32 = new Uint32Array(this.uniformData);

  /** Create the scene bind group's buffers, 1x1 default textures (so every binding is always valid) and the LTC lookup table. */
  constructor(private gpu: GPUContext, private layouts: BindLayouts) {
    const { resources: r } = gpu;
    const S = GPUBufferUsage.STORAGE, D = GPUBufferUsage.COPY_DST;
    this.uniform = r.buffers.create('SceneUniformBuffer', SCENE_UNIFORM_BYTES, GPUBufferUsage.UNIFORM | D);
    this.lightBuffer = r.buffers.create('LightBuffer', this.lightCapacity * LIGHT_BYTES, S | D);
    this.clusterGrid = r.buffers.create('ClusterGridBuffer', 16, S | D);
    this.clusterIndices = r.buffers.create('ClusterLightIndexBuffer', 16, S | D);
    this.shadowMatrices = r.buffers.create('ShadowMatrixBuffer', 64, S | D);
    // Fresh textures are zero-initialised: 1x1 defaults need no upload.
    const shadow = r.textures.create({ label: 'shadow-default', size: [1, 1, 1], format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING });
    this.shadowMap = shadow.createView({ dimension: '2d-array' });
    this.dummyShadowView = this.shadowMap;
    this.shadowSampler = r.samplers.get({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
    /** A 1x1 black cube-map view used until a real environment is set. */
    const cube = () => r.textures.create({ label: 'env-default', size: [1, 1, 6], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING }).createView({ dimension: 'cube' });
    this.envIrradiance = cube(); this.envSpecular = cube();
    /** A 1x1 default 2D texture view. */
    const tex2 = (label: string) => r.textures.create({ label, size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING }).createView();
    this.brdfLut = tex2('brdf-default'); this.transmission = tex2('transmission-default'); this.defaultTransmission = this.transmission;
    // LTC inverse-matrix table (offline fit, tools/fitLTC.ts): rgb = (ia, ib, ic)
    const ltc = r.textures.create({ label: 'ltc-matrix', size: [LTC_SIZE, LTC_SIZE], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const half = new Uint16Array(LTC_SIZE * LTC_SIZE * 4), one = floatToHalf(1);
    for (let i = 0; i < LTC_SIZE * LTC_SIZE; i++) { half[i * 4] = floatToHalf(LTC_TABLE[i * 3]); half[i * 4 + 1] = floatToHalf(LTC_TABLE[i * 3 + 1]); half[i * 4 + 2] = floatToHalf(LTC_TABLE[i * 3 + 2]); half[i * 4 + 3] = one; }
    gpu.device.queue.writeTexture({ texture: ltc }, half, { bytesPerRow: LTC_SIZE * 8 }, [LTC_SIZE, LTC_SIZE]);
    this.ltcMatrix = ltc.createView();
    const none = r.textures.create({ label: 'fog-none', size: [1, 1, 1], dimension: '3d', format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    gpu.device.queue.writeTexture({ texture: none }, new Uint16Array([0, 0, 0, floatToHalf(1)]), { bytesPerRow: 8 }, [1, 1, 1]);
    this.fogVolume = none.createView({ dimension: '3d' });
    this.dummyFogView = this.fogVolume;
    this.envSampler = r.samplers.get({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  }

  /** Swap in the cluster grid / index buffers (called by ClusterGrid on resize). */
  setClusterBuffers(grid: GPUBuffer, indices: GPUBuffer): void { this.clusterGrid = grid; this.clusterIndices = indices; this.invalidate(); }

  /** Invalidate the bind group (call after replacing any resource). */
  invalidate(): void { this.bg = null; this.shadowBg = null; this.volumeBg = null; }

  /** The scene bind group (group 1), created lazily and rebuilt after any resource changed. */
  get bindGroup(): GPUBindGroup {
    if (this.bg) return this.bg;
    this.generation++;
    return (this.bg = this.makeBindGroup(`scene-bg:${this.generation}`, this.shadowMap));
  }

  /**
   * Same layout and resources, but with a 1x1 dummy in the shadow-map slot. Used while RENDERING the shadow map itself
   * (a texture may not be an attachment and a sampled binding in the same pass).
   */
  get shadowPassBindGroup(): GPUBindGroup {
    if (this.shadowBg) return this.shadowBg;
    return (this.shadowBg = this.makeBindGroup(`scene-shadowpass-bg:${this.generation}`, this.dummyShadowView));
  }

  /** Real shadow map but a dummy fog volume: for the pass that WRITES the fog volume. */
  get volumePassBindGroup(): GPUBindGroup {
    return (this.volumeBg ??= this.makeBindGroup(`scene-volumepass-bg:${this.generation}`, this.shadowMap, this.dummyFogView));
  }

  /** Create the scene bind group from the current resources (`shadowView` / `fogView` are overridable for off-screen passes). */
  private makeBindGroup(label: string, shadowView: GPUTextureView, fogView: GPUTextureView = this.fogVolume): GPUBindGroup {
    return this.gpu.device.createBindGroup({
      label, layout: this.layouts.scene,
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: this.lightBuffer } },
        { binding: 2, resource: { buffer: this.clusterGrid } },
        { binding: 3, resource: { buffer: this.clusterIndices } },
        { binding: 4, resource: { buffer: this.shadowMatrices } },
        { binding: 5, resource: shadowView },
        { binding: 6, resource: this.shadowSampler },
        { binding: 7, resource: this.envIrradiance },
        { binding: 8, resource: this.envSpecular },
        { binding: 9, resource: this.brdfLut },
        { binding: 10, resource: this.envSampler },
        { binding: 11, resource: this.ltcMatrix },
        { binding: 12, resource: this.transmission },
        { binding: 13, resource: fogView },
      ],
    });
  }

  /** Supply (or clear with null) the opaque-scene copy sampled by transmissive materials. */
  setTransmission(view: GPUTextureView | null): void { this.transmission = view ?? this.defaultTransmission; this.invalidate(); }

  /** Bind the shadow map array and the light matrices buffer (called by the ShadowSystem). */
  setShadowResources(map: GPUTextureView, matrices: GPUBuffer): void { this.shadowMap = map; this.shadowMatrices = matrices; this.invalidate(); }


  /** Bind the split-sum BRDF LUT (used by IBL and by area-light specular). */
  /** Bind the fog volume produced by VolumetricFog (null restores the 'no fog' default). */
  setFogVolume(view: GPUTextureView | null): void {
    if (view) this.fogVolume = view; else this.fog.enabled = false;
    this.invalidate();
  }

  /** Use `lut` as the split-sum BRDF lookup table and rebuild the bind group. */
  setBrdfLut(lut: GPUTexture): void { this.brdfLut = lut.createView(); this.invalidate(); }

  /** Bind a baked environment (null restores the 1x1 defaults) and the shared BRDF LUT. */
  setEnvironment(env: Environment | null, brdfLut?: GPUTexture, intensity = 1, rotation = 0): void {
    if (env) {
      this.envIrradiance = env.irradianceView; this.envSpecular = env.specularView;
      if (brdfLut) this.brdfLut = brdfLut.createView();
      this.env = { enabled: true, intensity, rotation, mipCount: env.specularMipCount };
    } else {
      const { r } = { r: this.gpu.resources };
      /** A 1x1 black cube-map view used until a real environment is set. */
      const cube = () => r.textures.create({ label: 'env-default', size: [1, 1, 6], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING }).createView({ dimension: 'cube' });
      this.envIrradiance = cube(); this.envSpecular = cube();
      this.env = { enabled: false, intensity: 1, rotation: 0, mipCount: 1 };
    }
    this.invalidate();
  }

  /** Upload the light list if it changed (grows the buffer on demand). */
  syncLights(lights: LightData): void {
    this.uploadBytes = 0;
    if (lights.version === this.lightsVersion) return;
    this.lightsVersion = lights.version;
    if (lights.count > this.lightCapacity) {
      while (this.lightCapacity < lights.count) this.lightCapacity *= 2;
      this.gpu.resources.buffers.destroy(this.lightBuffer);
      this.lightBuffer = this.gpu.resources.buffers.create('LightBuffer', this.lightCapacity * LIGHT_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      this.invalidate();
    }
    if (lights.count > 0) {
      this.gpu.device.queue.writeBuffer(this.lightBuffer, 0, lights.data.buffer, lights.data.byteOffset, lights.count * LIGHT_BYTES);
      this.uploadBytes = lights.count * LIGHT_BYTES;
    }
  }

  /**
   * Write the scene uniform for an off-screen view: the last frame's uniform with clustered shading and the fog volume switched off
   * (both belong to the main camera). Undo with {@link restoreUniform}.
   */
  writeViewUniform(): void {
    const copy = new ArrayBuffer(SCENE_UNIFORM_BYTES);
    new Uint8Array(copy).set(new Uint8Array(this.uniformData));
    new Uint32Array(copy)[7] = 0;
    new Float32Array(copy)[43] = 0;
    this.gpu.device.queue.writeBuffer(this.uniform, 0, copy);
  }

  /** Re-write the uniform of the last {@link writeUniform} (after off-screen views changed it). */
  restoreUniform(): void { this.gpu.device.queue.writeBuffer(this.uniform, 0, this.uniformData); }

  /** Write the scene uniform (every frame; 144 bytes). */
  writeUniform(p: SceneUniformParams): void {
    const f = this.f32, u = this.u32;
    f.fill(0);
    u[0] = p.lightCount; u[1] = p.globalCount ?? p.lightCount;
    const d = p.clusterDims ?? [1, 1, 1];
    u[4] = d[0]; u[5] = d[1]; u[6] = d[2]; u[7] = p.clustered ? 1 : 0;
    const near = p.clusterNear ?? 0.1, far = p.clusterFar ?? 100;
    f[8] = near; f[9] = far; f[10] = d[2] / Math.log(far / near); f[11] = p.clusterTileSize ?? 64;
    const e = this.env;
    f[12] = p.envIntensity ?? e.intensity; f[13] = p.envRotation ?? e.rotation; f[14] = p.envMipCount ?? e.mipCount; f[15] = (p.envEnabled ?? e.enabled) ? 1 : 0;
    f[16] = p.shadowCascades ?? 0; f[17] = p.shadowPcfRadius ?? 1; f[18] = p.shadowNormalBias ?? 0.02; f[19] = p.shadowEnabled ? 1 : 0;
    const s = p.cascadeSplits ?? [];
    for (let i = 0; i < 4; i++) f[20 + i] = s[i] ?? 0;
    f[24] = p.ambientSky[0]; f[25] = p.ambientSky[1]; f[26] = p.ambientSky[2];
    f[28] = p.ambientGround[0]; f[29] = p.ambientGround[1]; f[30] = p.ambientGround[2];
    f[32] = p.shadowMapSize ?? 1; f[33] = p.shadowDepthBias ?? 0.0005; f[34] = this.fog.tile;
    const fg = this.fog;
    f[36] = fg.density; f[37] = fg.heightFalloff; f[38] = fg.anisotropy; f[39] = fg.far;
    f[40] = fg.ambient[0]; f[41] = fg.ambient[1]; f[42] = fg.ambient[2]; f[43] = fg.enabled ? 1 : 0;
    this.gpu.device.queue.writeBuffer(this.uniform, 0, this.uniformData);
  }
}
