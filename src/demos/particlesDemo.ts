import type { Demo } from './Demo';
import { entityIndex } from '../ecs/Entity';
import { createCube, createPlane } from '../rendering/primitives';
import { beamPoints } from '../particles/RibbonSystem';

/** Fountain (alpha billboards), fire (additive), sparks (point sprites), debris (mesh particles), orbiting emitter. */
export const particlesDemo: Demo = (ctx) => {
  const { world, renderer } = ctx;
  const ps = renderer.enableParticles();
  const cube = renderer.meshes.create('cube', createCube());
  const plane = renderer.meshes.create('plane', createPlane());
  const ground = renderer.materials.createPBR({ name: 'ground', baseColor: [0.25, 0.27, 0.3, 1], roughness: 0.95, metallic: 0 });
  const g = entityIndex(world.create());
  world.transforms.add(g, 0, 0, 0); world.transforms.setScale(g, 40, 1, 40);
  world.meshRenderers.add(g, plane, ground, 4 /* Static */);
  world.bounds.add(g, -0.5, 0, -0.5, 0.5, 0, 0.5);

  const spawn = (pool: ReturnType<typeof ps.createPool>, emitter: Parameters<typeof pool.addEmitter>[0], x: number, y: number, z: number) => {
    const e = entityIndex(world.create());
    world.transforms.add(e, x, y, z);
    world.particleEmitters.add(e, pool, pool.addEmitter(emitter));
    return e;
  };

  // 1. fountain: cone of alpha-blended droplets under gravity
  const water = ps.createPool({ name: 'water', maxCount: 20000, billboard: { orientation: 'screen', blend: 'alpha' } });
  spawn(water, {
    shape: 'cone', radius: 0.1, coneAngle: 0.25, rate: 2500, radialSpeed: [5.5, 7.5], lifetime: [1.4, 1.9], size: [0.07, 0.12], sizeEndScale: 0.6,
    acceleration: [0, -9.8, 0], drag: 0.15, colorStart: [0.45, 0.7, 1, 0.45], colorEnd: [0.7, 0.9, 1, 0],
  }, -4, 0.05, 0);

  // 2. fire: additive, rising and shrinking
  const fire = ps.createPool({ name: 'fire', maxCount: 20000, billboard: { orientation: 'camera', blend: 'additive' } });
  spawn(fire, {
    shape: 'sphere', radius: 0.25, rate: 1500, lifetime: [0.6, 1.3], size: [0.35, 0.6], sizeEndScale: 0.05, rotation: [0, 6.28], angularVelocity: [-1.5, 1.5],
    velocityMin: [-0.25, 1.2, -0.25], velocityMax: [0.25, 2.4, 0.25], radialSpeed: [0, 0], direction: 'none', acceleration: [0, 0.6, 0], drag: 0.4,
    colorStart: [1, 0.5, 0.1, 0.06], colorEnd: [0.6, 0.05, 0, 0],
  }, 0, 0.2, 0);

  // 3. sparks: constant-pixel-size point sprites, bursting once a second
  const sparks = ps.createPool({ name: 'sparks', maxCount: 8000, billboard: { orientation: 'point', blend: 'additive' } });
  spawn(sparks, {
    shape: 'point', duration: 1, loop: true, bursts: [{ time: 0, count: 400 }], radialSpeed: [2, 7], direction: 'outward', lifetime: [0.6, 1.4], size: [3, 6],
    acceleration: [0, -7, 0], drag: 0.3, colorStart: [1, 0.8, 0.35, 0.8], colorEnd: [1, 0.3, 0.05, 0],
  }, 0, 1.0, 0);

  // 4. debris: ONE cube mesh, instanced by indirect indexed draw
  const debris = ps.createPool({ name: 'debris', maxCount: 4000, mesh: { meshId: cube } });
  spawn(debris, {
    shape: 'sphere', radius: 0.2, duration: 2, loop: true, bursts: [{ time: 0, count: 60 }], radialSpeed: [2, 6], lifetime: [1.6, 2.2], size: [0.1, 0.22], sizeEndScale: 0.3,
    angularVelocity: [-6, 6], acceleration: [0, -9.8, 0], drag: 0.05, colorStart: [0.9, 0.55, 0.25, 1], colorEnd: [0.9, 0.55, 0.25, 1],
  }, 4, 0.6, 0);

  // 5. an emitter entity moving along a circle: world-space particles leave a trail behind it
  const trail = ps.createPool({ name: 'trail', maxCount: 20000, billboard: { orientation: 'screen', blend: 'additive' } });
  const mover = spawn(trail, {
    shape: 'sphere', radius: 0.05, rate: 1200, lifetime: [0.8, 1.2], size: [0.15, 0.22], sizeEndScale: 0, velocityMin: [-0.3, -0.3, -0.3], velocityMax: [0.3, 0.3, 0.3],
    direction: 'none', colorStart: [0.35, 0.7, 1, 0.1], colorEnd: [0.2, 0.2, 1, 0],
  }, 0, 1.5, 4);

  // 6. ribbons: a trail on the orbiting emitter, a re-randomized lightning beam (chain) and a flat sweeping slash
  const trails = renderer.createRibbonSystem({ name: 'trails', maxRibbons: 16, pointsPerRibbon: 64, blend: 'additive' });
  const trailId = trails.addRibbon({ mode: 'trail', widthHead: 0.35, widthTail: 0.02, lifetime: 1.0, minSegment: 0.08, colorStart: [0.5, 0.9, 1, 0.9], colorEnd: [0.3, 0.3, 1, 0] });
  world.ribbonEmitters.add(mover, trails, trailId);

  const beams = renderer.createRibbonSystem({ name: 'beams', maxRibbons: 4, pointsPerRibbon: 48, blend: 'additive' });
  const beamId = beams.addRibbon({ mode: 'chain', widthHead: 0.22, widthTail: 0.22, lifetime: 0, colorStart: [0.7, 0.8, 1, 1], colorEnd: [0.7, 0.8, 1, 1], uvPerMeter: 0.5 });

  const slashes = renderer.createRibbonSystem({ name: 'slashes', maxRibbons: 4, pointsPerRibbon: 32, blend: 'additive' });
  const slashId = slashes.addRibbon({ mode: 'flat', flatNormal: [0, 0, 1], widthHead: 0.0, widthTail: 0.5, lifetime: 0.35, minSegment: 0.05, colorStart: [1, 0.9, 0.5, 1], colorEnd: [1, 0.4, 0.1, 0] });
  const blade = entityIndex(world.create());
  world.transforms.add(blade, 0, 0, 0);
  world.ribbonEmitters.add(blade, slashes, slashId);

  ctx.orbit.distance = 12; ctx.orbit.pitch = 0.35; ctx.orbit.autoRotate = 0.1; ctx.orbit.target[1] = 1;
  let beamSeed = 0, lastBeam = -1;
  return (t) => {
    world.transforms.setPosition(mover, Math.cos(t * 1.4) * 6, 1.2 + Math.sin(t * 2.1) * 0.6, Math.sin(t * 1.4) * 6);
    // lightning: a new jagged path ~20 times a second between two fixed points
    if (t - lastBeam > 0.05) { lastBeam = t; beams.setChain(beamId, beamPoints([-7, 0.2, -3], [-7, 4.2, -3], 24, 0.45, ++beamSeed)); }
    // slash: the "blade" sweeps an arc in the XY plane, in front of the scene (flat ribbon facing +Z)
    const a = (t % 2.0) / 2.0 * Math.PI;
    world.transforms.setPosition(blade, 6 + Math.cos(a) * 2.2, 0.4 + Math.sin(a) * 2.2, -3);
  };
};
