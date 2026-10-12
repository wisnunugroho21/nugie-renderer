import type { Demo } from './Demo';
import { loadGLTF } from '../assets/gltf/GLTFLoader';
import { instantiateGLTF } from '../assets/gltf/GLTFInstantiator';
import { createPlane } from '../rendering/primitives';
import { entityIndex } from '../ecs/Entity';
import { RenderFlags } from '../ecs/components/MeshRendererStore';
import { LightType } from '../ecs/components/LightStore';

/** Compressed glTF fixtures served by the dev server (`npm run dev`); regenerate with `npx tsx scripts/make-codec-fixtures.ts`. */
const MODELS = [
  { url: '/tests/fixtures/sphere-draco-uastc.glb', label: 'KHR_draco_mesh_compression + UASTC KTX2' },
  { url: '/tests/fixtures/sphere-meshopt-etc1s.glb', label: 'EXT_meshopt_compression + ETC1S KTX2' },
];

/**
 * Compressed assets end to end: two spheres loaded from glTF files whose geometry is Draco / meshopt compressed and whose base colour
 * is a Basis Universal KTX2 texture (KHR_texture_basisu). The textures stay block-compressed on the GPU when the device allows it;
 * `window.__compressed` reports the formats chosen. Use `?model=<url>` to load your own file in the middle.
 */
export const compressedDemo: Demo = (ctx) => {
  const { world, renderer, params } = ctx;
  const plane = renderer.meshes.create('plane', createPlane());
  const ground = renderer.materials.createPBR({ name: 'ground', baseColor: [0.3, 0.32, 0.36, 1], roughness: 0.95, metallic: 0 });
  const g = entityIndex(world.create());
  world.transforms.add(g, 0, -0.5, 0); world.transforms.setScale(g, 30, 1, 30);
  world.meshRenderers.add(g, plane, ground, RenderFlags.Static);
  world.bounds.add(g, -0.5, 0, -0.5, 0.5, 0, 0.5);
  ctx.spawnLight({ type: LightType.Directional, rotation: [-0.5, 0.2, 0.1, 0.84], intensity: 3 });

  const status = { loaded: false, ms: 0, models: [] as string[], textureFormats: {} as Record<string, number>, warnings: [] as string[], error: '' };
  (window as unknown as { __compressed: unknown }).__compressed = status;
  const t0 = performance.now();
  const files = params.get('model') ? [{ url: params.get('model')!, label: 'custom' }, ...MODELS] : MODELS;

  (async () => {
    for (const [i, model] of files.entries()) {
      const response = await fetch(model.url);
      if (!response.ok) throw new Error(`Could not load ${model.url}: HTTP ${response.status}`);
      const asset = await loadGLTF(await response.arrayBuffer());
      status.warnings.push(...asset.warnings);
      const instance = instantiateGLTF(asset, { world, meshes: renderer.meshes, materials: renderer.materials, textures: ctx.textures });
      const root = entityIndex(instance.root);
      world.transforms.setPosition(root, (i - (files.length - 1) / 2) * 1.8, 0.4, 0);
      world.transforms.setScale(root, 1.5, 1.5, 1.5);
      status.models.push(model.label);
      await instance.ready;
    }
    status.textureFormats = Object.fromEntries(ctx.textures.ktx2Formats);
    status.loaded = true; status.ms = performance.now() - t0;
  })().catch((e) => { status.error = String(e); console.error(e); });

  ctx.orbit.distance = 6; ctx.orbit.pitch = 0.25; ctx.orbit.autoRotate = 0.2;
};
