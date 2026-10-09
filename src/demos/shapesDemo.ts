import type { Demo } from './Demo';
import {
  createCube, createUVSphere, createPlane, type MeshData,
} from '../rendering/primitives';
import {
  createCylinder, createCone, createCapsule, createTorus, createTorusKnot, createTube, sampleCatmullRom, createLathe, createExtrude, createRing,
  createTetrahedron, createOctahedron, createIcosahedron, createDodecahedron, createCircle,
} from '../rendering/shapes';
import { LightType } from '../ecs/components/LightStore';
import { RenderFlags } from '../ecs/components/MeshRendererStore';
import { Quat } from '../math/Quat';
import { setVisible } from '../ecs/Hierarchy';

/**
 * Showcase of the scene-building toolbox: every procedural primitive on a rotating carousel group (object grouping), an InstancedMesh
 * spiral (`?n=<count>`, default 8000), a BatchedMesh of mixed geometries, thick lines and debug boxes, a point cloud, textured sprites
 * and text labels (world-space billboards plus a screen-space HUD). Add `&env=sky` for image-based lighting.
 */
export const shapesDemo: Demo = (ctx) => {
  const { renderer, world, params } = ctx;
  const mats = renderer.materials;
  const n = Math.max(0, Math.floor(Number(params.get('n') ?? 8000)));
  const mesh = (name: string, data: MeshData) => renderer.meshes.create(name, data);

  ctx.spawnLight({ type: LightType.Directional, rotation: [-0.5, 0.3, 0.1, 0.8], intensity: 3, color: [1, 0.96, 0.9], castShadow: true });
  ctx.spawnObject({ mesh: mesh('floor', createPlane()), material: mats.createPBR({ name: 'floor', baseColor: [0.32, 0.34, 0.37, 1], roughness: 0.9 }), scale: [60, 1, 60], flags: RenderFlags.Static | RenderFlags.ReceiveShadow });

  // --- primitives on a carousel: ONE group entity rotates, every shape is its child
  const shapes: [string, MeshData][] = [
    ['sphere', createUVSphere(32, 16)], ['cube', createCube()], ['cylinder', createCylinder()], ['cone', createCone()], ['capsule', createCapsule()],
    ['torus', createTorus()], ['torus knot', createTorusKnot()], ['tetra', createTetrahedron()], ['octa', createOctahedron()], ['icosa', createIcosahedron()],
    ['dodeca', createDodecahedron()], ['icosphere', createIcosahedron(0.5, 2)],
    ['lathe', createLathe([[0.0, -0.5], [0.35, -0.5], [0.15, -0.2], [0.12, 0.1], [0.3, 0.3], [0.2, 0.5]], { segments: 32 })],
    ['extrude', createExtrude([[-0.5, -0.4], [0.5, -0.4], [0.5, 0.0], [0.1, 0.0], [0.1, 0.4], [-0.5, 0.4]], { depth: 0.4 })],
    ['tube', createTube(sampleCatmullRom([[-0.5, -0.3, 0], [-0.2, 0.4, 0.2], [0.2, -0.4, -0.2], [0.5, 0.3, 0]], 10), { radius: 0.07, radialSegments: 12 })],
    ['ring', createRing({ innerRadius: 0.25, outerRadius: 0.5 })], ['disc', createCircle()],
  ];
  const carousel = ctx.spawnGroup({ position: [0, 0, 0], name: 'carousel' });
  const shapeEntities: number[] = [];
  const R = 8;
  shapes.forEach(([name, data], i) => {
    const m = mats.createPBR({ name, baseColor: hsv(i / shapes.length, 0.65, 0.95), roughness: 0.35 + 0.4 * ((i * 7) % 5) / 5, metallic: i % 4 === 0 ? 0.8 : 0 });
    const a = (i / shapes.length) * Math.PI * 2;
    const e = ctx.spawnObject({ mesh: mesh(name, data), material: m, position: [Math.cos(a) * R, 1.3, Math.sin(a) * R], scale: 1.6, parent: carousel, name });
    shapeEntities.push(e);
  });

  // --- InstancedMesh: a spiral galaxy of small cubes, a few palette materials
  const palette = [[1, 0.35, 0.3], [1, 0.8, 0.3], [0.4, 0.9, 0.5], [0.4, 0.6, 1]].map((c, i) => mats.createPBR({ name: `star${i}`, baseColor: [...c, 1] as [number, number, number, number], roughness: 0.5, emissive: c as [number, number, number], emissiveStrength: 0.15 }));
  const field = ctx.createInstancedMesh({ mesh: mesh('speck', createCube()), material: palette[0], count: n, position: [0, 6, 0], flags: RenderFlags.None, name: 'galaxy' });
  const galaxyQ = Quat.create();
  const placeStar = (i: number, t: number): void => {
    const r = 0.5 + 12 * Math.sqrt(i / Math.max(n, 1)), arm = (i % 3) * (Math.PI * 2 / 3), ang = arm + r * 0.45 + t * 0.15 / (0.5 + r * 0.2);
    Quat.fromAxisAngle(galaxyQ, 0, 1, 0, ang * 2);
    field.setTRSAt(i, Math.cos(ang) * r, Math.sin(i * 12.9898) * 0.5 * (1 - r / 13), Math.sin(ang) * r, galaxyQ[0], galaxyQ[1], galaxyQ[2], galaxyQ[3], 0.12, 0.12, 0.12);
  };
  for (let i = 0; i < n; i++) { placeStar(i, 0); field.setMaterialAt(i, palette[i % 4]); }

  // --- BatchedMesh: three different geometries, one material, hundreds of instances
  const batch = ctx.createBatchedMesh({ material: mats.createPBR({ name: 'batch', baseColor: [0.85, 0.85, 0.9, 1], roughness: 0.3, metallic: 0.6 }), position: [-14, 0, -6], name: 'batch' });
  const geos = [batch.addGeometry(mesh('b-cube', createCube())), batch.addGeometry(mesh('b-cone', createCone())), batch.addGeometry(mesh('b-capsule', createCapsule()))];
  const batchIds: number[] = [];
  for (let i = 0; i < 240; i++) {
    const g = geos[i % 3], x = (i % 16) * 0.8, z = Math.floor(i / 16) * 0.8;
    batchIds.push(batch.addInstance(g, { position: [x, 0.5, z], scale: 0.5 }));
  }

  // --- lines, points, sprites, text (all drawn after the scene)
  const lines = ctx.createLineSystem({ autoClear: true, width: 2 });
  const knot = createTorusKnotPath();
  const points = ctx.createPointSystem({ autoClear: true, size: 3, color: [1, 0.9, 0.5, 1] });
  const mark = ctx.createLineSystem({ depthTest: false, width: 3 });      // retained: a screen-over-everything marker
  mark.cross([0, 0.02, 0], 0.6, [1, 1, 1, 0.9]);

  let labels: ReturnType<ReturnType<typeof ctx.createTextSystem>['addText']>[] = [];
  let hud: ReturnType<ReturnType<typeof ctx.createTextSystem>['addText']> | null = null;
  ctx.createFont({ family: 'sans-serif', weight: 'bold', size: 64 }).then((f) => {
    const world3d = ctx.createTextSystem(f);
    labels = shapes.map(([name]) => world3d.addText(f, name, { position: [0, 0, 0], size: 0.45, color: [1, 1, 1, 1], anchor: [0.5, 0] }));
    const screen = ctx.createTextSystem(f, { space: 'screen' });
    hud = screen.addText(f, 'shapes demo', { position: [12, 12, 0], size: 20, color: [1, 1, 1, 0.95] });
  });
  createImageBitmap(makeGlowCanvas()).then((bmp) => {
    const sparkles = ctx.createSpriteSystem({ texture: ctx.textures.upload('sparkle', bmp, false), blend: 'additive' });
    for (let i = 0; i < 120; i++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 9;
      sparkles.add({ position: [Math.cos(a) * r, 0.3 + Math.random() * 5, Math.sin(a) * r], size: 0.25 + Math.random() * 0.35, color: [1, 0.85, 0.5, 0.8], rotation: Math.random() * 6 });
    }
  });

  ctx.orbit.distance = 26; ctx.orbit.pitch = 0.45; ctx.orbit.target[1] = 2; ctx.orbit.autoRotate = 0.05;
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyH') { hidden = !hidden; setVisible(world, carousel, !hidden); } });
  let hidden = false, frames = 0, acc = 0, fps = 0;
  const wp = (e: number): [number, number, number] => { const w = world.transforms.worldMatrices; return [w[e * 16 + 12], w[e * 16 + 13], w[e * 16 + 14]]; };

  return (t, dt) => {
    // grouping: rotating the one group entity moves every shape; spin each shape on its own too
    world.transforms.setRotation(carousel, 0, Math.sin(t * 0.1), 0, Math.cos(t * 0.1));
    shapeEntities.forEach((e, i) => { const q = Quat.fromAxisAngle(Quat.create(), 0.3, 1, 0.2, t * 0.6 + i); world.transforms.setRotation(e, q[0], q[1], q[2], q[3]); });
    // instancing: re-pose a slice of the galaxy each frame
    const slice = Math.min(n, 3000);
    for (let k = 0; k < slice; k++) placeStar((k * 7919 + frames * 31) % Math.max(n, 1), t);
    // batching: wobble a few instances, hide some
    for (let k = 0; k < batchIds.length; k++) if (k % 5 === 0) batch.setPositionAt(batchIds[k], (k % 16) * 0.8, 0.5 + 0.3 * Math.sin(t * 2 + k), Math.floor(k / 16) * 0.8);
    // lines: grid + axes + bounding boxes of the carousel shapes + a path
    lines.grid(60, 30, 0.01, [0.3, 0.3, 0.33, 1], [0.55, 0.55, 0.6, 1], 5, 1);
    lines.axes([0, 0.02, 0], 3, 3);
    const b = world.bounds.world;
    for (const e of shapeEntities) lines.box([b[e * 6], b[e * 6 + 1], b[e * 6 + 2]], [b[e * 6 + 3], b[e * 6 + 4], b[e * 6 + 5]], [1, 0.55, 0.1, 1], 1.5);
    lines.polyline(knot.map((p) => [p[0] * 4, p[1] * 4 + 9, p[2] * 4] as [number, number, number]), [0.4, 0.9, 1, 1], 2, true);
    lines.sphere([0, 1.3, 0], 2.5, [0.9, 0.9, 0.3, 0.7], 40, 1);
    // points
    for (let i = 0; i < 1500; i++) { const a = i * 2.399 + t * 0.2, r = 1 + (i / 1500) * 6; points.add([Math.cos(a) * r, 9.5 + Math.sin(i * 0.05 + t) * 0.8 + (i / 1500) * 3, Math.sin(a) * r]); }
    // labels follow their shapes (anchored above each one)
    labels.forEach((l, i) => { const p = wp(shapeEntities[i]); l.setPosition([p[0], p[1] + 1.4, p[2]]); });
    // HUD
    frames++; acc += dt;
    if (acc > 0.5) { fps = Math.round(frames / acc); frames = 0; acc = 0; hud?.setText(`shapes demo | ${fps} fps | ${n.toLocaleString()} instanced + ${batch.instanceCount} batched | H hides the carousel`); }
  };
};

/** A closed trefoil-like curve of 120 points for the polyline demo. */
function createTorusKnotPath(): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i < 120; i++) {
    const u = (i / 120) * Math.PI * 2, c = Math.cos(1.5 * u);
    pts.push([(2 + c) * 0.5 * Math.cos(u * 2), (2 + c) * 0.5 * Math.sin(u * 2), Math.sin(1.5 * u) * 0.5]);
  }
  return pts;
}

function hsv(h: number, s: number, v: number): [number, number, number, number] {
  const f = (k: number) => { const x = (k + h * 6) % 6; return v - v * s * Math.max(0, Math.min(x, 4 - x, 1)); };
  return [f(5), f(3), f(1), 1];
}

/** A soft radial glow (white, alpha falling off from the centre). */
function makeGlowCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return c;
}
