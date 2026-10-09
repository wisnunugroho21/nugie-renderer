import type { Demo } from './Demo';
import { entityIndex } from '../ecs/Entity';
import { createCube, createUVSphere } from '../rendering/primitives';
import { RenderFlags } from '../ecs/components/MeshRendererStore';

/** Occlusion stress scene: a large wall directly in front of the camera hides a dense field of spheres (use ?gpucull=hiz2). */
export const occlusionDemo: Demo = (ctx) => {
  const { world, renderer, params } = ctx;
  const n = Number(params.get('n') ?? 6000);
  const sphere = renderer.meshes.create('sphere', createUVSphere(Number(params.get('seg') ?? 16), Number(params.get('seg') ?? 16) / 2));
  const cube = renderer.meshes.create('cube', createCube());
  const mats = [0, 1, 2, 3].map((i) => renderer.materials.createPBR({ baseColor: [0.9 - i * 0.2, 0.4 + i * 0.15, 0.3 + i * 0.1, 1], roughness: 0.5, metallic: 0 }));
  const wall = renderer.materials.createPBR({ baseColor: [0.6, 0.6, 0.65, 1], roughness: 0.9, metallic: 0 });
  const flags = RenderFlags.Static | RenderFlags.CastShadow | RenderFlags.ReceiveShadow;
  const w = entityIndex(world.create());
  world.transforms.add(w, 0, 0, 10); world.transforms.setScale(w, 80, 60, 2);
  world.meshRenderers.add(w, cube, wall, flags);
  world.bounds.add(w, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5);
  const side = Math.ceil(Math.cbrt(n));
  for (let i = 0; i < n; i++) {
    const e = entityIndex(world.create());
    world.transforms.add(e, ((i % side) - side / 2) * 2.5, (Math.floor(i / side) % side - side / 2) * 2.5, 16 + Math.floor(i / (side * side)) * 2.5);
    world.meshRenderers.add(e, sphere, mats[i % 4], flags);
    world.bounds.add(e, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5);
  }
  ctx.visibility.mode = 'none';
  ctx.orbit.distance = 30; ctx.orbit.pitch = 0; ctx.orbit.yaw = Math.PI; ctx.orbit.autoRotate = 0;
};
