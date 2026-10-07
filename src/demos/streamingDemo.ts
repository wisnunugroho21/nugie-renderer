import type { Demo } from './Demo';
import { entityIndex } from '../ecs/Entity';
import { createPlane } from '../rendering/primitives';
import { TextureStreamer } from '../streaming/TextureStreamer';

/**
 * Texture streaming: a field of quads, each with its own 1024x1024 procedural texture. Mip residency follows on-screen coverage under a
 * memory budget (?budget=<MB>, default 24). The HUD shows resident bytes and the per-frame upload.
 */
export const streamingDemo: Demo = (ctx) => {
  const { world, renderer, gpu, params } = ctx;
  const n = Number(params.get('n') ?? 100), budget = Number(params.get('budget') ?? 24) * 1024 * 1024;
  const streamer = new TextureStreamer(gpu, { budgetBytes: budget, uploadBytesPerFrame: 4 * 1024 * 1024, downgradeDelay: 20 });
  renderer.setTextureStreamer(streamer);
  const plane = renderer.meshes.create('plane', createPlane());
  const S = 1024;
  const side = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const rgba = new Uint8Array(S * S * 4);
    const hue = (i * 0.618) % 1, cell = 16 << (i % 3);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4, chk = (((x / cell) | 0) + ((y / cell) | 0)) & 1;
      const k = 0.35 + 0.6 * chk;
      rgba[o] = 255 * k * (0.5 + 0.5 * Math.sin(hue * 6.28)); rgba[o + 1] = 255 * k * (0.5 + 0.5 * Math.sin(hue * 6.28 + 2.1)); rgba[o + 2] = 255 * k * (0.5 + 0.5 * Math.sin(hue * 6.28 + 4.2)); rgba[o + 3] = 255;
    }
    const tex = streamer.create(`proc${i}`, rgba, S, S, true);
    const mat = renderer.materials.createPBR({ baseColor: [1, 1, 1, 1], roughness: 0.9, metallic: 0, textures: { baseColor: tex } });
    const e = entityIndex(world.create());
    world.transforms.add(e, ((i % side) - side / 2) * 3.2, 0, (Math.floor(i / side) - side / 2) * 3.2);
    world.transforms.setRotation(e, Math.SQRT1_2, 0, 0, Math.SQRT1_2);   // upright
    world.transforms.setScale(e, 3, 1, 3);
    world.meshRenderers.add(e, plane, mat);
    world.bounds.add(e, -0.5, -0.1, -0.5, 0.5, 0.1, 0.5);
  }
  ctx.orbit.distance = 10; ctx.orbit.pitch = 0.2; ctx.orbit.autoRotate = 0.15;
};
