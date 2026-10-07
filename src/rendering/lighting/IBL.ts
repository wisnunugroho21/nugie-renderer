import type { GPUContext } from '../../gpu/GPUContext';
import { mipLevelCount } from '../../gpu/TextureManager';
import { registerEngineShaderChunks } from '../../shaders';
import { parseRGBE, rgbToRGBA16F } from '../../assets/RGBE';
import skySrc from '../../shaders/ibl_sky.wgsl?raw';
import equirectSrc from '../../shaders/ibl_equirect.wgsl?raw';
import mipsSrc from '../../shaders/ibl_mips.wgsl?raw';
import irradianceSrc from '../../shaders/ibl_irradiance.wgsl?raw';
import specularSrc from '../../shaders/ibl_specular.wgsl?raw';
import brdfSrc from '../../shaders/ibl_brdf.wgsl?raw';

export interface SkyParams {
  zenith: [number, number, number];
  horizon: [number, number, number];
  ground: [number, number, number];
  /** Direction TOWARD the sun. */
  sunDirection: [number, number, number];
  /** HDR radiance of the sun disc. */
  sunColor: [number, number, number];
  /** Angular radius in radians. */
  sunAngularRadius: number;
}

export const DEFAULT_SKY: SkyParams = {
  zenith: [0.15, 0.35, 0.8], horizon: [0.75, 0.82, 0.9], ground: [0.12, 0.11, 0.1],
  sunDirection: [0.4, 0.55, 0.3], sunColor: [60, 52, 40], sunAngularRadius: 0.05,
};

/** Baked image-based-lighting data: the environment (with mips), diffuse irradiance and GGX-prefiltered specular cubes. */
export class Environment {
  readonly sourceView: GPUTextureView;
  readonly irradianceView: GPUTextureView;
  readonly specularView: GPUTextureView;
  /** Wraps the source environment cube, its diffuse irradiance cube and its GGX-prefiltered specular cube (with `specularMipCount` roughness levels). */
  constructor(
    readonly source: GPUTexture, readonly irradiance: GPUTexture, readonly specular: GPUTexture,
    readonly specularMipCount: number,
  ) {
    this.sourceView = source.createView({ dimension: 'cube' });
    this.irradianceView = irradiance.createView({ dimension: 'cube' });
    this.specularView = specular.createView({ dimension: 'cube' });
  }
}

const SRC_USAGE = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC;

/** Generates environments and the BRDF LUT with compute passes (all work is GPU-side; nothing is read back). */
export class IBLBaker {
  static readonly SPECULAR_SIZE = 128;
  static readonly IRRADIANCE_SIZE = 32;
  private pipelines = new Map<string, GPUComputePipeline>();
  private sampler: GPUSampler;
  private lut: GPUTexture | null = null;

  /** Create the baker and its shared linear sampler. */
  constructor(private gpu: GPUContext) {
    registerEngineShaderChunks(gpu.resources.shaders);
    this.sampler = gpu.resources.samplers.get({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  }

  /** Lazily create and cache the compute pipeline `id` built from WGSL `src`. */
  private pipeline(id: string, src: string): GPUComputePipeline {
    let p = this.pipelines.get(id);
    if (!p) {
      p = this.gpu.device.createComputePipeline({ label: id, layout: 'auto', compute: { module: this.gpu.resources.shaders.get(id, src), entryPoint: 'main' } });
      this.pipelines.set(id, p);
    }
    return p;
  }

  /** Run one compute pass over a `w` x `h` x `layers` grid (8x8 workgroups) with the given bind-group entries. */
  private dispatch(enc: GPUCommandEncoder, p: GPUComputePipeline, entries: GPUBindGroupEntry[], w: number, h: number, layers: number): void {
    const pass = enc.beginComputePass();
    pass.setPipeline(p);
    pass.setBindGroup(0, this.gpu.device.createBindGroup({ layout: p.getBindGroupLayout(0), entries }));
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8), layers);
    pass.end();
  }

  /** Create an rgba16float cube texture usable as storage, sampled and copy source / destination. */
  private cube(label: string, size: number, mips: number): GPUTexture {
    return this.gpu.resources.textures.create({ label, size: [size, size, 6], format: 'rgba16float', mipLevelCount: mips, usage: SRC_USAGE });
  }

  /** A 2D-array view of one mip of `t` for storage writes. */
  private storageView(t: GPUTexture, mip: number): GPUTextureView {
    return t.createView({ dimension: '2d-array', baseMipLevel: mip, mipLevelCount: 1 });
  }

  /** Split-sum BRDF LUT (created once). x = NoV, y = roughness, rg = (scale, bias). */
  brdfLut(): GPUTexture {
    if (this.lut) return this.lut;
    const { device, resources: r } = this.gpu;
    const size = 128;
    const tex = r.textures.create({ label: 'ibl-brdf-lut', size: [size, size], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    const enc = device.createCommandEncoder({ label: 'ibl-brdf' });
    this.dispatch(enc, this.pipeline('ibl-brdf', brdfSrc), [{ binding: 0, resource: tex.createView() }], size, size, 1);
    device.queue.submit([enc.finish()]);
    return (this.lut = tex);
  }

  /** Procedural sky -> baked environment. `size` is the source cube resolution (power of two >= 64). */
  fromSky(sky: SkyParams = DEFAULT_SKY, size = 256): Environment {
    const { device, resources: r } = this.gpu;
    const source = this.cube('env-source', size, mipLevelCount(size, size));
    const u = new Float32Array(20);
    u.set([...sky.zenith, 0, ...sky.horizon, 0, ...sky.ground, 0]);
    const sl = Math.hypot(...sky.sunDirection) || 1;
    u.set([sky.sunDirection[0] / sl, sky.sunDirection[1] / sl, sky.sunDirection[2] / sl, Math.cos(sky.sunAngularRadius), ...sky.sunColor, 0], 12);
    const ub = r.buffers.create('ibl-sky-params', u.byteLength, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(ub, 0, u);
    const enc = device.createCommandEncoder({ label: 'ibl-sky' });
    this.dispatch(enc, this.pipeline('ibl-sky', skySrc), [{ binding: 0, resource: { buffer: ub } }, { binding: 1, resource: this.storageView(source, 0) }], size, size, 6);
    return this.bake(enc, source, size);
  }

  /** Equirectangular HDR image (RGB float32, top row first) -> baked environment. */
  fromEquirect(width: number, height: number, rgb: Float32Array, size = 256): Environment {
    const { device, resources: r } = this.gpu;
    const eq = r.textures.create({ label: 'env-equirect', size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: eq }, rgbToRGBA16F(rgb) as Uint16Array<ArrayBuffer>, { bytesPerRow: width * 8 }, [width, height]);
    const source = this.cube('env-source', size, mipLevelCount(size, size));
    const enc = device.createCommandEncoder({ label: 'ibl-equirect' });
    this.dispatch(enc, this.pipeline('ibl-equirect', equirectSrc), [
      { binding: 0, resource: eq.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: this.storageView(source, 0) },
    ], size, size, 6);
    return this.bake(enc, source, size);
  }

  /** Radiance .hdr file contents -> baked environment. */
  fromHDR(buffer: ArrayBuffer, size = 256): Environment {
    const img = parseRGBE(buffer);
    return this.fromEquirect(img.width, img.height, img.data, size);
  }

  /** Mip chain + irradiance + prefiltered specular, appended to `enc` (which already wrote source mip 0). */
  private bake(enc: GPUCommandEncoder, source: GPUTexture, size: number): Environment {
    const { device, resources: r } = this.gpu;
    const mips = source.mipLevelCount;
    const mipPipe = this.pipeline('ibl-mips', mipsSrc);
    for (let m = 1; m < mips; m++) {
      const s = Math.max(1, size >> m);
      this.dispatch(enc, mipPipe, [
        { binding: 0, resource: source.createView({ dimension: '2d-array', baseMipLevel: m - 1, mipLevelCount: 1 }) },
        { binding: 1, resource: this.storageView(source, m) },
      ], s, s, 6);
    }
    const srcCube = source.createView({ dimension: 'cube' });
    const irr = this.cube('env-irradiance', IBLBaker.IRRADIANCE_SIZE, 1);
    this.dispatch(enc, this.pipeline('ibl-irradiance', irradianceSrc), [
      { binding: 0, resource: srcCube }, { binding: 1, resource: this.sampler }, { binding: 2, resource: this.storageView(irr, 0) },
    ], IBLBaker.IRRADIANCE_SIZE, IBLBaker.IRRADIANCE_SIZE, 6);
    const sSize = IBLBaker.SPECULAR_SIZE, sMips = 6;
    const spec = this.cube('env-specular', sSize, sMips);
    const specPipe = this.pipeline('ibl-specular', specularSrc);
    for (let m = 0; m < sMips; m++) {
      const pb = r.buffers.create(`ibl-spec-params-${m}`, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      device.queue.writeBuffer(pb, 0, new Float32Array([m / (sMips - 1), size, 0, 0]));
      const s = Math.max(1, sSize >> m);
      this.dispatch(enc, specPipe, [
        { binding: 0, resource: srcCube }, { binding: 1, resource: this.sampler }, { binding: 2, resource: this.storageView(spec, m) }, { binding: 3, resource: { buffer: pb } },
      ], s, s, 6);
    }
    device.queue.submit([enc.finish()]);
    return new Environment(source, irr, spec, sMips);
  }
}
