import type { GPUContext } from '../gpu/GPUContext';
import { MeshletCuller, meshletVisible } from '../rendering/MeshletCuller';
import { buildMeshlets, type MeshletSet } from '../geometry/MeshOptimizer';
import { createUVSphere } from '../rendering/primitives';
import { STANDARD_VERTEX_FLOATS } from '../rendering/VertexLayouts';
import { Frustum } from '../math/Frustum';
import { Mat4 } from '../math/Mat4';
import { Quat } from '../math/Quat';
import { readBuffer, type SelfTest } from './harness';

/** Sorted "a,b,c" keys of the triangles of a flat index list (vertex order inside a triangle is kept: winding matters). */
function triangleKeys(indices: ArrayLike<number>, count: number): string[] {
  const keys: string[] = [];
  for (let t = 0; t < count; t += 3) keys.push(`${indices[t]},${indices[t + 1]},${indices[t + 2]}`);
  return keys.sort();
}

/** The triangles of the meshlets `keep` accepts, as sorted keys. */
function expectedKeys(set: MeshletSet, keep: (i: number) => boolean): string[] {
  const flat: number[] = [];
  for (let i = 0; i < set.count; i++) {
    if (!keep(i)) continue;
    for (let t = 0; t < set.triangleCount[i] * 3; t++) flat.push(set.vertices[set.vertexOffset[i] + set.triangles[set.triangleOffset[i] * 3 + t]]);
  }
  return triangleKeys(flat, flat.length);
}

/** GPU meshlet culling vs the CPU reference: same surviving triangles, one compacted index buffer, one indirect draw's arguments. */
export function meshletTests(gpu: GPUContext): SelfTest[] {
  return [{
    name: 'meshlets: GPU culling keeps the same triangles as the CPU reference (frustum + normal cone, transformed model)',
    run: async () => {
      const sphere = createUVSphere(48, 24);
      const positions = new Float32Array((sphere.vertices.length / STANDARD_VERTEX_FLOATS) * 3);
      for (let v = 0; v < positions.length / 3; v++) positions.set(sphere.vertices.subarray(v * STANDARD_VERTEX_FLOATS, v * STANDARD_VERTEX_FLOATS + 3), v * 3);
      const set = buildMeshlets(positions, sphere.indices, 64, 124);
      const culler = new MeshletCuller(gpu, set);
      const rot = Quat.fromAxisAngle(Quat.create(), 0.3, 0.8, -0.5, 1.9);
      const cases: { name: string; model: Float32Array; eye: number[]; target: number[]; far: number }[] = [
        { name: 'identity, camera on +Z', model: Mat4.create(), eye: [0, 0, 4], target: [0, 0, 0], far: 50 },
        { name: 'rotated, scaled, off-centre', model: Mat4.compose(Mat4.create(), 0.4, -0.2, 0.3, rot[0], rot[1], rot[2], rot[3], 1.7, 1.7, 1.7) as Float32Array, eye: [5, 3, 6], target: [0.4, -0.2, 0.3], far: 50 },
        { name: 'camera close: the sphere spills out of the frustum', model: Mat4.create(), eye: [0, 0, 1.6], target: [0.3, 0, 0], far: 50 },
        { name: 'camera behind the object looking away: nothing visible', model: Mat4.create(), eye: [0, 0, 4], target: [0, 0, 20], far: 50 },
      ];
      const lines: string[] = [];
      for (const k of cases) {
        const frustum = new Frustum();
        const view = Mat4.lookAt(Mat4.create(), k.eye[0], k.eye[1], k.eye[2], k.target[0], k.target[1], k.target[2]);
        frustum.setFromViewProjection(Mat4.multiply(Mat4.create(), Mat4.perspective(Mat4.create(), Math.PI / 3, 1.4, 0.05, k.far), view));
        const enc = gpu.device.createCommandEncoder();
        culler.encode(enc, { model: k.model, planes: frustum.planes, eye: k.eye, baseVertex: 7 });
        gpu.device.queue.submit([enc.finish()]);
        const args = new Uint32Array(await readBuffer(gpu.device, culler.argsBuffer, 20));
        const indices = new Uint32Array(await readBuffer(gpu.device, culler.indexBuffer, Math.max(4, culler.totalIndices * 4)));
        if (args[1] !== 1 || args[3] !== 7) throw new Error(`${k.name}: static draw arguments were overwritten (${Array.from(args)})`);
        const got = triangleKeys(indices, args[0]);
        const strict = expectedKeys(set, (i) => meshletVisible(set, i, k.model, frustum.planes, k.eye, -1e-3));
        const loose = expectedKeys(set, (i) => meshletVisible(set, i, k.model, frustum.planes, k.eye, 1e-3));
        // strict <= got <= loose (as multisets of triangles; every triangle is unique here)
        const gotSet = new Set(got), looseSet = new Set(loose);
        for (const t of strict) if (!gotSet.has(t)) throw new Error(`${k.name}: the GPU dropped a triangle the CPU keeps (${t})`);
        for (const t of got) if (!looseSet.has(t)) throw new Error(`${k.name}: the GPU kept a triangle the CPU culls (${t})`);
        if (got.length !== gotSet.size) throw new Error(`${k.name}: a triangle was written twice`);
        const all = culler.totalIndices / 3;
        lines.push(`${k.name}: ${got.length}/${all} triangles`);
        if (k.name.startsWith('camera behind') && got.length !== 0) throw new Error('triangles survived with the camera looking away');
        if (k.name.startsWith('identity') && !(got.length > 0 && got.length < all)) throw new Error('expected a partial cull (back faces gone, front faces kept)');
      }
      culler.destroy();
      return lines.join('; ');
    },
  }];
}
