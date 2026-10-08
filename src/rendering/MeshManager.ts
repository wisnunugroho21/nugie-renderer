import type { BufferManager } from '../gpu/BufferManager';
import { Arena } from '../gpu/Arena';
import type { MeshData } from './primitives';
import type { MorphTargetData } from '../assets/AssetTypes';
import { STANDARD_VERTEX_FLOATS, STANDARD_VERTEX_STRIDE } from './VertexLayouts';

/** Deformation capability bits of a mesh (selects the vertex-shader variant). */
export const DeformMask = { None: 0, Skin: 1, Morph: 2 } as const;

export interface MeshDeformData {
  /** 4 joint indices / 4 weights per vertex (JOINTS_0 / WEIGHTS_0). */
  joints0?: Uint16Array;
  weights0?: Float32Array;
  /** Morph targets as per-vertex DELTAS (never duplicated meshes). */
  morphTargets?: MorphTargetData[];
}

export interface MeshRecord {
  id: number;
  name: string;
  vertexCount: number;
  indexCount: number;
  /** Offsets into the shared buffers (in vertices / indices, as drawIndexed expects). */
  baseVertex: number;
  firstIndex: number;
  /** Local-space (bind pose) AABB: minXYZ, maxXYZ. */
  bounds: Float32Array;
  deformMask: number;
  /** Element offset (16 B elements) of this mesh's skin data in the shared deform arena: 1 element per vertex. */
  skinBase: number;
  /** Element offset of this mesh's morph deltas in the deform arena: 3 elements (position, normal, tangent delta) per vertex per target, target-major. */
  morphBase: number;
  morphTargetCount: number;
  /** Largest possible vertex displacement from morphing (sum over targets of max |delta|); 0 if none. */
  morphMaxDisplacement: number;
}

/** Pack JOINTS/WEIGHTS into 16 bytes per vertex: joints as u16x4, weights as unorm16x4 summing exactly to 65535. */
export function packSkinData(joints: Uint16Array, weights: Float32Array): Uint32Array {
  const n = joints.length / 4;
  const out = new Uint32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const q = [0, 0, 0, 0];
    let sum = 0, maxI = 0;
    for (let k = 0; k < 4; k++) {
      q[k] = Math.max(0, Math.min(65535, Math.round(weights[v * 4 + k] * 65535)));
      sum += q[k];
      if (q[k] > q[maxI]) maxI = k;
    }
    q[maxI] += 65535 - sum; // make the quantized weights sum to exactly 1.0
    out[v * 4] = (joints[v * 4] | (joints[v * 4 + 1] << 16)) >>> 0;
    out[v * 4 + 1] = (joints[v * 4 + 2] | (joints[v * 4 + 3] << 16)) >>> 0;
    out[v * 4 + 2] = (q[0] | (q[1] << 16)) >>> 0;
    out[v * 4 + 3] = (q[2] | (q[3] << 16)) >>> 0;
  }
  return out;
}

/**
 * All meshes live in shared arenas: ONE vertex buffer, ONE index buffer (uint32) and ONE deform arena that holds skin weights and
 * morph deltas (position / normal / tangent interleaved per vertex per target). Meshes are uploaded once and never re-uploaded.
 */
export class MeshManager {
  private vertices: Arena;
  private indices: Arena;
  /** Skin data and morph deltas of every mesh (16-byte elements; see common_bind_object.wgsl `deformData`). */
  readonly deform: Arena;
  uploadedBytes = 0;

  private meshes: MeshRecord[] = [];

  /** Create the shared vertex / index arenas and the deform arena. */
  constructor(device: GPUDevice, buffers: BufferManager, initialVertices = 1 << 16, initialIndices = 1 << 18) {
    const storage = GPUBufferUsage.STORAGE;
    this.vertices = new Arena(device, buffers, 'mesh-vertices', GPUBufferUsage.VERTEX | storage, STANDARD_VERTEX_STRIDE, initialVertices);
    this.indices = new Arena(device, buffers, 'mesh-indices', GPUBufferUsage.INDEX | storage, 4, initialIndices);
    this.deform = new Arena(device, buffers, 'DeformDataBuffer', storage, 16, 2048);
  }

  /** The shared vertex buffer (all meshes live in it). */
  get vertexBuffer(): GPUBuffer { return this.vertices.buffer; }
  /** The shared index buffer. */
  get indexBuffer(): GPUBuffer { return this.indices.buffer; }
  /** Sum of all arena generations: changes whenever ANY shared buffer is reallocated. */
  get generation(): number {
    return this.vertices.generation + this.indices.generation + this.deform.generation;
  }
  /** Number of meshes created. */
  get count(): number { return this.meshes.length; }
  /** Dense record array indexed by mesh id (hot-path friendly). */
  get records(): MeshRecord[] { return this.meshes; }
  /** The record (ranges, bounds, deformation info) of mesh `id`. */
  get(id: number): MeshRecord { return this.meshes[id]; }

  /** Upload a mesh into the shared buffers and return its id. `deform` adds skin weights and / or morph target deltas. Throws if sizes do not match. */
  create(name: string, data: MeshData, deform?: MeshDeformData): number {
    const vcount = data.vertices.length / STANDARD_VERTEX_FLOATS;
    if (!Number.isInteger(vcount)) throw new Error(`Mesh '${name}': vertex data is not a multiple of the standard vertex size`);

    const baseVertex = this.vertices.alloc(vcount);
    const firstIndex = this.indices.alloc(data.indices.length);
    this.vertices.write(baseVertex, data.vertices);
    this.indices.write(firstIndex, data.indices);
    this.uploadedBytes += data.vertices.byteLength + data.indices.byteLength;

    let deformMask = DeformMask.None, skinBase = 0, morphBase = 0, targets = 0, maxDisp = 0;
    if (deform?.joints0 && deform.weights0) {
      if (deform.joints0.length !== vcount * 4 || deform.weights0.length !== vcount * 4) throw new Error(`Mesh '${name}': skin data does not match vertex count`);
      const packed = packSkinData(deform.joints0, deform.weights0);
      skinBase = this.deform.alloc(vcount);
      this.deform.write(skinBase, packed);
      this.uploadedBytes += packed.byteLength;
      deformMask |= DeformMask.Skin;
    }
    if (deform?.morphTargets?.length) {
      targets = deform.morphTargets.length;
      morphBase = this.deform.alloc(targets * vcount * 3);
      deform.morphTargets.forEach((t, k) => {
        // interleaved per vertex: position delta, normal delta, tangent delta (missing attributes stay zero)
        const v4 = new Float32Array(vcount * 12);
        let disp = 0;
        [t.position, t.normal, t.tangent].forEach((src, slot) => {
          if (!src) return;
          for (let i = 0; i < vcount; i++) {
            const o = (i * 3 + slot) * 4;
            v4[o] = src[i * 3]; v4[o + 1] = src[i * 3 + 1]; v4[o + 2] = src[i * 3 + 2];
            if (slot === 0) disp = Math.max(disp, Math.hypot(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]));
          }
        });
        this.deform.write(morphBase + k * vcount * 3, v4);
        this.uploadedBytes += v4.byteLength;
        maxDisp += disp;
      });
      deformMask |= DeformMask.Morph;
    }

    const id = this.meshes.length;
    this.meshes.push({
      id, name, vertexCount: vcount, indexCount: data.indices.length, baseVertex, firstIndex, bounds: computeBounds(data.vertices),
      deformMask, skinBase, morphBase, morphTargetCount: targets, morphMaxDisplacement: maxDisp,
    });
    return id;
  }
}

/** Local AABB [minXYZ, maxXYZ] of interleaved standard-layout vertices. */
export function computeBounds(vertices: Float32Array): Float32Array {
  const b = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let i = 0; i < vertices.length; i += STANDARD_VERTEX_FLOATS) {
    for (let k = 0; k < 3; k++) {
      const v = vertices[i + k];
      if (v < b[k]) b[k] = v;
      if (v > b[k + 3]) b[k + 3] = v;
    }
  }
  return b;
}
