import { beforeAll, describe, expect, it } from 'vitest';
import { GLBBuilder, addTriangle } from './helpers/glbBuilder';
import { loadGLTF } from '../src/assets/gltf/GLTFLoader';
import { instantiateGLTF } from '../src/assets/gltf/GLTFInstantiator';
import { GPUResources } from '../src/gpu/GPUResources';
import { MeshManager } from '../src/rendering/MeshManager';
import { MaterialManager } from '../src/rendering/materials/MaterialManager';
import { World } from '../src/ecs/World';
import { entityIndex } from '../src/ecs/Entity';
import { TransformSystem } from '../src/ecs/systems/TransformSystem';
import { BoundsSystem } from '../src/ecs/systems/BoundsSystem';
import type { BindLayouts } from '../src/gpu/BindLayouts';

beforeAll(() => {
  const g = globalThis as any;
  g.GPUBufferUsage = { COPY_DST: 8, COPY_SRC: 4, VERTEX: 32, INDEX: 16, UNIFORM: 64, STORAGE: 128 };
  g.GPUTextureUsage = { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
});

function gpu() {
  const uploads: number[] = [];
  const device = {
    queue: { writeBuffer: (_b: any, _o: number, _d: any, _do: number, size: number) => uploads.push(size), writeTexture() {} },
    createBuffer: (d: any) => ({ label: d.label, size: d.size, destroy() {} }),
    createTexture: () => ({ createView: () => ({}), destroy() {} }),
    createSampler: () => ({}), createShaderModule: () => ({}), createBindGroup: () => ({}),
    createRenderPipeline: () => ({}), pushErrorScope() {}, popErrorScope: () => Promise.resolve(null),
    createCommandEncoder: () => ({ copyBufferToBuffer() {}, finish: () => ({}) }),
  } as unknown as GPUDevice;
  const res = new GPUResources(device);
  const layouts = {} as BindLayouts;
  const world = new World();
  return { world, meshes: new MeshManager(device, res.buffers), materials: new MaterialManager(device, res, layouts), uploads, res };
}

async function model() {
  const b = new GLBBuilder();
  const p0 = addTriangle(b), p1 = addTriangle(b);
  const red = b.material({ name: 'red', pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } });
  const m = b.mesh({ primitives: [{ ...p0, material: red }, p1] });          // 2 primitives
  const single = b.mesh({ primitives: [addTriangle(b)] });                   // 1 primitive
  b.json.cameras = [{ type: 'perspective', perspective: { yfov: 0.9, znear: 0.2, zfar: 80 } }];
  const child = b.node({ name: 'child', mesh: single, translation: [0, 2, 0] });
  const parent = b.node({ name: 'parent', mesh: m, children: [child], translation: [10, 0, 0], scale: [2, 2, 2] });
  const cam = b.node({ camera: 0, translation: [0, 0, 5] });
  b.addToScene(parent, cam);
  return loadGLTF(b.glb());
}

describe('instantiateGLTF', () => {
  it('creates a hierarchy under a root, with correct world transforms', async () => {
    const g = gpu();
    const asset = await model();
    const inst = instantiateGLTF(asset, g);
    const ts = new TransformSystem(g.world.transforms);
    ts.update();
    const t = g.world.transforms;
    const parent = entityIndex(inst.nodeEntities[1]), child = entityIndex(inst.nodeEntities[0]);
    expect(t.parent[parent]).toBe(entityIndex(inst.root));
    expect(t.parent[child]).toBe(parent);
    // child local (0,2,0) under parent T(10,0,0) S(2) => world (10, 4, 0)
    expect(t.worldMatrices[child * 16 + 12]).toBeCloseTo(10);
    expect(t.worldMatrices[child * 16 + 13]).toBeCloseTo(4);
  });

  it('root transform moves the whole model', async () => {
    const g = gpu();
    const inst = instantiateGLTF(await model(), g);
    g.world.transforms.setPosition(entityIndex(inst.root), 100, 0, 0);
    new TransformSystem(g.world.transforms).update();
    expect(g.world.transforms.worldMatrices[entityIndex(inst.nodeEntities[1]) * 16 + 12]).toBeCloseTo(110);
  });

  it('multi-primitive meshes get one renderer entity per primitive; single-primitive uses the node', async () => {
    const g = gpu();
    const inst = instantiateGLTF(await model(), g);
    expect(inst.meshEntities.length).toBe(3);
    const mrs = g.world.meshRenderers;
    const parentIdx = entityIndex(inst.nodeEntities[1]);
    expect(mrs.has.has(parentIdx)).toBe(false);                      // node entity itself has no renderer (2 prims)
    expect(mrs.has.has(entityIndex(inst.nodeEntities[0]))).toBe(true); // single primitive on the node
    const kids = inst.meshEntities.filter((e) => g.world.transforms.parent[entityIndex(e)] === parentIdx && e !== inst.nodeEntities[0]);
    expect(kids.length).toBe(2);
    expect(mrs.materialId[entityIndex(kids[0])]).not.toBe(mrs.materialId[entityIndex(kids[1])]); // red vs default
  });

  it('assigns mesh bounds and they transform with the entity', async () => {
    const g = gpu();
    const inst = instantiateGLTF(await model(), g);
    const ts = new TransformSystem(g.world.transforms), bs = new BoundsSystem(g.world.transforms, g.world.bounds);
    ts.update(); bs.update(ts.updated);
    const e = entityIndex(inst.nodeEntities[0]); // child at world (10,4,0), scale 2, triangle bounds [0..1]
    expect(g.world.bounds.world[e * 6]).toBeCloseTo(10);
    expect(g.world.bounds.world[e * 6 + 3]).toBeCloseTo(12);
    expect(g.world.bounds.world[e * 6 + 1]).toBeCloseTo(4);
  });

  it('uploads meshes and materials ONCE even when instantiated many times', async () => {
    const g = gpu();
    const asset = await model();
    instantiateGLTF(asset, g);
    const meshCount = g.meshes.count, matCount = g.materials.count, bytes = g.meshes.uploadedBytes;
    for (let i = 0; i < 50; i++) instantiateGLTF(asset, g);
    expect(g.meshes.count).toBe(meshCount);
    expect(g.materials.count).toBe(matCount);
    expect(g.meshes.uploadedBytes).toBe(bytes);
    expect(g.world.entities.aliveCount).toBeGreaterThan(50 * 5);
  });

  it('cameras become Camera components with glTF parameters', async () => {
    const g = gpu();
    const inst = instantiateGLTF(await model(), g);
    const c = entityIndex(inst.cameraEntities[0]);
    expect(g.world.cameras.has.has(c)).toBe(true);
    expect(g.world.cameras.fovY[c]).toBeCloseTo(0.9);
    expect(g.world.cameras.far[c]).toBeCloseTo(80);
  });

  it('materials carry glTF factors', async () => {
    const g = gpu();
    const asset = await model();
    const inst = instantiateGLTF(asset, g);
    expect(g.materials.get(inst.materialIds[0]).name).toBe('red');
  });

  it('ready resolves immediately when there are no textures', async () => {
    const g = gpu();
    await expect(instantiateGLTF(await model(), g).ready).resolves.toBeUndefined();
  });
});
