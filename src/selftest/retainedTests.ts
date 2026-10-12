import { GPUContext } from '../gpu/GPUContext';
import { MeshManager } from '../rendering/MeshManager';
import { Renderer } from '../rendering/Renderer';
import { RenderWorld } from '../rendering/RenderWorld';
import { createCube, createUVSphere } from '../rendering/primitives';
import { LightType } from '../ecs/components/LightStore';
import { Mat4 } from '../math/Mat4';
import { readBuffer, type SelfTest } from './harness';

export function retainedTests(gpu: GPUContext): SelfTest[] {
  return [
    { name: 'compact vertices: GPU data parity, writes and growth', run: async () => {
      const meshes = new MeshManager(gpu.device, gpu.resources.buffers, 1, 1);
      const vertices = Float32Array.from({ length: 36 }, (_, i) => i / 8);
      const data = { vertices, indices: new Uint32Array([0, 1, 2]) };
      meshes.create('first', data);
      const check = async (count: number) => {
        const f = new Float32Array(await readBuffer(gpu.device, meshes.compactVertexBuffer, count * 24));
        for (let i = 0; i < count; i++) for (let k = 0; k < 6; k++) {
          if (f[i * 6 + k] !== vertices[(i % 3) * 12 + k]) throw new Error(`compact mismatch at ${i}/${k}`);
        }
      };
      await check(3);
      vertices[3] = -1; (meshes as unknown as { vertices: { write(offset: number, data: Float32Array): void } }).vertices.write(0, vertices); await check(3);
      meshes.create('growth', data); await check(6);
      return 'positions/normals identical after direct writes and arena growth';
    } },
    { name: 'retained PBR: image parity, shear/reflection, scene and resource invalidation', run: async () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 160;
      const context = await GPUContext.create(canvas);
      try {
        const r = new Renderer(context); r.profiler.enabled = false;
        const rw = new RenderWorld(); rw.ensureCapacity(3); rw.count = 3; rw.drawVersion = rw.transformVersion = 0; rw.hasCamera = true;
        rw.camera.position.set([0, 0, 8]); rw.camera.aspect = 1; rw.camera.update();
        const cube = r.meshes.create('cube', createCube()), sphere = r.meshes.create('sphere', createUVSphere(12, 8));
        rw.meshId.set([cube, sphere, cube]); rw.entityIndex.set([1, 2, 3]);
        for (let i = 0; i < 3; i++) {
          rw.materialId[i] = r.materials.createPBR({ baseColor: [0.2 + i * 0.2, 0.7 - i * 0.15, 0.3, 1], metallic: i / 2, roughness: 0.15 + i * 0.3, doubleSided: true });
          const o = i * 16, m = Mat4.create();
          m[0] = i === 0 ? -0.7 : 0.8; m[5] = 0.5 + i * 0.2; m[10] = 0.6;
          m[4] = 0.3; m[9] = -0.2; m[12] = (i - 1) * 1.8;
          rw.transforms.set(m, o); rw.boundsSphere.set([m[12], 0, 0, 1], i * 4);
        }
        r.retainedVertex = true; await r.warmup([0]);
        rw.changedSlots.push(0, 1, 2);
        const addLight = (type: LightType) => {
          rw.lights.clear(); rw.lights.add({ type, position: [0, 2, 4], direction: [0, 0, -1], color: [1, 0.8, 0.7], intensity: 2, range: 10, innerCone: 0, outerCone: 0.5 });
          rw.lights.ambientSky.set([0.05, 0.1, 0.1]); rw.lights.ambientGround.set([0.02, 0.02, 0.02]); rw.lights.finalize();
        };
        const snap = () => {
          const c = document.createElement('canvas'); c.width = c.height = 160;
          const ctx = c.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(canvas, 0, 0); return ctx.getImageData(0, 0, 160, 160).data;
        };
        const compare = async (packed = false, lightingDraws = 3, eligible = true) => {
          const vertexDraws = packed && eligible ? 3 : 0;
          const bundleDraws = eligible && (packed || lightingDraws > 0) ? 3 : 0;
          r.retainedVertex = false; r.retainedLighting = false; r.render(rw); const a = snap(); await context.queue.onSubmittedWorkDone();
          r.retainedVertex = packed; r.retainedLighting = true; for (let i = 0; i < 5; i++) r.render(rw);
          const b = snap(); await context.queue.onSubmittedWorkDone();
          let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
          if (sum / a.length > 0.15) throw new Error(`image MAE ${sum / a.length}`);
          if (r.stats.retainedVertexDraws !== vertexDraws || r.stats.retainedLightingDraws !== lightingDraws || r.stats.retainedBundleDraws !== bundleDraws) throw new Error('retained mode selection failed');
          let covered = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - a[0]) + Math.abs(a[i+1] - a[1]) + Math.abs(a[i+2] - a[2]) > 8) covered++;
          if (covered < 200) throw new Error('parity test did not draw visible geometry');
          if (r.stats.drawCalls !== 3 || r.stats.instances !== 3) throw new Error('bundle counters changed');
        };
        addLight(LightType.Directional); await compare(); await compare(true);
        addLight(LightType.Point); await compare(false, 0); await compare(true, 0); // directional specialization must stop
        addLight(LightType.Directional); await compare(); // specialization can return
        rw.camera.position[0] = 0.4; rw.camera.update(); await compare();
        r.materials.setPBR(rw.materialId[0], { roughness: 0.75 }); await compare();
        const tex = context.device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        context.queue.writeTexture({ texture: tex }, new Uint8Array([255, 128, 64, 255]), { bytesPerRow: 4 }, [1, 1]);
        r.materials.setTexture(rw.materialId[0], 0, { id: 'parity-map', view: tex.createView() }); await compare(false, 0, false);
        r.materials.setTexture(rw.materialId[0], 0, null); await compare();
        // Material-buffer and compact-vertex reallocation replace resources embedded in bundles.
        for (let i = 0; i < 80; i++) r.materials.createPBR();
        r.meshes.create('growth', createUVSphere(256, 256)); await compare();
        rw.transforms[12] += 0.25; rw.transformVersion++; rw.changedSlots.push(0); await compare();
        for (let i = 0; i < 3; i++) { const o = i * 16; rw.transforms[o] = rw.transforms[o+5] = rw.transforms[o+10] = 0.7; rw.transforms[o+4] = rw.transforms[o+9] = 0; }
        rw.transformVersion++; rw.changedSlots.push(0, 1, 2); await compare();
        r.sceneResources.fog.enabled = true; await compare(false, 0);
        r.sceneResources.fog.enabled = false; await compare();
        if (context.errors.length) throw new Error(context.errors.join(' | '));
        return 'general/retained agree with nonuniform scale, shear, negative scale, point-light fallback and resource growth';
      } finally { context.device.destroy(); }
    } },
  ];
}
