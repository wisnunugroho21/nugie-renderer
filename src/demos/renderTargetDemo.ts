import type { Demo } from './Demo';
import { createCube, createPlane, createUVSphere, type MeshData } from '../rendering/primitives';
import { STANDARD_VERTEX_FLOATS } from '../rendering/VertexLayouts';
import { LightType } from '../ecs/components/LightStore';
import { RenderFlags } from '../ecs/components/MeshRendererStore';

/** A unit quad in the XY plane facing +Z with upright, un-mirrored UVs (for monitors showing a render target). */
function createScreenQuad(): MeshData {
  const v = new Float32Array(4 * STANDARD_VERTEX_FLOATS);
  const pts = [[-0.5, -0.5, 0, 1], [0.5, -0.5, 1, 1], [0.5, 0.5, 1, 0], [-0.5, 0.5, 0, 0]];   // x, y, u, v
  pts.forEach((p, i) => v.set([p[0], p[1], 0, 0, 0, 1, p[2], p[3], 1, 0, 0, 1], i * STANDARD_VERTEX_FLOATS));
  return { vertices: v, indices: new Uint32Array([0, 1, 2, 0, 2, 3]) };
}

/**
 * Render-to-texture showcase: a planar mirror wall, a top-down orthographic minimap and a security camera shown on two "monitors",
 * and (`?probe=1`, or press P) a reflection probe captured at the centre of the scene and used as the environment.
 * Add `&env=sky` for image-based lighting.
 */
export const renderTargetDemo: Demo = (ctx) => {
  const { renderer, params } = ctx;
  const mats = renderer.materials;
  const cube = renderer.meshes.create('cube', createCube());
  const sphere = renderer.meshes.create('sphere', createUVSphere(48, 24));
  const plane = renderer.meshes.create('plane', createPlane());
  const quad = renderer.meshes.create('screen', createScreenQuad());

  ctx.spawnLight({ type: LightType.Directional, rotation: [-0.55, 0.25, 0.1, 0.79], intensity: 3, color: [1, 0.95, 0.85], castShadow: true });
  ctx.spawnObject({ mesh: plane, material: mats.createPBR({ name: 'floor', baseColor: [0.55, 0.57, 0.6, 1], roughness: 0.85 }), scale: [26, 1, 26], flags: RenderFlags.Static | RenderFlags.ReceiveShadow });

  // --- a few objects that move, so the views visibly update
  const palette: [number, number, number][] = [[0.9, 0.25, 0.2], [0.2, 0.7, 0.3], [0.25, 0.4, 0.95], [0.95, 0.75, 0.2], [0.8, 0.3, 0.8]];
  const movers = palette.map((c, i) => {
    const m = mats.createPBR({ name: `mover${i}`, baseColor: [...c, 1], roughness: 0.35, metallic: i % 2 ? 0.8 : 0 });
    const e = ctx.spawnObject({ mesh: i % 2 ? cube : sphere, material: m, position: [0, 0.6, 0], scale: i % 2 ? 1 : 1.2 });
    return { e, a: (i / palette.length) * Math.PI * 2, r: 2.2 + (i % 3) * 1.1, s: 0.4 + 0.12 * i };
  });
  const chrome = ctx.spawnObject({ mesh: sphere, material: mats.createPBR({ name: 'chrome', baseColor: [0.95, 0.95, 0.97, 1], metallic: 1, roughness: 0.04 }), position: [0, 1.3, 0], scale: 2.2 });

  // --- planar mirror on the back wall: the main camera reflected in the plane z = -6
  const mirror = ctx.createMirror({ point: [0, 0, -6], normal: [0, 0, 1] }, { tint: [0.92, 0.96, 1], name: 'mirror' });
  ctx.spawnObject({ mesh: quad, material: mirror.material, position: [0, 2.6, -6], scale: [12, 5.2, 1], flags: RenderFlags.None });

  // --- minimap: orthographic top-down camera into a small target, shown on a monitor
  const mapTarget = ctx.createRenderTarget({ width: 256, height: 256, label: 'minimap' });
  const mapView = ctx.addView({ target: mapTarget, interval: 2, skybox: false, clearColor: { r: 0.1, g: 0.12, b: 0.16, a: 1 } });
  mapView.camera.topDownOrthographic(0, 0, 9);
  const monitor = (target: { ref: { id: string; view: GPUTextureView } }) => mats.createPBR({ name: 'monitor', baseColor: [0, 0, 0, 1], roughness: 0.3, emissive: [1, 1, 1], textures: { emissive: target.ref } });
  ctx.spawnObject({ mesh: quad, material: monitor(mapTarget), position: [-9, 2.2, -5.9], scale: [3.6, 3.6, 1], flags: RenderFlags.None });

  // --- security camera: a fixed perspective view from a corner, shown on a second monitor
  const camTarget = ctx.createRenderTarget({ width: 320, height: 180, label: 'security' });
  const camView = ctx.addView({ target: camTarget, interval: 1 });
  const cc = camView.camera;
  cc.position.set([9, 6, 9]); cc.target.set([0, 0.5, 0]); cc.fovY = 0.9; cc.aspect = 320 / 180; cc.near = 0.1; cc.far = 80; cc.update();
  ctx.spawnObject({ mesh: quad, material: monitor(camTarget), position: [9, 2.2, -5.9], scale: [4.8, 2.7, 1], flags: RenderFlags.None });

  // --- probe: capture the surroundings of the chrome sphere and use them as the environment (P re-captures)
  const capture = (): void => {
    const env = ctx.captureEnvironment([0, 1.3, 0], { size: 128, exclude: (e) => e === chrome });
    renderer.setEnvironment(env, 1);
  };
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyP') capture(); });
  let captured = params.get('probe') !== '1';

  ctx.orbit.distance = 15; ctx.orbit.pitch = 0.3; ctx.orbit.yaw = 0.25; ctx.orbit.target[1] = 1.5; ctx.orbit.autoRotate = 0;

  return (t) => {
    for (const m of movers) {
      const a = m.a + t * m.s;
      ctx.world.transforms.setPosition(m.e, Math.cos(a) * m.r, 0.6 + 0.25 * Math.sin(t * 2 + m.a), Math.sin(a) * m.r);
    }
    if (!captured && ctx.app.frame > 5) { captured = true; capture(); }
  };
};
