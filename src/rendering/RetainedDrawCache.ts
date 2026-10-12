import type { GPUContext } from '../gpu/GPUContext';
import { INSTANCE_WORDS } from './BatchBuilder';
import { RETAINED_INSTANCE_WORDS, RETAINED_INSTANCE_STRIDE } from './VertexLayouts';
import type { RenderWorld } from './RenderWorld';
import type { BatchList } from './BatchBuilder';
import type { Material } from './materials/Material';
import { supportsSpecializedDraw } from './materials/DrawVariant';
import type { MeshRecord } from './MeshManager';
import type { SwitchCounts } from './RenderQueue';

/** Fields of a mesh record that the prepared instance records bake in (offsets and deform layout). */
interface MeshLayout {
  baseVertex: number; vertexCount: number; firstIndex: number; indexCount: number;
  skinBase: number; morphBase: number; morphStride: number; morphTargetCount: number; deformMask: number;
}

/** What one prepared batch depended on when it was captured: the material's pipeline identity and the mesh layout. */
interface BatchDependency {
  material: Material; mesh: MeshRecord; layout: MeshLayout;
  pipelineSortId: number; queue: string; features: number; failed: boolean;
}

const meshLayoutOf = (m: MeshRecord): MeshLayout => ({
  baseVertex: m.baseVertex, vertexCount: m.vertexCount, firstIndex: m.firstIndex, indexCount: m.indexCount,
  skinBase: m.skinBase, morphBase: m.morphBase, morphStride: m.morphStride, morphTargetCount: m.morphTargetCount, deformMask: m.deformMask,
});

const sameMeshLayout = (m: MeshRecord, l: MeshLayout): boolean =>
  m.baseVertex === l.baseVertex && m.vertexCount === l.vertexCount && m.firstIndex === l.firstIndex && m.indexCount === l.indexCount
  && m.skinBase === l.skinBase && m.morphBase === l.morphBase && m.morphStride === l.morphStride
  && m.morphTargetCount === l.morphTargetCount && m.deformMask === l.deformMask;

/** The inputs that make a sorted, batched main view reusable: the extraction revisions plus the camera position and far plane (which drive sorting). */
interface ViewKey { drawVersion: number; transformVersion: number; count: number; x: number; y: number; z: number; far: number; }

const emptyKey = (): ViewKey => ({ drawVersion: -1, transformVersion: -1, count: -1, x: NaN, y: NaN, z: NaN, far: NaN });

const sameKey = (a: ViewKey, b: ViewKey): boolean =>
  a.drawVersion === b.drawVersion && a.transformVersion === b.transformVersion && a.count === b.count
  && a.x === b.x && a.y === b.y && a.z === b.z && a.far === b.far;

const keyOf = (rw: RenderWorld, into: ViewKey): ViewKey => {
  const p = rw.camera.position;
  into.drawVersion = rw.drawVersion; into.transformVersion = rw.transformVersion; into.count = rw.count;
  into.x = p[0]; into.y = p[1]; into.z = p[2]; into.far = rw.camera.far;
  return into;
};

/**
 * True when the upper-left 3x3 of the matrix at float offset `o` is an exact rotation times a uniform positive scale (equal-length,
 * mutually orthogonal columns, positive determinant). Normals can then use the model matrix directly; anything else (shear, non-uniform
 * or negative scale) needs the cofactor matrix. Comparisons are exact on purpose: "nearly uniform" falls back to the general path.
 */
export function hasUniformNormals(t: ArrayLike<number>, o: number): boolean {
  const a = t[o], b = t[o + 1], c = t[o + 2], d = t[o + 4], e = t[o + 5], f = t[o + 6], g = t[o + 8], h = t[o + 9], j = t[o + 10];
  const len = a * a + b * b + c * c;
  return len > 1e-12 && len < 1e12
    && len === d * d + e * e + f * f && len === g * g + h * h + j * j
    && a * d + b * e + c * f === 0 && a * g + b * h + c * j === 0 && d * g + e * h + f * j === 0
    && a * (e * j - f * h) + b * (f * g - d * j) + c * (d * h - e * g) > 0;
}

/** Cross-product term rounded to float32 at each step, matching the shader's `normalMatrix` arithmetic. */
const cross2 = (a: number, b: number, c: number, d: number): number => Math.fround(Math.fround(a * b) - Math.fround(c * d));

/**
 * Write one packed retained instance at float offset `o`: the model matrix (16 floats), its cofactor normal matrix (3 columns of 3 floats)
 * and the material index. The cofactor matrix preserves shear, non-uniform and negative scaling, unlike the model's own 3x3.
 */
function packInstance(out: Float32Array, outBits: Uint32Array, o: number, t: ArrayLike<number>, src: number, materialIndex: number): void {
  for (let i = 0; i < 16; i++) out[o + i] = t[src + i];
  for (let col = 0; col < 3; col++) {
    const a = src + ((col + 1) % 3) * 4, b = src + ((col + 2) % 3) * 4;
    out[o + 16 + col * 3] = cross2(t[a + 1], t[b + 2], t[a + 2], t[b + 1]);
    out[o + 17 + col * 3] = cross2(t[a + 2], t[b], t[a], t[b + 2]);
    out[o + 18 + col * 3] = cross2(t[a], t[b + 1], t[a + 1], t[b]);
  }
  outBits[o + 25] = materialIndex;
}

/** Reuses main-view draw preparation for an unchanged, versioned extraction. GPU ring slots are populated independently. */
export class RetainedDrawCache {
  // ---- stability detector: has the view been unchanged for two consecutive frames? ----
  private candidate: RenderWorld | null = null;
  private candidateKey = emptyKey();
  /** Scratch for the current frame's key, so `stable` / `matches` allocate nothing. */
  private readonly probe = emptyKey();

  /** Avoid retaining/copying preparation for scenes or cameras that change every frame. */
  stable(rw: RenderWorld): boolean {
    const previous = this.candidateKey, wasSameWorld = this.candidate === rw;
    const stable = wasSameWorld && sameKey(previous, keyOf(rw, this.probe));
    this.candidate = rw;
    Object.assign(previous, this.probe);
    return stable;
  }

  // ---- captured preparation ----
  private world: RenderWorld | null = null;
  private key = emptyKey();
  private dependencies: BatchDependency[] = [];
  /** The instance records written for the captured batches (`INSTANCE_WORDS` per instance, in draw order). */
  records = new Uint32Array(0);
  /** Every captured instance has an exact rotation x uniform-scale matrix (see {@link hasUniformNormals}). */
  uniformNormals = false;
  /** Instance-buffer generations (ring slots) that already hold `records`. */
  readonly uploadedGenerations = new Set<number>();
  switches: SwitchCounts = { pipeline: 0, material: 0, mesh: 0 };

  // ---- packed per-instance vertex stream (optional path) ----
  packedUploadBytes = 0;
  private packed: GPUBuffer | null = null;
  private packedValid = false;
  private packedData = new Float32Array(0);

  /** True when every captured batch is an undeformed, map-free base PBR draw, i.e. the specialised paths may draw it. */
  supportsPacked(): boolean {
    return this.dependencies.every(d => d.mesh.deformMask === 0 && supportsSpecializedDraw(d.material));
  }

  /** Uploaded once per retained revision, in batch order. General cofactor normals preserve shear/nonuniform/negative scaling. */
  packedBuffer(gpu: GPUContext): GPUBuffer {
    if (this.packedValid) return this.packed!;
    const rw = this.world;
    if (!rw) throw new Error('No retained world to pack');
    const count = this.records.length / INSTANCE_WORDS, bytes = count * RETAINED_INSTANCE_STRIDE;
    if (!this.packed || this.packed.size < bytes) {
      if (this.packed) gpu.resources.buffers.destroy(this.packed);
      this.packed = gpu.resources.buffers.create('RetainedVertexInstances', Math.max(4, bytes), GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    }
    if (this.packedData.length !== count * RETAINED_INSTANCE_WORDS) this.packedData = new Float32Array(count * RETAINED_INSTANCE_WORDS);
    const bits = new Uint32Array(this.packedData.buffer);
    for (let i = 0; i < count; i++) {
      const record = i * INSTANCE_WORDS;   // word 0 = transform slot, word 1 = material index
      packInstance(this.packedData, bits, i * RETAINED_INSTANCE_WORDS, rw.transforms, this.records[record] * 16, this.records[record + 1]);
    }
    if (bytes) { gpu.queue.writeBuffer(this.packed, 0, this.packedData); this.packedUploadBytes += bytes; }
    this.packedValid = true;
    return this.packed;
  }

  /** Forget the captured preparation (the next matching frame captures again). */
  invalidate(): void { this.packedValid = false; this.world = null; this.uploadedGenerations.clear(); }

  /** True when the captured preparation is still exactly what this frame would produce. */
  matches(rw: RenderWorld, materials: ArrayLike<Material>, meshes: ArrayLike<MeshRecord>): boolean {
    if (this.world !== rw || !sameKey(this.key, keyOf(rw, this.probe))) return false;
    for (const d of this.dependencies) {
      const m = materials[d.material.id], mesh = meshes[d.mesh.id];
      if (m !== d.material || mesh !== d.mesh) return false;
      if (m.pipelineSortId !== d.pipelineSortId || m.queue !== d.queue || m.features !== d.features || m.failed !== d.failed) return false;
      if (!sameMeshLayout(mesh, d.layout)) return false;
    }
    return true;
  }

  /** Remember this frame's batches and instance records so identical frames can skip sorting and batching. */
  capture(rw: RenderWorld, batches: BatchList, records: Uint32Array, materials: ArrayLike<Material>, meshes: ArrayLike<MeshRecord>, switches: SwitchCounts): void {
    this.packedValid = false;
    this.world = rw;
    keyOf(rw, this.key);
    if (this.records.length !== records.length) this.records = new Uint32Array(records.length);
    this.records.set(records);
    this.uniformNormals = true;
    for (let i = 0; i < records.length; i += INSTANCE_WORDS) {
      if (!hasUniformNormals(rw.transforms, records[i] * 16)) { this.uniformNormals = false; break; }
    }
    this.switches = { ...switches };
    this.uploadedGenerations.clear();
    this.dependencies.length = 0;
    for (let i = 0; i < batches.count; i++) {
      const material = materials[batches.materialId[i]], mesh = meshes[batches.meshId[i]];
      this.dependencies.push({ material, mesh, layout: meshLayoutOf(mesh), pipelineSortId: material.pipelineSortId, queue: material.queue, features: material.features, failed: material.failed });
    }
  }
}
