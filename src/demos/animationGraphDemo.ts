import type { Demo } from './Demo';
import { buildTentacleGLB } from './tentacle';
import { loadGLTF } from '../assets/gltf/GLTFLoader';
import { instantiateGLTF } from '../assets/gltf/GLTFInstantiator';
import { AnimatedInstance } from '../animation/Animator';
import { AnimationController } from '../animation/graph/AnimationController';
import { AnimationParams } from '../animation/graph/AnimationParams';
import { StateMachine } from '../animation/graph/StateMachine';
import { BlendTree1D, ClipMotion } from '../animation/graph/Motion';
import { buildMorphMask } from '../animation/PoseOps';
import { createPlane } from '../rendering/primitives';
import { entityIndex } from '../ecs/Entity';
import { RenderFlags } from '../ecs/components/MeshRendererStore';

/** One controlled character: its controller plus a per-frame script that drives the parameters and a one-line description for the overlay. */
interface Actor {
  title: string;
  controller: AnimationController;
  drive(t: number): void;
  describe(): string;
}

/**
 * Animation graph demo (`?scene=animgraph`): four skinned + morphing "tentacles" driven by the animation graph instead of a plain clip player.
 *   1. State machine - idle / wave / pulse states with parameter conditions, a trigger, an exit-time transition and crossfades.
 *   2. 1D blend tree - one float parameter blends breathe -> wave -> both.
 *   3. Layers + mask - a base wave layer plus a morph-masked "face" layer whose weight is animated (bones keep waving, only morph weights are overridden).
 *   4. Speed parameter - a state whose playback speed is scaled by a float parameter.
 * Parameters are scripted from the clock so the demo runs unattended; the overlay shows the live state / parameter values.
 * `window.__anim` exposes the actors for tests.
 */
export const animationGraphDemo: Demo = (ctx) => {
  const { world, renderer } = ctx;
  const plane = renderer.meshes.create('plane', createPlane());
  const ground = renderer.materials.createPBR({ name: 'ground', baseColor: [0.3, 0.32, 0.36, 1], roughness: 0.95, metallic: 0 });
  const g = entityIndex(world.create());
  world.transforms.add(g, 0, 0, 0); world.transforms.setScale(g, 60, 1, 60);
  world.meshRenderers.add(g, plane, ground, RenderFlags.Static);
  world.bounds.add(g, -0.5, 0, -0.5, 0.5, 0, 0.5);

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;left:8px;bottom:8px;color:#cfe;font:12px monospace;white-space:pre;background:rgba(0,0,0,.55);padding:6px 8px;pointer-events:none';
  document.body.appendChild(overlay);

  const actors: Actor[] = [];
  const status = { loaded: false, error: '', actors };
  (window as unknown as { __anim: unknown }).__anim = status;

  (async () => {
    const asset = await loadGLTF(buildTentacleGLB());
    let shared: AnimatedInstance | undefined;
    /** Instantiate one tentacle at x and return the pieces needed to build its controller. */
    const spawn = (x: number) => {
      const inst = instantiateGLTF(asset, { world, meshes: renderer.meshes, materials: renderer.materials });
      const root = entityIndex(inst.root);
      world.transforms.setPosition(root, x, 0, 0);
      const ai = AnimatedInstance.fromGLTF(asset, inst, shared);
      shared ??= ai;
      const clip = (name: string) => new ClipMotion(ai.clips[ai.clipIndex(name)]);
      return { root, ai, clip };
    };
    const attach = (root: number, ai: AnimatedInstance, c: AnimationController) => { c.refreshAnimatedNodes(); world.controllers.add(root, ai, c); };

    // ---- 1. state machine -------------------------------------------------------------------------------------------
    {
      const { root, ai, clip } = spawn(-4.5);
      const params = new AnimationParams();
      const excited = params.define('excited', 'bool'), pulse = params.define('pulse', 'trigger');
      const sm = new StateMachine(ai.layout, ai.rest, [
        { name: 'idle', motion: clip('breathe') },
        { name: 'wave', motion: clip('wave') },
        { name: 'pulse', motion: clip('both'), loop: false },
      ], [
        { from: 0, to: 1, conditions: [{ param: excited, op: 'true' }], duration: 0.4 },
        { from: 1, to: 0, conditions: [{ param: excited, op: 'false' }], duration: 0.4 },
        { from: -1, to: 2, conditions: [{ param: pulse, op: 'trigger' }], duration: 0.2 },
        { from: 2, to: 0, exitTime: 1, duration: 0.3 },
      ], 0);
      const controller = new AnimationController(ai.layout, ai.rest, params, [{ name: 'base', stateMachine: sm }]);
      attach(root, ai, controller);
      let lastPulse = -1;
      actors.push({
        title: 'state machine', controller,
        drive: (t) => {
          params.setBool(excited, Math.floor(t / 3) % 2 === 1);              // wave for 3 s, idle for 3 s
          if (t - lastPulse > 8 && Math.floor(t) % 8 === 5) { params.trigger(pulse); lastPulse = t; }   // a one-shot every 8 s
        },
        describe: () => `state ${sm.currentName}${sm.transitioning ? ` (fading, ${(sm.elapsed / Math.max(sm.duration, 1e-6) * 100).toFixed(0)}%)` : ''}  excited=${params.get(excited)}`,
      });
    }

    // ---- 2. 1D blend tree --------------------------------------------------------------------------------------------
    {
      const { root, ai, clip } = spawn(-1.5);
      const params = new AnimationParams();
      const mix = params.define('mix', 'float');
      const tree = new BlendTree1D(ai.layout, mix, [
        { motion: clip('breathe'), threshold: 0 }, { motion: clip('wave'), threshold: 0.5 }, { motion: clip('both'), threshold: 1 },
      ]);
      const sm = new StateMachine(ai.layout, ai.rest, [{ name: 'locomotion', motion: tree }], [], 0);
      const controller = new AnimationController(ai.layout, ai.rest, params, [{ name: 'base', stateMachine: sm }]);
      attach(root, ai, controller);
      actors.push({
        title: 'blend tree', controller,
        drive: (t) => params.setFloat(mix, 0.5 + 0.5 * Math.sin(t * 0.5)),
        describe: () => `mix=${params.get(mix).toFixed(2)}  (0 breathe, 0.5 wave, 1 both)`,
      });
    }

    // ---- 3. layers + morph mask --------------------------------------------------------------------------------------
    {
      const { root, ai, clip } = spawn(1.5);
      const params = new AnimationParams();
      const base = new StateMachine(ai.layout, ai.rest, [{ name: 'wave', motion: clip('wave') }], [], 0);
      const face = new StateMachine(ai.layout, ai.rest, [{ name: 'breathe', motion: clip('breathe') }], [], 0);
      const meshNodes = Array.from({ length: ai.layout.nodeCount }, (_, i) => i).filter((i) => ai.layout.morphCount[i] > 0);
      const controller = new AnimationController(ai.layout, ai.rest, params, [
        { name: 'base', stateMachine: base },
        { name: 'face', stateMachine: face, mask: buildMorphMask(ai.layout, meshNodes), weight: 0 },
      ]);
      attach(root, ai, controller);
      actors.push({
        title: 'layers + mask', controller,
        drive: (t) => controller.setLayerWeight(1, 0.5 + 0.5 * Math.sin(t * 1.3)),
        describe: () => `face layer weight ${controller.layerWeight(1).toFixed(2)} (morph only; the wave keeps playing)`,
      });
    }

    // ---- 4. speed parameter ------------------------------------------------------------------------------------------
    {
      const { root, ai, clip } = spawn(4.5);
      const params = new AnimationParams();
      const speed = params.define('speed', 'float', 1);
      const sm = new StateMachine(ai.layout, ai.rest, [{ name: 'wave', motion: clip('wave'), speedParam: speed }], [], 0);
      const controller = new AnimationController(ai.layout, ai.rest, params, [{ name: 'base', stateMachine: sm }]);
      attach(root, ai, controller);
      actors.push({
        title: 'speed parameter', controller,
        drive: (t) => params.setFloat(speed, 0.2 + 1.8 * (0.5 + 0.5 * Math.sin(t * 0.4))),
        describe: () => `playback speed x${params.get(speed).toFixed(2)}  time ${sm.time.toFixed(2)}`,
      });
    }
    status.loaded = true;
  })().catch((e) => { status.error = String(e); console.error(e); });

  ctx.orbit.distance = 12; ctx.orbit.pitch = 0.25; ctx.orbit.autoRotate = 0.05; ctx.orbit.target[1] = 1;
  ctx.visibility.mode = 'linear';

  return (t) => {
    for (const a of actors) a.drive(t);
    overlay.textContent = status.error ? `error: ${status.error}` : actors.map((a) => `${a.title.padEnd(16)} ${a.describe()}`).join('\n');
  };
};
