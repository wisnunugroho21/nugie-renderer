import type { Demo } from './Demo';
import { GLBBuilder } from '../assets/gltf/GLBBuilder';
import { loadGLTF } from '../assets/gltf/GLTFLoader';
import { instantiateGLTF } from '../assets/gltf/GLTFInstantiator';
import { createPlane, createUVSphere, type MeshData } from '../rendering/primitives';
import { entityIndex } from '../ecs/Entity';
import { STANDARD_VERTEX_FLOATS as F } from '../rendering/VertexLayouts';

/** Draw a procedural 2D image and encode it as PNG bytes (stands in for authored texture files). */
async function png(size: number, draw: (ctx: OffscreenCanvasRenderingContext2D, size: number) => void): Promise<Uint8Array> {
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

function heightNormalMap(ctx: OffscreenCanvasRenderingContext2D, s: number): void {
  const img = ctx.createImageData(s, s);
  const h = (x: number, y: number) => Math.sin((x / s) * Math.PI * 8) * Math.sin((y / s) * Math.PI * 8);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    // +Y in the normal map = image UP, so dh/dy uses -(y) direction
    const dx = (h(x + 1, y) - h(x - 1, y)) * 2.5, dy = -(h(x, y + 1) - h(x, y - 1)) * 2.5;
    const l = Math.hypot(dx, dy, 1);
    const o = (y * s + x) * 4;
    img.data[o] = Math.round(((-dx / l) * 0.5 + 0.5) * 255); img.data[o + 1] = Math.round(((-dy / l) * 0.5 + 0.5) * 255);
    img.data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255); img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Build a textured glTF (sphere with PNG base/MR/normal/emissive textures) as a GLB, entirely in memory. */
async function buildTexturedGLB(mesh: MeshData): Promise<Uint8Array> {
  const b = new GLBBuilder();
  const n = mesh.vertices.length / F;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), tan = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * F;
    pos.set(mesh.vertices.subarray(o, o + 3), i * 3); nor.set(mesh.vertices.subarray(o + 3, o + 6), i * 3);
    uv.set(mesh.vertices.subarray(o + 6, o + 8), i * 2); tan.set(mesh.vertices.subarray(o + 8, o + 12), i * 4);
  }
  const prim = {
    attributes: {
      POSITION: b.accessor(pos, 'VEC3', { minmax: true }), NORMAL: b.accessor(nor, 'VEC3'),
      TEXCOORD_0: b.accessor(uv, 'VEC2'), TANGENT: b.accessor(tan, 'VEC4'),
    },
    indices: b.accessor(Uint32Array.from(mesh.indices), 'SCALAR'), material: 0,
  };
  const images = await Promise.all([
    png(512, (c, s) => { // base color: orange/cream checker with dark grout (sRGB)
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { c.fillStyle = (x + y) % 2 ? '#f2a65a' : '#fff1dc'; c.fillRect(x * s / 8, y * s / 8, s / 8, s / 8); }
      c.strokeStyle = '#3a2a20'; c.lineWidth = 4; for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(i * s / 8, 0); c.lineTo(i * s / 8, s); c.moveTo(0, i * s / 8); c.lineTo(s, i * s / 8); c.stroke(); }
    }),
    png(256, (c, s) => { // metal-rough: G = roughness (smooth stripes), B = metallic (checker)
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const metal = (x + y) % 2 ? 255 : 0; c.fillStyle = `rgb(0,${40 + y * 25},${metal})`; c.fillRect(x * s / 8, y * s / 8, s / 8, s / 8); }
    }),
    png(256, heightNormalMap),
    png(256, (c, s) => { c.fillStyle = '#000'; c.fillRect(0, 0, s, s); c.strokeStyle = '#ff7a18'; c.lineWidth = 6; for (let i = 0; i < 8; i++) { c.beginPath(); c.moveTo(0, i * s / 8 + s / 16); c.lineTo(s, i * s / 8 + s / 16); c.stroke(); } }),
  ]);
  b.json.images = images.map((data) => ({ bufferView: b.view(data), mimeType: 'image/png' }));
  b.json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
  b.json.textures = images.map((_, i) => ({ source: i, sampler: 0 }));
  b.material({
    name: 'textured',
    pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 }, metallicFactor: 1, roughnessFactor: 1 },
    normalTexture: { index: 2, scale: 1 }, emissiveTexture: { index: 3 }, emissiveFactor: [1, 1, 1],
    extensions: { KHR_materials_emissive_strength: { emissiveStrength: 2.5 } },
  });
  b.json.extensionsUsed = ['KHR_materials_emissive_strength'];
  const m = b.mesh({ primitives: [prim] });
  b.addToScene(b.node({ name: 'ball', mesh: m }));
  return b.glb();
}

export const gltfDemo: Demo = (ctx) => {
  const { world, renderer } = ctx;
  const plane = renderer.meshes.create('plane', createPlane());
  const ground = renderer.materials.createPBR({ name: 'ground', baseColor: [0.3, 0.32, 0.36, 1], roughness: 0.95, metallic: 0 });
  const g = entityIndex(world.create());
  world.transforms.add(g, 0, -0.5, 0); world.transforms.setScale(g, 30, 1, 30);
  world.meshRenderers.add(g, plane, ground, 4 /* Static */);
  world.bounds.add(g, -0.5, 0, -0.5, 0.5, 0, 0.5);

  const status = { loaded: false, ms: 0, texturesReady: 0, instances: 0, error: '' };
  (window as unknown as { __gltf: unknown }).__gltf = status;
  const t0 = performance.now();
  // Fully async: the scene is already rendering (with default textures) while this resolves.
  (async () => {
    const glb = await buildTexturedGLB(createUVSphere(64, 32));
    const asset = await loadGLTF(glb);
    const copies = 3;
    for (let i = 0; i < copies; i++) {
      const inst = instantiateGLTF(asset, { world, meshes: renderer.meshes, materials: renderer.materials, textures: ctx.textures });
      world.transforms.setPosition(entityIndex(inst.root), (i - (copies - 1) / 2) * 1.6, 0.35, 0);
      world.transforms.setScale(entityIndex(inst.root), 1.4, 1.4, 1.4);
      status.instances++;
      if (i === 0) await inst.ready;
    }
    status.loaded = true; status.ms = performance.now() - t0; status.texturesReady = ctx.textures.uploads;
  })().catch((e) => { status.error = String(e); console.error(e); });

  ctx.orbit.distance = 6; ctx.orbit.pitch = 0.25; ctx.orbit.autoRotate = 0.2;
  ctx.visibility.mode = 'linear';
};
