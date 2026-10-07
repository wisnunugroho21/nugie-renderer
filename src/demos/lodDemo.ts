import type { Demo } from './Demo';
import { entityIndex } from '../ecs/Entity';
import { createPlane, createUVSphere } from '../rendering/primitives';
import { generateLODChainAsync } from '../workers/GeometryJobs';
import { generateLODChain } from '../geometry/LODGenerator';
import { RenderFlags } from '../ecs/components/MeshRendererStore';

/**
 * LOD stress scene: a large field of spheres with 3 detail levels (64x32, 24x12, 8x4 segments). Use ?n=<count> and ?lod=0 to
 * compare against rendering everything at level 0 (see the triangle count in the HUD).
 */
export const lodDemo: Demo = (ctx) => {
  const { world, renderer, params } = ctx;
  const n = Number(params.get('n') ?? 4000), useLOD = params.get('lod') !== '0';
  // ?auto=1: generate the levels from one high-detail mesh with the quadric simplifier instead of hand-made spheres
  const auto = params.get('auto') === '1';
  let hi: number, mid: number, lo: number;
  if (auto) {
    const chain = generateLODChain(createUVSphere(64, 32), [0.12, 0.02]);
    [hi, mid, lo] = chain.map((l, i) => renderer.meshes.create(`sphere-auto${i}`, l.mesh));
  } else {
    hi = renderer.meshes.create('sphere-hi', createUVSphere(64, 32));
    mid = renderer.meshes.create('sphere-mid', createUVSphere(24, 12));
    lo = renderer.meshes.create('sphere-lo', createUVSphere(8, 4));
  }
  const plane = renderer.meshes.create('plane', createPlane());
  const makeGroup = () => renderer.lodLibrary.create({
    name: 'sphere', levels: [{ meshId: hi, minScreenSize: 0.12 }, { meshId: mid, minScreenSize: 0.04 }, { meshId: lo, minScreenSize: 0.006 }],
  });
  // ?worker=1: build the LOD chain in a Web Worker while the scene already renders (LOD turns on when the result arrives)
  const asyncWorker = params.get('worker') === '1';
  let group = asyncWorker ? -1 : makeGroup();
  const entities: number[] = [];
  (window as unknown as { __lodAsync: unknown }).__lodAsync = { done: false, ms: 0 };
  const mats = [0, 1, 2, 3].map((i) => renderer.materials.createPBR({ baseColor: [0.9 - i * 0.15, 0.5 + i * 0.1, 0.3 + i * 0.15, 1], roughness: 0.3 + i * 0.2, metallic: i % 2 }));
  const ground = renderer.materials.createPBR({ name: 'ground', baseColor: [0.3, 0.32, 0.36, 1], roughness: 0.95, metallic: 0 });
  const g = entityIndex(world.create());
  world.transforms.add(g, 0, -0.6, 0); world.transforms.setScale(g, 400, 1, 400);
  world.meshRenderers.add(g, plane, ground, RenderFlags.Static);
  world.bounds.add(g, -0.5, 0, -0.5, 0.5, 0, 0.5);

  const side = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const e = entityIndex(world.create());
    world.transforms.add(e, (i % side - side / 2) * 2.2, 0, (Math.floor(i / side) - side / 2) * 2.2);
    world.transforms.setScale(e, 1.3, 1.3, 1.3);
    world.meshRenderers.add(e, hi, mats[i % 4], RenderFlags.Static);
    world.bounds.add(e, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5);
    entities.push(e);
    if (useLOD && group >= 0) world.lods.add(e, group);
  }
  if (asyncWorker && useLOD) {
    const t0 = performance.now();
    void generateLODChainAsync(createUVSphere(160, 80), [0.12, 0.02]).then((chain) => {
      [hi, mid, lo] = chain.map((l, i) => renderer.meshes.create(`sphere-worker${i}`, l.mesh));
      group = makeGroup();
      for (const e of entities) world.lods.add(e, group);
      (window as unknown as { __lodAsync: unknown }).__lodAsync = { done: true, ms: performance.now() - t0, tris: chain.map((l) => l.triangles) };
    });
  }
  ctx.visibility.mode = 'bvh';
  ctx.orbit.distance = 18; ctx.orbit.pitch = 0.3; ctx.orbit.autoRotate = 0.1;
};
