import type { GPUContext } from '../gpu/GPUContext';
import type { MeshletSet } from '../geometry/MeshOptimizer';
import { Mat4 } from '../math/Mat4';
import meshletCullSrc from '../shaders/meshlet_cull.wgsl?raw';

/** Size of the uniform block in `meshlet_cull.wgsl`: model (16) + 6 planes (24) + eye (4) + counts (4) + scale (4) floats. */
const PARAM_FLOATS = 52;
const MESHLET_WORDS = 12;   // sphere (4) + cone (4) + range (4)

/** Per-draw inputs of {@link MeshletCuller.encode}. */
export interface MeshletCullParams {
  /** Object -> world, column-major (rotation, translation and a UNIFORM scale; non-uniform scale makes the cone test approximate). */
  model: ArrayLike<number>;
  /** World-space frustum planes, 6 x [nx, ny, nz, d] with inward normals (`Frustum.planes`). */
  planes: ArrayLike<number>;
  /** World-space camera position, for the back-face cone test. */
  eye: ArrayLike<number>;
  /** Added to every index by the draw (the mesh's base vertex in the shared vertex buffer). Default 0. */
  baseVertex?: number;
  /** First instance of the draw (its instance record). Non-zero needs the `indirect-first-instance` device feature. Default 0. */
  firstInstance?: number;
}

/**
 * GPU culling of the meshlets of ONE mesh: frustum test on each meshlet's bounding sphere and a conservative back-face test on its
 * normal cone, then a compute pass compacts the triangles of the survivors into {@link indexBuffer}. {@link argsBuffer} holds a
 * `drawIndexedIndirect` command whose `indexCount` the shader fills, so the whole mesh is ONE indirect draw (WebGPU has no
 * multi-draw) that touches only the visible clusters:
 *
 * ```ts
 * culler.encode(enc, { model, planes: camera.frustum.planes, eye: camera.position, baseVertex: mesh.baseVertex });
 * // ... in a render pass, after the compute pass:
 * pass.setIndexBuffer(culler.indexBuffer, 'uint32');
 * pass.drawIndexedIndirect(culler.argsBuffer, 0);
 * ```
 *
 * Call `encode` once per submit (it writes the uniform block and resets the counter through the queue). Winding is not flipped for
 * mirrored (negative-scale) models. The renderer drives these per mesh through `MeshletDraws` (`renderer.meshlets.enable(meshId)`).
 */
export class MeshletCuller {
  /** Compacted triangle indices (mesh-local vertex ids, to be drawn with the mesh's `baseVertex`). */
  readonly indexBuffer: GPUBuffer;
  /** `drawIndexedIndirect` arguments: [indexCount (written by the shader), 1, 0, baseVertex, firstInstance]. */
  readonly argsBuffer: GPUBuffer;
  readonly meshletCount: number;
  /** Indices of the whole mesh (the capacity of {@link indexBuffer}). */
  readonly totalIndices: number;

  private readonly pipeline: GPUComputePipeline;
  private readonly params: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly staging = new Float32Array(PARAM_FLOATS);
  private readonly stagingU32 = new Uint32Array(this.staging.buffer);
  private readonly argsInit = new Uint32Array(5);
  private readonly owned: GPUBuffer[] = [];

  /** Upload the meshlet table and the per-meshlet triangle indices of `set` and create the culling pipeline. */
  constructor(private gpu: GPUContext, set: MeshletSet) {
    const { device, resources: r } = gpu;
    this.meshletCount = set.count;
    let total = 0;
    for (let i = 0; i < set.count; i++) total += set.triangleCount[i] * 3;
    this.totalIndices = total;

    const table = new ArrayBuffer(Math.max(1, set.count) * MESHLET_WORDS * 4);
    const f = new Float32Array(table), u = new Uint32Array(table);
    const indices = new Uint32Array(Math.max(1, total));
    let cursor = 0;
    for (let i = 0; i < set.count; i++) {
      const o = i * MESHLET_WORDS;
      f.set(set.spheres.subarray(i * 4, i * 4 + 4), o);
      f.set(set.cones.subarray(i * 4, i * 4 + 4), o + 4);
      u[o + 8] = cursor; u[o + 9] = set.triangleCount[i] * 3;
      const vBase = set.vertexOffset[i], tBase = set.triangleOffset[i] * 3;
      for (let t = 0; t < set.triangleCount[i] * 3; t++) indices[cursor++] = set.vertices[vBase + set.triangles[tBase + t]];
    }

    const S = GPUBufferUsage.STORAGE, D = GPUBufferUsage.COPY_DST;
    const meshletBuffer = r.buffers.create('MeshletTable', table.byteLength, S | D);
    const sourceBuffer = r.buffers.create('MeshletIndices', indices.byteLength, S | D);
    this.indexBuffer = r.buffers.create('MeshletCulledIndices', indices.byteLength, S | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_SRC);
    this.argsBuffer = r.buffers.create('MeshletDrawArgs', 20, S | GPUBufferUsage.INDIRECT | D | GPUBufferUsage.COPY_SRC);
    this.params = r.buffers.create('MeshletCullParams', PARAM_FLOATS * 4, GPUBufferUsage.UNIFORM | D);
    this.owned.push(meshletBuffer, sourceBuffer, this.indexBuffer, this.argsBuffer, this.params);
    device.queue.writeBuffer(meshletBuffer, 0, table);
    device.queue.writeBuffer(sourceBuffer, 0, indices);

    this.pipeline = device.createComputePipeline({
      label: 'meshlet-cull', layout: 'auto', compute: { module: r.shaders.get('meshlet-cull', meshletCullSrc), entryPoint: 'main' },
    });
    this.bindGroup = device.createBindGroup({
      label: 'meshlet-cull', layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params } }, { binding: 1, resource: { buffer: meshletBuffer } },
        { binding: 2, resource: { buffer: sourceBuffer } }, { binding: 3, resource: { buffer: this.indexBuffer } },
        { binding: 4, resource: { buffer: this.argsBuffer } },
      ],
    });
  }

  /** Record the culling pass into `enc` (before the render pass that draws {@link indexBuffer}). */
  encode(enc: GPUCommandEncoder, o: MeshletCullParams): void {
    const f = this.staging, m = o.model;
    for (let i = 0; i < 16; i++) f[i] = m[i];
    for (let i = 0; i < 24; i++) f[16 + i] = o.planes[i];
    f[40] = o.eye[0]; f[41] = o.eye[1]; f[42] = o.eye[2]; f[43] = 1;
    this.stagingU32[44] = this.meshletCount;
    f[48] = Mat4.maxScale(m as number[]);   // radius multiplier (the largest axis scale keeps the sphere test conservative)
    const q = this.gpu.device.queue;
    q.writeBuffer(this.params, 0, f);
    this.argsInit[0] = 0; this.argsInit[1] = 1; this.argsInit[2] = 0; this.argsInit[3] = (o.baseVertex ?? 0) >>> 0; this.argsInit[4] = o.firstInstance ?? 0;
    q.writeBuffer(this.argsBuffer, 0, this.argsInit);
    if (this.meshletCount === 0) return;
    const pass = enc.beginComputePass({ label: 'meshlet-cull' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.meshletCount / 64));
    pass.end();
  }

  /** Release the GPU buffers. */
  destroy(): void { for (const b of this.owned) this.gpu.resources.buffers.destroy(b); this.owned.length = 0; }
}

/**
 * CPU reference of the shader's per-meshlet decision, for tests and for estimating what the GPU will keep. `margin` > 0 makes the test
 * more permissive (keeps borderline meshlets), < 0 stricter: the GPU's float32 result lies between `-eps` and `+eps`.
 */
export function meshletVisible(
  set: MeshletSet, i: number, model: ArrayLike<number>, planes: ArrayLike<number>, eye: ArrayLike<number>, margin = 0,
): boolean {
  const s = set.spheres, c = set.cones, o = i * 4, m = model;
  const x = s[o], y = s[o + 1], z = s[o + 2];
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cz = m[2] * x + m[6] * y + m[10] * z + m[14];
  const radius = s[o + 3] * Mat4.maxScale(m as number[]);
  for (let p = 0; p < 24; p += 4) if (planes[p] * cx + planes[p + 1] * cy + planes[p + 2] * cz + planes[p + 3] < -(radius + margin)) return false;
  const cutoff = c[o + 3];
  if (cutoff >= 1) return true;
  const dx = cx - eye[0], dy = cy - eye[1], dz = cz - eye[2], dist = Math.hypot(dx, dy, dz);
  if (dist <= radius) return true;
  const ax = m[0] * c[o] + m[4] * c[o + 1] + m[8] * c[o + 2], ay = m[1] * c[o] + m[5] * c[o + 1] + m[9] * c[o + 2], az = m[2] * c[o] + m[6] * c[o + 1] + m[10] * c[o + 2];
  const al = Math.hypot(ax, ay, az) || 1;
  return (dx * ax + dy * ay + dz * az) / (dist * al) <= cutoff + radius / dist + margin;
}
