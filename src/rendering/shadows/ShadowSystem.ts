import type { GPUContext } from '../../gpu/GPUContext';
import type { BindLayouts } from '../../gpu/BindLayouts';
import type { DynamicBufferAllocator } from '../../gpu/DynamicBufferAllocator';
import { Frustum } from '../../math/Frustum';
import { Mat4 } from '../../math/Mat4';
import { FrustumCuller } from '../../visibility/FrustumCuller';
import { BatchList, INSTANCE_BYTES, INSTANCE_WORDS, buildBatches } from '../BatchBuilder';
import { RenderQueueBuilder, RenderQueues } from '../RenderQueue';
import { RenderFlags } from '../../ecs/components/MeshRendererStore';
import type { MaterialManager } from '../materials/MaterialManager';
import type { MeshManager } from '../MeshManager';
import type { RenderWorld } from '../RenderWorld';
import type { Camera } from '../Camera';
import { LightData, LIGHT_FLOATS, GPU_LIGHT_TYPE, SHADOW_REQUEST } from '../lighting/LightData';
import type { SceneResources } from '../lighting/SceneResources';
import { cascadeSplits, fitCascade, fitPoint, fitSpot } from './ShadowMath';

export interface ShadowConfig {
  mapSize: number;
  cascades: number;
  maxSpotShadows: number;
  /** Point and area lights with shadows (each takes 6 layers). */
  maxPointShadows: number;
  /** Cascades cover [camera near, min(camera far, shadowDistance)]. */
  shadowDistance: number;
  cascadeLambda: number;
  /** Distance behind each cascade that casters are still captured from. */
  casterRange: number;
  /** PCF kernel step in texels. */
  pcfRadius: number;
  /** Normal offset in texels. */
  normalBias: number;
  /** Receiver depth bias (NDC). */
  depthBias: number;
}

export const DEFAULT_SHADOW_CONFIG: ShadowConfig = {
  mapSize: 1024, cascades: 4, maxSpotShadows: 8, maxPointShadows: 2, shadowDistance: 80, cascadeLambda: 0.8, casterRange: 150,
  pcfRadius: 1.2, normalBias: 1.5, depthBias: 0.0004,
};

const DEPTH_FORMAT: GPUTextureFormat = 'depth32float';
const FRAME_FLOATS = 60;

interface Layer { index: number; vp: Float32Array; batches: BatchList; count: number }

/**
 * Shadow maps: one depth32float 2d-array (cascades of the first shadow-casting directional light, then one layer per
 * shadow-casting spot light). `assign` runs after the light list is final, `prepare` builds per-layer instance batches (before
 * the instance buffer is flushed) and `encode` renders the depth passes.
 */
export class ShadowSystem {
  enabled = true;
  readonly layerCount: number;
  readonly texture: GPUTexture;
  readonly matricesBuffer: GPUBuffer;
  /** Layers rendered this frame. */
  layers: Layer[] = [];
  cascadeCount = 0;
  readonly splits = new Float32Array(4);
  /** Stats of the last frame. */
  stats = { layers: 0, draws: 0, casters: 0 };

  private views: GPUTextureView[] = [];
  private frameBuffers: GPUBuffer[] = [];
  private frameBGs: GPUBindGroup[] = [];
  private matrices: Float32Array;
  private culler = new FrustumCuller();
  private frustum = new Frustum();
  private queueBuilder = new RenderQueueBuilder();
  private queues = new RenderQueues();
  private casters = new Uint32Array(0);
  private signature = '';
  private frameData = new Float32Array(FRAME_FLOATS);

  /** Allocate one depth-array texture (`cascades + spots + 6 per point light` layers), a view / frame uniform per layer and publish the textures to the scene bind group. */
  constructor(
    private gpu: GPUContext, layouts: BindLayouts, private scene: SceneResources,
    private meshes: MeshManager, private materials: MaterialManager, readonly config: ShadowConfig = { ...DEFAULT_SHADOW_CONFIG },
  ) {
    const { device, resources: r } = gpu;
    this.layerCount = config.cascades + config.maxSpotShadows + config.maxPointShadows * 6;
    this.texture = r.textures.create({
      label: 'shadow-map', size: [config.mapSize, config.mapSize, this.layerCount], format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.matrices = new Float32Array(this.layerCount * 16);
    this.matricesBuffer = r.buffers.create('ShadowMatrixBuffer', this.matrices.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    for (let i = 0; i < this.layerCount; i++) {
      this.views.push(this.texture.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }));
      const fb = r.buffers.create(`ShadowFrame${i}`, FRAME_FLOATS * 4, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      this.frameBuffers.push(fb);
      this.frameBGs.push(device.createBindGroup({ label: `shadow-frame-${i}`, layout: layouts.frame, entries: [{ binding: 0, resource: { buffer: fb } }] }));
    }
    scene.setShadowResources(this.texture.createView({ dimension: '2d-array' }), this.matricesBuffer);
  }

  /**
   * Turn shadow REQUESTS in the (finalized) light list into layer assignments and compute the light matrices. Writes the
   * slot into each light's spot.z and the texel size info into its `up` vector; bumps `lights.version` if that changed.
   */
  assign(L: LightData, cam: Camera): void {
    this.layers.length = 0;
    this.cascadeCount = 0;
    const f = L.data, c = this.config;
    let sun = -1;
    const spots: number[] = [], points: number[] = [];
    for (let i = 0; i < L.count; i++) {
      const o = i * LIGHT_FLOATS;
      const v = f[o + 14];
      if (v !== SHADOW_REQUEST && v < 0) continue;   // an already assigned slot (>= 0) is still a request: the list may persist across frames
      f[o + 14] = this.enabled ? -1 : SHADOW_REQUEST;   // (while disabled the request is kept; the shader treats any slot < 0 as unshadowed)
      if (!this.enabled) continue;
      const type = f[o + 11];
      if (type === GPU_LIGHT_TYPE.directional && sun < 0) sun = i;
      else if (type === GPU_LIGHT_TYPE.spot) spots.push(i);
      else if (type === GPU_LIGHT_TYPE.point || type === GPU_LIGHT_TYPE.area) points.push(i);   // area lights shadow like a cube map from their centre
    }
    let sig = this.enabled ? 'on' : 'off';
    if (sun >= 0) {
      const o = sun * LIGHT_FLOATS, d = [f[o + 8], f[o + 9], f[o + 10]];
      const near = cam.near, far = Math.min(cam.far, c.shadowDistance);
      cascadeSplits(near, far, c.cascades, 0.0 + c.cascadeLambda, this.splits);
      const invView = Mat4.invert(Mat4.create(), cam.view);
      if (invView) {
        let prev = near;
        for (let k = 0; k < c.cascades; k++) {
          const res = fitCascade(invView, cam.fovY, cam.aspect, prev, this.splits[k], d, c.mapSize, c.casterRange);
          prev = this.splits[k];
          this.addLayer(k, res.viewProjection);
          f[o + 20 + k] = res.texelSize;
          sig += `|c${k}:${res.texelSize.toFixed(5)}`;
        }
        f[o + 14] = 0;
        this.cascadeCount = c.cascades;
      }
    }
    spots.slice(0, c.maxSpotShadows).forEach((li, k) => {
      const o = li * LIGHT_FLOATS, layer = c.cascades + k;
      const res = fitSpot([f[o], f[o + 1], f[o + 2]], [f[o + 8], f[o + 9], f[o + 10]], Math.acos(Math.min(Math.max(f[o + 12], -1), 1)), f[o + 3]);
      this.addLayer(layer, res.viewProjection);
      f[o + 14] = layer; f[o + 20] = res.tanHalfFov;
      sig += `|s${li}:${layer}:${res.tanHalfFov.toFixed(4)}`;
    });
    points.slice(0, c.maxPointShadows).forEach((li, k) => {
      const o = li * LIGHT_FLOATS, layer = c.cascades + c.maxSpotShadows + k * 6;
      const res = fitPoint([f[o], f[o + 1], f[o + 2]], f[o + 3]);
      res.faces.forEach((vp, face) => this.addLayer(layer + face, vp));
      f[o + 14] = layer;
      if (f[o + 11] === GPU_LIGHT_TYPE.area) f[o + 13] = res.tanHalfFov; else f[o + 20] = res.tanHalfFov;   // area lights use up / right as axes: tan goes to spot.y
      sig += `|p${li}:${layer}:${res.tanHalfFov.toFixed(4)}`;
    });
    if (sig !== this.signature) { this.signature = sig; L.version++; }
    if (this.layers.length) this.gpu.device.queue.writeBuffer(this.matricesBuffer, 0, this.matrices);
  }

  /** Register shadow layer `index` with its light view-projection matrix and an empty caster batch list. */
  private addLayer(index: number, vp: Float32Array): void {
    this.matrices.set(vp, index * 16);
    this.layers.push({ index, vp, batches: new BatchList(), count: 0 });
  }

  /** Cull casters per layer and write their instance records. Call BEFORE `instanceAlloc.flush()`. */
  prepare(rw: RenderWorld, instanceAlloc: DynamicBufferAllocator): void {
    this.stats.layers = this.layers.length; this.stats.casters = 0; this.stats.draws = 0;
    for (const layer of this.layers) {
      this.frustum.setFromViewProjection(layer.vp);
      this.culler.cull(rw, this.frustum, 'sphere');
      if (this.casters.length < this.culler.count) this.casters = new Uint32Array(Math.max(this.culler.count, 256));
      let n = 0;
      const vis = this.culler.visible, flags = rw.flags;
      for (let i = 0; i < this.culler.count; i++) {
        const slot = vis[i];
        if ((flags[slot] & RenderFlags.CastShadow) !== 0) this.casters[n++] = slot;
      }
      this.queueBuilder.build(rw, this.casters, n, this.materials.materials, this.meshes.records, { position: [0, 0, 0], far: 1 }, 'sorted', this.queues);
      const lists = [this.queues.opaque, this.queues.alphaMask];   // transparent surfaces do not cast shadows
      const total = lists[0].count + lists[1].count;
      layer.count = total;
      if (total === 0) { layer.batches.reset(); continue; }
      const byteOffset = instanceAlloc.allocate(total * INSTANCE_BYTES);
      const local = instanceAlloc.localOffset(byteOffset) / 4;
      buildBatches(lists, rw, this.meshes.records, instanceAlloc.uint32.subarray(local, local + total * INSTANCE_WORDS), byteOffset / INSTANCE_BYTES, 'instanced', layer.batches);
      this.stats.casters += total;
    }
  }

  /** Encode one depth pass per active layer. `objectBG` is the renderer's object bind group (valid after all allocations). */
  encode(enc: GPUCommandEncoder, objectBG: GPUBindGroup, frameTime: number, profiler?: { writes(name: string): GPURenderPassTimestampWrites | undefined }): void {
    const { queue } = this.gpu.device;
    for (const layer of this.layers) {
      const fd = this.frameData;
      fd.fill(0);
      fd.set(layer.vp, 0);
      fd[51] = frameTime; fd[52] = this.config.mapSize; fd[53] = this.config.mapSize;
      queue.writeBuffer(this.frameBuffers[layer.index], 0, fd);
      const pass = enc.beginRenderPass({
        label: `shadow-layer-${layer.index}`, colorAttachments: [], timestampWrites: profiler?.writes('shadows'),
        depthStencilAttachment: { view: this.views[layer.index], depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      if (layer.count > 0) {
        pass.setBindGroup(0, this.frameBGs[layer.index]);
        pass.setBindGroup(1, this.scene.shadowPassBindGroup);
        pass.setBindGroup(3, objectBG);
        pass.setVertexBuffer(0, this.meshes.vertexBuffer);
        pass.setIndexBuffer(this.meshes.indexBuffer, 'uint32');
        const b = layer.batches;
        let curPipe: GPURenderPipeline | null = null, curMat = -1;
        for (let i = 0; i < b.count; i++) {
          const mesh = this.meshes.get(b.meshId[i]);
          const pipe = this.materials.getShadowPipeline(b.materialId[i], mesh.deformMask, DEPTH_FORMAT);
          if (pipe !== curPipe) { pass.setPipeline(pipe); curPipe = pipe; }
          if (b.materialId[i] !== curMat) { pass.setBindGroup(2, this.materials.getBindGroup(b.materialId[i])); curMat = b.materialId[i]; }
          pass.drawIndexed(mesh.indexCount, b.instanceCount[i], mesh.firstIndex, mesh.baseVertex, b.firstInstance[i]);
          this.stats.draws++;
        }
      }
      pass.end();
    }
  }
}
