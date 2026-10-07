import type { Demo } from './Demo';
import { entityIndex } from '../ecs/Entity';
import { createPlane, createUVSphere } from '../rendering/primitives';
import { RenderFlags } from '../ecs/components/MeshRendererStore';
import { LightType } from '../ecs/components/LightStore';

/**
 * Point + spot light scene: a grid of spheres on a floor lit by ?n=<count> orbiting coloured point lights, 3 sweeping spot
 * lights and a dim ambient. All lights come from ECS light components (position/direction from the transform; -Z is forward).
 */
export const lightsDemo: Demo = (ctx) => {
  const { world, renderer, params } = ctx;
  const n = Number(params.get('n') ?? 24);
  const sphere = renderer.meshes.create('sphere', createUVSphere(32, 16));
  const plane = renderer.meshes.create('plane', createPlane());
  const mats = [0, 1, 2, 3].map((i) => renderer.materials.createPBR({ baseColor: [0.85, 0.85, 0.85, 1], roughness: 0.2 + i * 0.25, metallic: i < 2 ? 1 : 0 }));
  const ground = renderer.materials.createPBR({ name: 'ground', baseColor: [0.6, 0.6, 0.62, 1], roughness: 0.8, metallic: 0 });
  const g = entityIndex(world.create());
  world.transforms.add(g, 0, -0.5, 0); world.transforms.setScale(g, 40, 1, 40);
  world.meshRenderers.add(g, plane, ground, RenderFlags.Static | RenderFlags.CastShadow | RenderFlags.ReceiveShadow);
  world.bounds.add(g, -0.5, 0, -0.5, 0.5, 0, 0.5);
  for (let i = 0; i < 49; i++) {
    const e = entityIndex(world.create());
    world.transforms.add(e, (i % 7 - 3) * 2.2, 0, (Math.floor(i / 7) - 3) * 2.2);
    world.meshRenderers.add(e, sphere, mats[i % 4], RenderFlags.Static | RenderFlags.CastShadow | RenderFlags.ReceiveShadow);
    world.bounds.add(e, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5);
  }

  const ambient = entityIndex(world.create());
  world.transforms.add(ambient);
  world.lights.add(ambient, LightType.Ambient, 0.03, 0.035, 0.05, 1);

  const points: number[] = [];
  for (let i = 0; i < n; i++) {
    const e = entityIndex(world.create());
    world.transforms.add(e, 0, 1, 0);
    const h = i / n * 6.283;
    world.lights.add(e, LightType.Point, 0.5 + 0.5 * Math.cos(h), 0.5 + 0.5 * Math.cos(h + 2.09), 0.5 + 0.5 * Math.cos(h + 4.19), 6, 5);
    points.push(e);
  }
  const spots: number[] = [];
  for (let i = 0; i < 3; i++) {
    const e = entityIndex(world.create());
    world.transforms.add(e, (i - 1) * 6, 6, 0);
    world.transforms.setRotation(e, -Math.SQRT1_2, 0, 0, Math.SQRT1_2);   // local -Z -> world -Y (pointing down)
    world.lights.add(e, LightType.Spot, i === 0 ? 1 : 0.3, i === 1 ? 1 : 0.4, i === 2 ? 1 : 0.3, 400, 20);
    world.lights.innerCone[e] = 0.12; world.lights.outerCone[e] = 0.3;
    spots.push(e);
  }
  // Rectangular area lights (?area=0 disables): two soft boxes hanging above the grid.
  if (params.get('area') !== '0') {
    [[-5, 3.2, -4, 1, 0.9, 0.8], [5, 3.2, 4, 0.7, 0.85, 1]].forEach(([x, y, z, r, g, b]) => {
      const e = entityIndex(world.create());
      world.transforms.add(e, x, y, z);
      world.transforms.setRotation(e, -Math.SQRT1_2, 0, 0, Math.SQRT1_2);   // face down
      world.lights.addArea(e, 4, 2, r, g, b, 6);
      if (params.get('areashadow') === '1') world.lights.castShadow[e] = 1;
    });
  }
  // Shadows: a sun (cascaded) plus shadow-casting spots; ?shadows=0 disables.
  if (params.get('shadows') !== '0') {
    const sun = entityIndex(world.create());
    world.transforms.add(sun);
    world.transforms.setRotation(sun, -0.5, 0.2, 0.1, 0.84);   // tilted: light travels along its local -Z
    world.lights.add(sun, LightType.Directional, 1, 0.95, 0.85, 2.5);
    world.lights.castShadow[sun] = 1;
    for (const e of spots) world.lights.castShadow[e] = 1;
    // ?pointshadow=1: one extra shadow-casting point light low over the grid (cube shadow map)
    if (params.get('pointshadow') === '1') {
      const pl = entityIndex(world.create());
      world.transforms.add(pl, 0, 2.2, 0);
      world.lights.add(pl, LightType.Point, 1, 0.9, 0.7, 60, 14);
      world.lights.castShadow[pl] = 1;
    }
  }
  ctx.orbit.distance = 20; ctx.orbit.pitch = 0.6; ctx.orbit.autoRotate = 0;

  // Per-frame update: orbit the point lights and sweep the spot lights.
  return (t) => {
    points.forEach((e, i) => {
      const a = t * 0.4 + i / n * 6.283, r = 3 + (i % 3) * 2;
      world.transforms.setPosition(e, Math.cos(a) * r, 0.6 + 0.4 * Math.sin(t + i), Math.sin(a) * r);
    });
    spots.forEach((e, i) => {
      const half = (Math.sin(t * 0.7 + i * 2) * 0.5 - Math.PI / 2) / 2;   // X rotation: -90deg (pointing down) plus a sweep
      world.transforms.setRotation(e, Math.sin(half), 0, 0, Math.cos(half));
    });
  };
};
