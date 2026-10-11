import type { Demo } from './Demo';
import { loadGLTF } from '../assets/gltf/GLTFLoader';
import { instantiateGLTF } from '../assets/gltf/GLTFInstantiator';
import { AnimatedInstance } from '../animation/Animator';
import { Animator } from '../animation/AnimatorHandle';
import { createPlane } from '../rendering/primitives';
import { entityIndex } from '../ecs/Entity';
import { RenderFlags } from '../ecs/components/MeshRendererStore';

/** Khronos "Fox" sample (binary glTF, three clips: Survey, Walk, Run). Override with `?model=<url>` (the server must allow cross-origin reads). */
const FOX_URL = 'https://raw.githubusercontent.com/KhronosGroupArchives/glTF-Sample-Models/main/2.0/Fox/glTF-Binary/Fox.glb';
/** The Fox is about 100 units tall; this brings it to roughly two world units. */
const DEFAULT_SCALE = 0.02;

/**
 * Loads the Khronos Fox model over the network, instantiates it and plays its skinned animation.
 * Options: `?model=<url>`, `?clip=<name>` (default `Walk`), `?scale=<n>`, `?speed=<n>`. Keys 1 / 2 / 3 switch to the first three clips.
 */
export const foxDemo: Demo = (ctx) => {
  const { world, renderer, params } = ctx;
  const plane = renderer.meshes.create('plane', createPlane());
  const ground = renderer.materials.createPBR({ name: 'ground', baseColor: [0.3, 0.32, 0.36, 1], roughness: 0.95, metallic: 0 });
  const g = entityIndex(world.create());
  world.transforms.add(g, 0, 0, 0); world.transforms.setScale(g, 30, 1, 30);
  world.meshRenderers.add(g, plane, ground, RenderFlags.Static);
  world.bounds.add(g, -0.5, 0, -0.5, 0.5, 0, 0.5);

  const status = { loaded: false, error: '', clips: [] as string[], playing: '' };
  (window as unknown as { __fox: unknown }).__fox = status;

  (async () => {
    const url = params.get('model') ?? FOX_URL;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}`);
    const asset = await loadGLTF(await response.arrayBuffer());
    const instance = instantiateGLTF(asset, { world, meshes: renderer.meshes, materials: renderer.materials, textures: ctx.textures });
    const root = entityIndex(instance.root);
    const scale = Number(params.get('scale') ?? DEFAULT_SCALE);
    world.transforms.setScale(root, scale, scale, scale);

    const animated = AnimatedInstance.fromGLTF(asset, instance);
    status.clips = animated.clips.map((c) => c.name);
    if (status.clips.length === 0) throw new Error('The model contains no animation clips');
    const requested = animated.clipIndex(params.get('clip') ?? 'Walk');
    const animator = Animator.attach(world, root, animated, requested >= 0 ? requested : 0);
    animator.setLoop(true).setSpeed(Number(params.get('speed') ?? 1)).play();
    status.playing = status.clips[requested >= 0 ? requested : 0];

    window.addEventListener('keydown', (e) => {
      const clip = Number(e.key) - 1;
      if (Number.isInteger(clip) && clip >= 0 && clip < status.clips.length) { animator.play(clip); status.playing = status.clips[clip]; }
    });
    status.loaded = true;
  })().catch((e) => { status.error = String(e); console.error(e); });

  ctx.orbit.distance = 5; ctx.orbit.pitch = 0.3; ctx.orbit.autoRotate = 0.15;
  ctx.orbit.target[1] = 0.8;
  ctx.visibility.mode = 'linear';
};
