import { describe, expect, it } from 'vitest';
import { World } from '../src/ecs/World';
import { entityIndex } from '../src/ecs/Entity';
import { AnimationSystem } from '../src/ecs/systems/AnimationSystem';
import { TransformSystem } from '../src/ecs/systems/TransformSystem';
import { AnimatedInstance } from '../src/animation/Animator';
import { AnimationController } from '../src/animation/graph/AnimationController';
import { AnimationParams } from '../src/animation/graph/AnimationParams';
import { StateMachine } from '../src/animation/graph/StateMachine';
import { ClipMotion } from '../src/animation/graph/Motion';
import { AnimationClip, AnimationChannel } from '../src/animation/AnimationClip';
import { Pose, PoseLayout } from '../src/animation/Pose';
import { TwoBoneIK } from '../src/animation/ik/TwoBoneIK';
import { Quat } from '../src/math/Quat';

const f32 = (...v: number[]) => Float32Array.from(v);
const close = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-3) => { for (let i = 0; i < b.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(eps); };

/** Owner entity + a 4-node leg rig (0 pelvis root, 1 hip, 2 knee, 3 ankle). Node 3 also owns 2 morph weights. */
function rig(opts: { ownerPos?: number[]; ownerYaw?: number; ownerScale?: number } = {}) {
  const world = new World(), t = world.transforms;
  const owner = entityIndex(world.create());
  t.add(owner, ...(opts.ownerPos ?? [0, 0, 0]) as [number, number, number]);
  if (opts.ownerYaw) { const q = Quat.fromAxisAngle(Quat.create(), 0, 1, 0, opts.ownerYaw); t.setRotation(owner, q[0], q[1], q[2], q[3]); }
  if (opts.ownerScale) t.setScale(owner, opts.ownerScale, opts.ownerScale, opts.ownerScale);
  const layout = new PoseLayout(4, [0, 0, 0, 2], [-1, 0, 1, 2]);
  const nodes = [0, 1, 2, 3].map(() => entityIndex(world.create()));
  nodes.forEach((e, i) => { t.add(e); if (i === 0) t.setParent(e, owner); else t.setParent(e, nodes[i - 1]); });
  const rest = new Pose(layout);
  rest.t.set([0, 1, 0, 0, 0, 0, 0, -1, 0.05, 0, -1, 0]);
  nodes.forEach((e, i) => t.setPosition(e, rest.t[i * 3], rest.t[i * 3 + 1], rest.t[i * 3 + 2]));
  world.morphs.add(nodes[3], 2);
  const inst = new AnimatedInstance(layout, Int32Array.from(nodes), [], rest);
  const ts = new TransformSystem(t), sys = new AnimationSystem(world);
  ts.update();
  const attach = (clip: AnimationClip, rootMotion?: AnimationController['rootMotion'], rootNode = 0, setup?: (c: AnimationController) => void) => {
    const sm = new StateMachine(layout, rest, [{ name: clip.name, motion: new ClipMotion(clip) }], [], 0);
    const c = new AnimationController(layout, rest, new AnimationParams(), [{ name: 'base', stateMachine: sm }], rootNode);
    if (rootMotion) c.rootMotion = rootMotion;
    setup?.(c);
    c.refreshAnimatedNodes();
    world.controllers.add(owner, inst, c);
    return c;
  };
  return { world, t, owner, nodes, layout, rest, inst, ts, sys, attach };
}

describe('AnimationController in the ECS', () => {
  it('writes the evaluated pose into the node entities', () => {
    const r = rig();
    r.attach(new AnimationClip('c', [new AnimationChannel(1, 'translation', 'LINEAR', f32(0, 1), f32(0, 0, 0, 4, 0, 0), 3)]));
    r.sys.update(0.5);
    expect(r.t.positionX[r.nodes[1]]).toBeCloseTo(2);
    expect(r.sys.activeControllers).toBe(1);
  });

  it('does not dirty anything when the pose did not change (idle controller)', () => {
    const r = rig();
    r.attach(new AnimationClip('hold', [new AnimationChannel(1, 'translation', 'LINEAR', f32(0, 1), f32(3, 0, 0, 3, 0, 0), 3)]));
    r.sys.update(0.1); r.ts.update();
    r.sys.update(0.1); r.ts.update();
    expect(r.ts.matricesUpdated).toBe(0);
  });

  it('only animated nodes are touched (a 1-node clip on a 4-node rig dirties one node + its subtree)', () => {
    const r = rig();
    r.attach(new AnimationClip('c', [new AnimationChannel(3, 'translation', 'LINEAR', f32(0, 1), f32(0, -1, 0, 1, -1, 0), 3)]));
    r.sys.update(0.2); r.ts.update();
    expect(r.ts.matricesUpdated).toBe(1);   // the ankle (no children)
  });

  it('disabled controllers are skipped', () => {
    const r = rig();
    r.attach(new AnimationClip('c', [new AnimationChannel(1, 'translation', 'LINEAR', f32(0, 1), f32(0, 0, 0, 9, 0, 0), 3)]));
    r.world.controllers.enabled[r.owner] = 0;
    r.sys.update(0.5);
    expect(r.t.positionX[r.nodes[1]]).toBe(0);
    expect(r.sys.activeControllers).toBe(0);
  });

  it('morph weights from layers/clips reach the MorphStore', () => {
    const r = rig();
    r.attach(new AnimationClip('c', [new AnimationChannel(3, 'weights', 'LINEAR', f32(0, 1), f32(0, 0, 1, 0.5), 2)]));
    r.sys.update(0.5);
    const m = r.world.morphs, off = m.weightOffset[r.nodes[3]];
    close(m.weights.subarray(off, off + 2), [0.5, 0.25], 1e-5);
  });

  describe('root motion moves the OWNING entity (and not the skeleton)', () => {
    const walk = () => new AnimationClip('walk', [new AnimationChannel(0, 'translation', 'LINEAR', f32(0, 1), f32(0, 1, 0, 0, 1, 10), 3)]); // +10 along local Z over 1s

    it('translation in the owner frame (rotation + scale respected)', () => {
      const r = rig({ ownerPos: [1, 0, 2], ownerYaw: Math.PI / 2, ownerScale: 2 });
      r.attach(walk(), { mode: 'translation' });
      r.sys.update(0.5);                                    // delta (0,0,5) in model space
      // yaw 90deg about +Y maps local +Z to world +X; scale 2 => 5 * 2 = 10
      close([r.t.positionX[r.owner], r.t.positionY[r.owner], r.t.positionZ[r.owner]], [1 + 10, 0, 2], 1e-3);
      expect(r.t.positionZ[r.nodes[0]]).toBeCloseTo(0);     // the skeleton root did NOT also move
    });

    it('disabled: the skeleton moves, the owner does not', () => {
      const r = rig();
      r.attach(walk(), { mode: 'disabled' });
      r.sys.update(0.5);
      expect(r.t.positionZ[r.owner]).toBe(0);
      expect(r.t.positionZ[r.nodes[0]]).toBeCloseTo(5);
    });

    it('yaw extraction turns the owner entity', () => {
      const r = rig();
      const turn = new AnimationClip('turn', [new AnimationChannel(0, 'rotation', 'LINEAR', f32(0, 1), Float32Array.from([0, 0, 0, 1, ...Quat.fromAxisAngle(Quat.create(), 0, 1, 0, Math.PI / 2)]), 4)]);
      r.attach(turn, { mode: 'rotation' });
      r.sys.update(0.5);
      const q = [r.t.rotationX[r.owner], r.t.rotationY[r.owner], r.t.rotationZ[r.owner], r.t.rotationW[r.owner]];
      expect(2 * Math.atan2(q[1], q[3])).toBeCloseTo(Math.PI / 4, 3);
      close([r.t.rotationX[r.nodes[0]], r.t.rotationY[r.nodes[0]], r.t.rotationW[r.nodes[0]]], [0, 0, 1], 1e-3);
    });

    it('accumulates over many frames and loops (one loop = 10 units)', () => {
      const r = rig();
      r.attach(walk(), { mode: 'translation' });
      for (let i = 0; i < 60; i++) r.sys.update(1 / 30);    // 2 s = 2 loops
      expect(r.t.positionZ[r.owner]).toBeCloseTo(20, 2);
    });
  });

  it('IK driven from a WORLD-space target ends up at that world position after the transform update', () => {
    const r = rig({ ownerPos: [3, 0.5, -2], ownerYaw: 0.8 });
    const ik = new TwoBoneIK(r.layout, 1, 2, 3);
    const clip = new AnimationClip('stand', [new AnimationChannel(0, 'translation', 'LINEAR', f32(0, 1), f32(0, 1, 0, 0, 1, 0), 3)]);
    r.attach(clip, undefined, -1, (c) => c.constraints.push(ik));
    r.ts.update();
    // pick a reachable world target near the original ankle
    const ankleWorld = [r.t.worldMatrices[r.nodes[3] * 16 + 12], r.t.worldMatrices[r.nodes[3] * 16 + 13], r.t.worldMatrices[r.nodes[3] * 16 + 14]];
    const wanted = [ankleWorld[0] + 0.3, ankleWorld[1] + 0.2, ankleWorld[2] - 0.2];
    expect(r.sys.worldToModel(ik.target, r.owner, wanted[0], wanted[1], wanted[2])).toBe(true);
    r.sys.update(0.016); r.ts.update();
    const got = [r.t.worldMatrices[r.nodes[3] * 16 + 12], r.t.worldMatrices[r.nodes[3] * 16 + 13], r.t.worldMatrices[r.nodes[3] * 16 + 14]];
    close(got, wanted, 5e-3);
  });
});
