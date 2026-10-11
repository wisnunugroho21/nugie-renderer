import type { GPUContext } from '../gpu/GPUContext';
import { RETAINED_INSTANCE_WORDS, RETAINED_INSTANCE_STRIDE } from './VertexLayouts';
import type { RenderWorld } from './RenderWorld';
import type { BatchList } from './BatchBuilder';
import type { Material } from './materials/Material';
import type { MeshRecord } from './MeshManager';
import type { SwitchCounts } from './RenderQueue';

/** Reuses main-view draw preparation for an unchanged, versioned extraction. GPU ring slots are populated independently. */
export class RetainedDrawCache {
  private candidate: RenderWorld | null = null;
  private candidateKey: number[] = [];
  /** Avoid retaining/copying preparation for scenes or cameras that change every frame. */
  stable(rw: RenderWorld): boolean {
    const p = rw.camera.position, old = this.candidateKey;
    const stable = this.candidate === rw && old[0] === rw.drawVersion && old[1] === rw.transformVersion && old[2] === rw.count
      && old[3] === p[0] && old[4] === p[1] && old[5] === p[2] && old[6] === rw.camera.far;
    this.candidate = rw;
    old[0] = rw.drawVersion; old[1] = rw.transformVersion; old[2] = rw.count;
    old[3] = p[0]; old[4] = p[1]; old[5] = p[2]; old[6] = rw.camera.far;
    return stable;
  }

  private world: RenderWorld | null = null;
  private drawVersion = -1;
  private transformVersion = -1;
  private count = -1;
  private camera = new Float64Array(4);
  private dependencies: { material: Material; pipeline: number; queue: string; features: number; failed: boolean; mesh: MeshRecord; values: number[] }[] = [];
  records = new Uint32Array(0);
  /** Exact orthogonal/equal-length columns with positive determinant; general transforms keep cofactor normals. */
  uniformNormals = false;
  readonly uploadedGenerations = new Set<number>();
  switches: SwitchCounts = { pipeline: 0, material: 0, mesh: 0 };

  packedUploadBytes = 0;
  private packed: GPUBuffer | null = null;
  private packedValid = false;
  private packedData = new Float32Array(0);

  supportsPacked(): boolean {
    return this.dependencies.every(d => d.mesh.deformMask === 0 && d.material.shaderId === 'pbr'
      && d.material.vertexEntry === 'vs_main' && d.material.fragmentEntry === 'fs_main' && d.material.kind === 'pbr' && d.material.features === 0 && !d.material.failed);
  }

  /** Uploaded once per retained revision, in batch order. General cofactor normals preserve shear/nonuniform/negative scaling. */
  packedBuffer(gpu: GPUContext): GPUBuffer {
    if (this.packedValid) return this.packed!;
    const rw = this.world;
    if (!rw) throw new Error('No retained world to pack');
    const count = this.records.length / 12, bytes = count * RETAINED_INSTANCE_STRIDE;
    if (!this.packed || this.packed.size < bytes) {
      if (this.packed) gpu.resources.buffers.destroy(this.packed);
      this.packed = gpu.resources.buffers.create('RetainedVertexInstances', Math.max(4, bytes), GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    }
    if (this.packedData.length !== count * RETAINED_INSTANCE_WORDS) this.packedData = new Float32Array(count * RETAINED_INSTANCE_WORDS);
    const f = this.packedData, u = new Uint32Array(f.buffer), t = rw.transforms;
    const cross = (a: number, b: number, c: number, d: number) => Math.fround(Math.fround(a * b) - Math.fround(c * d));
    for (let i = 0; i < count; i++) {
      const src = this.records[i * 12] * 16, o = i * RETAINED_INSTANCE_WORDS;
      f.set(t.subarray(src, src + 16), o);
      for (let col = 0; col < 3; col++) {
        const a = src + ((col + 1) % 3) * 4, b = src + ((col + 2) % 3) * 4;
        f[o + 16 + col * 3] = cross(t[a + 1], t[b + 2], t[a + 2], t[b + 1]);
        f[o + 17 + col * 3] = cross(t[a + 2], t[b], t[a], t[b + 2]);
        f[o + 18 + col * 3] = cross(t[a], t[b + 1], t[a + 1], t[b]);
      }
      u[o + 25] = this.records[i * 12 + 1];
    }
    if (bytes) { gpu.queue.writeBuffer(this.packed, 0, f); this.packedUploadBytes += bytes; }
    this.packedValid = true;
    return this.packed;
  }

  invalidate(): void { this.packedValid = false; this.world = null; this.uploadedGenerations.clear(); }

  matches(rw: RenderWorld, materials: ArrayLike<Material>, meshes: ArrayLike<MeshRecord>): boolean {
    if (this.world !== rw || this.drawVersion !== rw.drawVersion || this.transformVersion !== rw.transformVersion || this.count !== rw.count) return false;
    const p = rw.camera.position;
    if (this.camera[0] !== p[0] || this.camera[1] !== p[1] || this.camera[2] !== p[2] || this.camera[3] !== rw.camera.far) return false;
    for (const d of this.dependencies) {
      const m = materials[d.material.id], mesh = meshes[d.mesh.id];
      if (m !== d.material || mesh !== d.mesh || m.pipelineSortId !== d.pipeline || m.queue !== d.queue || m.features !== d.features || m.failed !== d.failed) return false;
      const v = d.values;
      if (mesh.baseVertex !== v[0] || mesh.vertexCount !== v[1] || mesh.firstIndex !== v[2] || mesh.indexCount !== v[3]
        || mesh.skinBase !== v[4] || mesh.morphBase !== v[5] || mesh.morphStride !== v[6] || mesh.morphTargetCount !== v[7] || mesh.deformMask !== v[8]) return false;
    }
    return true;
  }

  capture(rw: RenderWorld, batches: BatchList, records: Uint32Array, materials: ArrayLike<Material>, meshes: ArrayLike<MeshRecord>, switches: SwitchCounts): void {
    this.packedValid = false;
    this.world = rw; this.drawVersion = rw.drawVersion; this.transformVersion = rw.transformVersion; this.count = rw.count;
    this.camera.set([rw.camera.position[0], rw.camera.position[1], rw.camera.position[2], rw.camera.far]);
    if (this.records.length !== records.length) this.records = new Uint32Array(records.length);
    this.records.set(records);
    this.uniformNormals = true;
    const t = rw.transforms;
    for (let i = 0; i < records.length; i += 12) {
      const o = records[i] * 16;
      const a = t[o], b = t[o+1], c = t[o+2], d = t[o+4], e = t[o+5], f = t[o+6], g = t[o+8], h = t[o+9], j = t[o+10];
      const len = a*a + b*b + c*c;
      if (!(len > 1e-12 && len < 1e12) || len !== d*d + e*e + f*f || len !== g*g + h*h + j*j
        || a*d + b*e + c*f !== 0 || a*g + b*h + c*j !== 0 || d*g + e*h + f*j !== 0
        || a*(e*j-f*h) + b*(f*g-d*j) + c*(d*h-e*g) <= 0) { this.uniformNormals = false; break; }
    }
    this.switches = { ...switches }; this.uploadedGenerations.clear();
    this.dependencies.length = 0;
    for (let i = 0; i < batches.count; i++) {
      const m = materials[batches.materialId[i]], mesh = meshes[batches.meshId[i]];
      this.dependencies.push({ material: m, pipeline: m.pipelineSortId, queue: m.queue, features: m.features, failed: m.failed, mesh,
        values: [mesh.baseVertex, mesh.vertexCount, mesh.firstIndex, mesh.indexCount, mesh.skinBase, mesh.morphBase, mesh.morphStride, mesh.morphTargetCount, mesh.deformMask] });
    }
  }
}
