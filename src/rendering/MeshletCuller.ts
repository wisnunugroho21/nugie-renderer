import type { GPUContext } from '../gpu/GPUContext';
import type { MeshletSet } from '../geometry/MeshOptimizer';
import { Mat4 } from '../math/Mat4';
import meshletCullSrc from '../shaders/meshlet_cull.wgsl?raw';
import { technique } from './graph/TechniqueBuilder';
import { TechniqueInstance } from './graph/TechniqueInstance';
import type { FrameBuilder } from './graph/FrameGraph';
import type { VariableValue } from './graph/Flatten';
import type { Technique } from './graph/TechniqueTypes';

const MESHLET_WORDS = 12;   // sphere (4) + cone (4) + range (4)

/** Per-draw inputs of {@link MeshletCuller.encode} / {@link MeshletCuller.addToFrame}. */
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

/** The culling technique, shared by every culler (a frame includes it once per meshlet draw, each with its own buffers and variables). */
let sharedTechnique: Technique | null = null;

/**
 * The meshlet-cull technique: a clear node zeroes the indirect arguments, then a compute node (one thread per meshlet) tests each meshlet and appends the
 * triangles of the survivors to the compacted index buffer, counting them in `args[0]`; its thread 0 writes the static words of the draw.
 */
export function meshletCullTechnique(): Technique {
  if (sharedTechnique) return sharedTechnique;
  const g = technique('meshlet-cull');
  for (let i = 0; i < 6; i++) g.float4(`plane${i}`);
  for (let i = 0; i < 4; i++) g.float4(`model${i}`);
  g.float4('eye');
  for (const v of ['meshletCount', 'threads', 'baseVertex', 'firstInstance']) g.uint(v);
  const meshlets = g.importedBuffer('meshlets', 'Meshlet', MESHLET_WORDS * 4), src = g.importedBuffer('srcIndices', 'u32');
  const dst = g.importedBuffer('dstIndices', 'u32'), args = g.importedBuffer('args', 'atomic<u32>', 4);
  g.clear('clear-args', args);
  g.compute('meshlet-cull', {
    shader: meshletCullSrc, workgroupSize: [64], dispatch: { threads: [g.variableNamed('threads')] },
    reads: [meshlets, src], writes: [dst], readWrites: [args],
  });
  return (sharedTechnique = g.build());
}

/**
 * GPU culling of the meshlets of ONE mesh: frustum test on each meshlet's bounding sphere and a conservative back-face test on its
 * normal cone, then a compute pass compacts the triangles of the survivors into {@link indexBuffer}. {@link argsBuffer} holds a
 * `drawIndexedIndirect` command whose `indexCount` the shader fills, so the whole mesh is ONE indirect draw (WebGPU has no
 * multi-draw) that touches only the visible clusters.
 *
 * The pass is a technique (see TECHNIQUES.md): a clear node for the arguments, then a compute node over the meshlets. In a frame it joins the graph through
 * {@link addToFrame} (the renderer drives this per mesh through `MeshletDraws`, `renderer.meshlets.enable(meshId)`); outside one, {@link encode} records it:
 *
 * ```ts
 * culler.encode(enc, { model, planes: camera.frustum.planes, eye: camera.position, baseVertex: mesh.baseVertex });
 * // ... in a render pass, after the compute pass:
 * pass.setIndexBuffer(culler.indexBuffer, 'uint32');
 * pass.drawIndexedIndirect(culler.argsBuffer, 0);
 * ```
 *
 * Winding is not flipped for mirrored (negative-scale) models.
 */
export class MeshletCuller {
  private static nextId = 0;
  /** Unique id: names this culler's buffers in a frame (several cullers run in one frame). */
  readonly id = MeshletCuller.nextId++;
  /** Compacted triangle indices (mesh-local vertex ids, to be drawn with the mesh's `baseVertex`). */
  readonly indexBuffer: GPUBuffer;
  /** `drawIndexedIndirect` arguments: [indexCount (written by the shader), 1, 0, baseVertex, firstInstance]. */
  readonly argsBuffer: GPUBuffer;
  readonly meshletCount: number;
  /** Indices of the whole mesh (the capacity of {@link indexBuffer}). */
  readonly totalIndices: number;

  private readonly meshletBuffer: GPUBuffer;
  private readonly sourceBuffer: GPUBuffer;
  private readonly tech = meshletCullTechnique();
  /** The technique on its own, for {@link encode} (made on first use: frames run it as part of the frame's graph). */
  private standalone: TechniqueInstance | null = null;
  private readonly owned: GPUBuffer[] = [];

  /** Upload the meshlet table and the per-meshlet triangle indices of `set`. */
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
    this.meshletBuffer = r.buffers.create('MeshletTable', table.byteLength, S | D);
    this.sourceBuffer = r.buffers.create('MeshletIndices', indices.byteLength, S | D);
    this.indexBuffer = r.buffers.create('MeshletCulledIndices', indices.byteLength, S | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_SRC);
    this.argsBuffer = r.buffers.create('MeshletDrawArgs', 20, S | GPUBufferUsage.INDIRECT | D | GPUBufferUsage.COPY_SRC);
    this.owned.push(this.meshletBuffer, this.sourceBuffer, this.indexBuffer, this.argsBuffer);
    device.queue.writeBuffer(this.meshletBuffer, 0, table);
    device.queue.writeBuffer(this.sourceBuffer, 0, indices);
  }

  /** Frame names of this culler's compacted indices and indirect arguments (published for the pass that draws them). */
  get frameResources(): { indices: string; args: string } { return { indices: `meshletIndices#${this.id}`, args: `meshletArgs#${this.id}` }; }

  /**
   * Add the culling pass to the frame as the node `name` (its clear and compute nodes join the graph under that path). The culled indices and arguments are
   * published, so the main pass that draws them runs after it. `timestampWrites` is asked for when the frame records the pass.
   */
  addToFrame(g: FrameBuilder, name: string, o: MeshletCullParams, timestampWrites?: () => GPUComputePassTimestampWrites | undefined): void {
    const id = this.id, out = this.frameResources;
    g.include(name, this.tech, {
      imports: {
        meshlets: { as: `meshletTable#${id}`, resource: this.meshletBuffer }, srcIndices: { as: `meshletSource#${id}`, resource: this.sourceBuffer },
        dstIndices: { as: out.indices, resource: this.indexBuffer }, args: { as: out.args, resource: this.argsBuffer },
      },
      variables: this.values(o),
      publish: [out.indices, out.args],
    });
    if (timestampWrites) g.timestamps(name, timestampWrites);
  }

  /** Record the culling pass into `enc` outside a frame (before the render pass that draws {@link indexBuffer}). */
  encode(enc: GPUCommandEncoder, o: MeshletCullParams): void {
    const fx = this.standalone ??= TechniqueInstance.create(this.gpu, this.tech, {
      label: 'meshlet-cull', imports: { meshlets: this.meshletBuffer, srcIndices: this.sourceBuffer, dstIndices: this.indexBuffer, args: this.argsBuffer },
    });
    for (const [name, value] of Object.entries(this.values(o))) fx.setVariable(name, value);
    fx.execute(enc);
  }

  /** The technique's variables for one draw. */
  private values(o: MeshletCullParams): Record<string, VariableValue> {
    const m = o.model, pl = o.planes;
    const v: Record<string, VariableValue> = {
      // w: the largest axis scale multiplies the radius (keeps the sphere test conservative)
      eye: [o.eye[0], o.eye[1], o.eye[2], Mat4.maxScale(m as number[])],
      // thread 0 writes the draw's static words, so one thread runs even for a mesh without meshlets
      meshletCount: this.meshletCount, threads: Math.max(1, this.meshletCount),
      baseVertex: (o.baseVertex ?? 0) >>> 0, firstInstance: (o.firstInstance ?? 0) >>> 0,
    };
    for (let i = 0; i < 6; i++) v[`plane${i}`] = [pl[i * 4], pl[i * 4 + 1], pl[i * 4 + 2], pl[i * 4 + 3]];
    for (let i = 0; i < 4; i++) v[`model${i}`] = [m[i * 4], m[i * 4 + 1], m[i * 4 + 2], m[i * 4 + 3]];
    return v;
  }

  /** Release the GPU buffers and the standalone pass. */
  destroy(): void {
    this.standalone?.dispose(); this.standalone = null;
    for (const b of this.owned) this.gpu.resources.buffers.destroy(b);
    this.owned.length = 0;
  }
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
