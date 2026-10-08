import type { Demo } from './Demo';
import { buildTentacleGLB } from './tentacle';
import { loadGLTF } from '../assets/gltf/GLTFLoader';
import { instantiateGLTF } from '../assets/gltf/GLTFInstantiator';
import { AnimatedInstance } from '../animation/Animator';
import { Animator } from '../animation/AnimatorHandle';
import { createPlane } from '../rendering/primitives';
import { entityIndex } from '../ecs/Entity';
import { RenderFlags } from '../ecs/components/MeshRendererStore';

/** Skinned, animated "tentacle" characters (generated GLB, `?crowd=<n>`) instantiated in a grid and played with the animator API. */
export const characterDemo: Demo = (ctx) => {
  const { world, renderer, params } = ctx;
  const crowd = Number(params.get('crowd') ?? 9);
  const plane = renderer.meshes.create('plane', createPlane());
  const ground = renderer.materials.createPBR({ name: 'ground', baseColor: [0.3, 0.32, 0.36, 1], roughness: 0.95, metallic: 0 });
  const g = entityIndex(world.create());
  world.transforms.add(g, 0, 0, 0); world.transforms.setScale(g, 60, 1, 60);
  world.meshRenderers.add(g, plane, ground, RenderFlags.Static);
  world.bounds.add(g, -0.5, 0, -0.5, 0.5, 0, 0.5);

  const status = { loaded: false, instances: 0, error: '', animators: [] as number[] };
  (window as unknown as { __char: unknown }).__char = status;
  (async () => {
    const asset = await loadGLTF(buildTentacleGLB());
    const side = Math.ceil(Math.sqrt(crowd));
    let shared: AnimatedInstance | undefined;
    for (let i = 0; i < crowd; i++) {
      const inst = instantiateGLTF(asset, { world, meshes: renderer.meshes, materials: renderer.materials });
      const root = entityIndex(inst.root);
      world.transforms.setPosition(root, ((i % side) - (side - 1) / 2) * 1.2, 0, (Math.floor(i / side) - (side - 1) / 2) * 1.2);
      const ai = AnimatedInstance.fromGLTF(asset, inst, shared);
      shared ??= ai;
      const clip = ['both', 'wave', 'breathe'][i % 3];
      const anim = Animator.attach(world, root, ai, ai.clipIndex(clip));
      anim.time = (i * 0.37) % anim.duration;
      anim.setSpeed(0.8 + (i % 5) * 0.1).play();
      status.animators.push(root);
      status.instances++;
    }
    status.loaded = true;
  })().catch((e) => { status.error = String(e); console.error(e); });

  ctx.orbit.distance = Math.max(5, Math.sqrt(crowd) * 1.8 + 3); ctx.orbit.pitch = 0.35; ctx.orbit.autoRotate = 0.15;
  ctx.orbit.target[1] = 1;
  ctx.visibility.mode = 'linear';
};
