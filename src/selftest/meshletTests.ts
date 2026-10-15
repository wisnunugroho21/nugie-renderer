import { GPUContext } from '../gpu/GPUContext';
import { Renderer } from '../rendering/Renderer';
import { RenderWorld } from '../rendering/RenderWorld';
import { LightType } from '../ecs/components/LightStore';
import { MeshletCuller, meshletVisible } from '../rendering/MeshletCuller';
import { buildMeshlets, type MeshletSet } from '../geometry/MeshOptimizer';
import { createCube, createUVSphere } from '../rendering/primitives';
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
  }, {
    name: 'meshlets in the draw path: same image as the whole-mesh draw, fewer triangles, standard and bundled paths',
    run: async () => {
      const size = 160, canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const context = await GPUContext.create(canvas);
      try {
        const r = new Renderer(context); r.profiler.enabled = false;
        const rw = new RenderWorld(); rw.ensureCapacity(2); rw.count = 2; rw.drawVersion = rw.transformVersion = 0; rw.hasCamera = true;
        // close to the sphere (radius 0.5): part of it leaves the frustum, and its back half faces away
        rw.camera.position.set([0.3, 0.15, 0.9]); rw.camera.target.set([0.15, 0, 0]); rw.camera.fovY = 1; rw.camera.aspect = 1; rw.camera.update();
        const sphere = r.meshes.create('sphere', createUVSphere(48, 24)), cube = r.meshes.create('cube', createCube());
        rw.meshId.set([sphere, cube]); rw.entityIndex.set([1, 2]);
        rw.materialId[0] = r.materials.createPBR({ baseColor: [0.8, 0.4, 0.2, 1], roughness: 0.4 });
        rw.materialId[1] = r.materials.createPBR({ baseColor: [0.2, 0.5, 0.8, 1], roughness: 0.6 });
        const sphereModel = Mat4.compose(Mat4.create(), 0, 0, 0, 0, 0, 0, 1, 1, 1, 1), cubeModel = Mat4.compose(Mat4.create(), -0.5, -0.3, -1.2, 0, 0, 0, 1, 0.5, 0.5, 0.5);
        rw.transforms.set(sphereModel, 0); rw.transforms.set(cubeModel, 16);
        rw.boundsSphere.set([0, 0, 0, 0.5, -0.5, -0.3, -1.2, 0.5]);
        rw.changedSlots.push(0, 1);
        rw.lights.clear(); rw.lights.add({ type: LightType.Directional, position: [0, 0, 0], direction: [-0.4, -0.7, -0.6], color: [1, 1, 1], intensity: 2, range: 0, innerCone: 0, outerCone: 0 });
        rw.lights.ambientSky.set([0.1, 0.1, 0.12]); rw.lights.ambientGround.set([0.03, 0.03, 0.03]); rw.lights.finalize();
        await r.warmup([0]);
        const snap = () => {
          const c = document.createElement('canvas'); c.width = c.height = size;
          const ctx = c.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(canvas, 0, 0); return ctx.getImageData(0, 0, size, size).data;
        };
        r.meshlets.enable(sphere);
        const lines: string[] = [];
        for (const bundled of [false, true]) {
          r.retainedLighting = bundled;
          r.meshlets.enabled = false;
          for (let i = 0; i < 4; i++) r.render(rw);
          const whole = snap(); await context.queue.onSubmittedWorkDone();
          r.meshlets.enabled = true;
          for (let i = 0; i < 4; i++) r.render(rw);
          const culled = snap(); await context.queue.onSubmittedWorkDone();
          const st = r.stats;
          if (st.meshlets.draws !== 1) throw new Error(`expected one meshlet draw, got ${st.meshlets.draws}`);
          if (bundled && st.retainedBundleDraws === 0) throw new Error('the bundled path was not taken');
          if (!bundled && st.retainedBundleDraws !== 0) throw new Error('the standard path was not taken');
          if (st.drawCalls !== 2) throw new Error(`draw calls ${st.drawCalls}`);
          let diff = 0, covered = 0;
          const bg = [r.clearColor.r * 255, r.clearColor.g * 255, r.clearColor.b * 255];
          for (let i = 0; i < whole.length; i += 4) {
            const d = Math.abs(whole[i] - culled[i]) + Math.abs(whole[i + 1] - culled[i + 1]) + Math.abs(whole[i + 2] - culled[i + 2]);
            if (d > 6) diff++;
            if (Math.abs(whole[i] - bg[0]) + Math.abs(whole[i + 1] - bg[1]) + Math.abs(whole[i + 2] - bg[2]) > 8) covered++;
          }
          if (covered < size * size / 4) throw new Error(`the test scene drew too little (${covered} pixels)`);
          if (diff > 0) throw new Error(`${diff} pixels differ from the whole-mesh draw`);
          const culler = r.meshlets.cullerFor(0) ?? r.meshlets.cullerFor(1);
          if (!culler) throw new Error('no culler was planned');
          const args = new Uint32Array(await readBuffer(context.device, culler.argsBuffer, 20));
          if (!(args[0] > 0 && args[0] < culler.totalIndices)) throw new Error(`expected a partial cull, drew ${args[0]} / ${culler.totalIndices} indices`);
          lines.push(`${bundled ? 'bundled' : 'standard'}: ${args[0] / 3} / ${culler.totalIndices / 3} triangles, image identical`);
        }
        if (context.errors.length) throw new Error(context.errors.join(' | '));
        return lines.join('; ');
      } finally { context.device.destroy(); }
    },
  }];
}
