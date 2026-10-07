import { describe, expect, it } from 'vitest';
import { findKey, sampleChannel } from '../src/animation/AnimationSampler';
import { advanceTime, AnimatedInstance } from '../src/animation/Animator';
import { Animator } from '../src/animation/AnimatorHandle';
import { AnimationClip, AnimationChannel } from '../src/animation/AnimationClip';
import { Pose, PoseLayout } from '../src/animation/Pose';
import { AnimationSystem } from '../src/ecs/systems/AnimationSystem';
import { World } from '../src/ecs/World';
import { entityIndex } from '../src/ecs/Entity';
import { TransformSystem } from '../src/ecs/systems/TransformSystem';
import { GLBBuilder, addTriangle } from './helpers/glbBuilder';
import { loadGLTF } from '../src/assets/gltf/GLTFLoader';
import { Quat } from '../src/math/Quat';

const f32 = (...v: number[]) => Float32Array.from(v);
const close = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-5) => { for (let i = 0; i < b.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(eps); };

describe('findKey', () => {
  const times = f32(0, 1, 2, 4);
  it('locates intervals and clamps outside', () => {
    expect(findKey(times, -1)).toBe(-1);
    expect(findKey(times, 0)).toBe(0);
    expect(findKey(times, 0.99)).toBe(0);
    expect(findKey(times, 1)).toBe(1);
    expect(findKey(times, 3.5)).toBe(2);
    expect(findKey(times, 4)).toBe(3);
    expect(findKey(times, 100)).toBe(3);
    expect(findKey(f32(), 1)).toBe(-1);
  });
  it('hints never change the answer', () => {
    for (let t = -0.5; t < 5; t += 0.137) for (let h = 0; h < 4; h++) expect(findKey(times, t, h)).toBe(findKey(times, t, 0));
  });
});

describe('sampleChannel: STEP / LINEAR', () => {
  const times = f32(0, 1, 2), vals = f32(0, 0, 0, 10, 20, 30, 20, 40, 60);
  const out = new Float32Array(3);
  it('LINEAR interpolates', () => {
    sampleChannel(times, vals, 3, 'LINEAR', false, 0.5, out, 0); close(out, [5, 10, 15]);
    sampleChannel(times, vals, 3, 'LINEAR', false, 1.25, out, 0); close(out, [12.5, 25, 37.5]);
  });
  it('STEP holds the previous key', () => {
    sampleChannel(times, vals, 3, 'STEP', false, 0.99, out, 0); close(out, [0, 0, 0]);
    sampleChannel(times, vals, 3, 'STEP', false, 1, out, 0); close(out, [10, 20, 30]);
  });
  it('clamps to first/last value outside the range', () => {
    sampleChannel(times, vals, 3, 'LINEAR', false, -5, out, 0); close(out, [0, 0, 0]);
    sampleChannel(times, vals, 3, 'LINEAR', false, 99, out, 0); close(out, [20, 40, 60]);
  });
  it('single keyframe is constant', () => {
    sampleChannel(f32(1), f32(7, 8, 9), 3, 'LINEAR', false, 5, out, 0); close(out, [7, 8, 9]);
    sampleChannel(f32(1), f32(7, 8, 9), 3, 'LINEAR', false, 0, out, 0); close(out, [7, 8, 9]);
  });
  it('writes at the output offset only', () => {
    const o = new Float32Array(9).fill(-1);
    sampleChannel(times, vals, 3, 'LINEAR', false, 0.5, o, 3);
    close(o, [-1, -1, -1, 5, 10, 15, -1, -1, -1]);
  });
  it('duplicate times (zero-length interval) do not produce NaN', () => {
    sampleChannel(f32(0, 1, 1, 2), f32(0, 1, 2, 3), 1, 'LINEAR', false, 1, out, 0);
    expect(Number.isFinite(out[0])).toBe(true);
  });
  it('rotation LINEAR uses slerp along the shortest arc and stays unit length', () => {
    const q0 = Quat.create(), q1 = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, Math.PI / 2);
    const nq1 = [-q1[0], -q1[1], -q1[2], -q1[3]]; // same rotation, opposite hemisphere
    const o = new Float32Array(4);
    sampleChannel(f32(0, 1), Float32Array.from([...q0, ...nq1]), 4, 'LINEAR', true, 0.5, o, 0);
    close(o, Quat.fromAxisAngle(Quat.create(), 0, 0, 1, Math.PI / 4), 1e-5);
    expect(Math.hypot(...o)).toBeCloseTo(1, 5);
  });
  it('slerp is constant-angular-speed (unlike nlerp): 25% = 1/4 of the angle', () => {
    const q1 = Quat.fromAxisAngle(Quat.create(), 0, 1, 0, Math.PI);
    const o = new Float32Array(4);
    sampleChannel(f32(0, 1), Float32Array.from([0, 0, 0, 1, ...q1]), 4, 'LINEAR', true, 0.25, o, 0);
    close(o, Quat.fromAxisAngle(Quat.create(), 0, 1, 0, Math.PI / 4), 1e-5);
  });
});

describe('sampleChannel: CUBICSPLINE (glTF layout: in-tangent, value, out-tangent)', () => {
  // scalar, two keys at t=0 and t=2 (dt=2)
  const times = f32(0, 2);
  const out = new Float32Array(1);
  it('hits key values exactly at the keys', () => {
    const v = f32(0, 1, 0, 0, 5, 0);
    sampleChannel(times, v, 1, 'CUBICSPLINE', false, 0, out, 0); expect(out[0]).toBeCloseTo(1);
    sampleChannel(times, v, 1, 'CUBICSPLINE', false, 2, out, 0); expect(out[0]).toBeCloseTo(5);
  });
  it('zero tangents give an ease-in/out curve with value (v0+v1)/2 at the midpoint', () => {
    sampleChannel(times, f32(0, 1, 0, 0, 5, 0), 1, 'CUBICSPLINE', false, 1, out, 0);
    expect(out[0]).toBeCloseTo(3);
    sampleChannel(times, f32(0, 1, 0, 0, 5, 0), 1, 'CUBICSPLINE', false, 0.5, out, 0);
    expect(out[0]).toBeLessThan(2); // slower than linear near the start (linear would be 2)
  });
  it('tangents are scaled by the interval length (spec formula)', () => {
    // s = 0.5, dt = 2: p = 0.5*v0 + 0.125*dt*b0 + 0.5*v1 - 0.125*dt*a1  (h10 = h11 magnitudes 0.125)
    const v = f32(/*a0*/0, /*v0*/0, /*b0*/4, /*a1*/2, /*v1*/10, /*b1*/0);
    sampleChannel(times, v, 1, 'CUBICSPLINE', false, 1, out, 0);
    expect(out[0]).toBeCloseTo(0.5 * 0 + 0.125 * 2 * 4 + 0.5 * 10 - 0.125 * 2 * 2, 5);
  });
  it('matches the analytic Hermite value for random data', () => {
    const r = (() => { let s = 5; return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 4 - 2; })();
    for (let n = 0; n < 20; n++) {
      const a0 = r(), v0 = r(), b0 = r(), a1 = r(), v1 = r(), b1 = r(), t = Math.abs(r()) / 2;
      const dt = 2, s = t / dt;
      const ref = (2 * s ** 3 - 3 * s ** 2 + 1) * v0 + (s ** 3 - 2 * s ** 2 + s) * dt * b0 + (-2 * s ** 3 + 3 * s ** 2) * v1 + (s ** 3 - s ** 2) * dt * a1;
      sampleChannel(times, f32(a0, v0, b0, a1, v1, b1), 1, 'CUBICSPLINE', false, t, out, 0);
      expect(out[0]).toBeCloseTo(ref, 4);
    }
  });
  it('cubic rotations are re-normalized', () => {
    const q0 = [0, 0, 0, 1], q1 = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, 1.2);
    const v = Float32Array.from([0, 0, 0, 0, ...q0, 0.5, 0.2, 0.1, 0, 0.1, 0.1, 0.2, 0, ...q1, 0, 0, 0, 0]);
    const o = new Float32Array(4);
    sampleChannel(f32(0, 1), v, 4, 'CUBICSPLINE', true, 0.37, o, 0);
    expect(Math.hypot(...o)).toBeCloseTo(1, 5);
  });
  it('clamps to the VALUE (not tangent) outside the range', () => {
    const v = f32(9, 1, 9, 9, 5, 9);
    sampleChannel(times, v, 1, 'CUBICSPLINE', false, -1, out, 0); expect(out[0]).toBe(1);
    sampleChannel(times, v, 1, 'CUBICSPLINE', false, 9, out, 0); expect(out[0]).toBe(5);
  });
});

describe('advanceTime', () => {
  const r = { time: 0, finished: false };
  it('loops forward and backward', () => {
    expect(advanceTime(1.8, 0.5, 2, true, r).time).toBeCloseTo(0.3);
    expect(advanceTime(0.2, -0.5, 2, true, r).time).toBeCloseTo(1.7);
    expect(advanceTime(0, 7, 2, true, r).time).toBeCloseTo(1);
    expect(r.finished).toBe(false);
  });
  it('non-looping clamps and reports finished only in the direction of play', () => {
    expect(advanceTime(1.8, 0.5, 2, false, r)).toMatchObject({ time: 2, finished: true });
    expect(advanceTime(0.2, -0.5, 2, false, r)).toMatchObject({ time: 0, finished: true });
    expect(advanceTime(0, 0.5, 2, false, r)).toMatchObject({ time: 0.5, finished: false });
  });
  it('zero-duration clips are safe', () => {
    expect(advanceTime(0, 1, 0, true, r)).toMatchObject({ time: 0, finished: false });
    expect(advanceTime(0, 1, 0, false, r)).toMatchObject({ time: 0, finished: true });
  });
});

// ---- clip -> pose -> ECS ----------------------------------------------------------------
function makeClip(): AnimationClip {
  const move = new AnimationChannel(1, 'translation', 'LINEAR', f32(0, 1, 2), f32(0, 0, 0, 10, 0, 0, 10, 10, 0), 3);
  const spin = new AnimationChannel(1, 'rotation', 'LINEAR', f32(0, 2), Float32Array.from([0, 0, 0, 1, ...Quat.fromAxisAngle(Quat.create(), 0, 0, 1, Math.PI)]), 4);
  return new AnimationClip('walk', [move, spin]);
}

describe('AnimationClip + Pose', () => {
  it('duration and animated nodes are derived from channels', () => {
    const c = makeClip();
    expect(c.duration).toBe(2);
    expect(Array.from(c.animatedNodes)).toEqual([1]);
  });
  it('sampling writes only channel-targeted nodes; others keep the rest pose', () => {
    const layout = new PoseLayout(3);
    const pose = new Pose(layout);
    pose.t.set([7, 7, 7], 0); // node 0 not animated
    makeClip().sample(0.5, pose);
    close(pose.t.subarray(0, 3), [7, 7, 7]);
    close(pose.t.subarray(3, 6), [5, 0, 0]);
    close(pose.r.subarray(4, 8), Quat.fromAxisAngle(Quat.create(), 0, 0, 1, Math.PI / 4));
    close(pose.s.subarray(3, 6), [1, 1, 1]);
  });
  it('keyframe hints do not change results', () => {
    const c = makeClip(), a = new Pose(new PoseLayout(3)), b = new Pose(new PoseLayout(3));
    const hints = new Int32Array(c.channels.length);
    for (let t = 0; t <= 2.1; t += 0.07) { c.sample(t, a); c.sample(t, b, hints); close(a.t, b.t); close(a.r, b.r); }
  });
  it('morph weight channels write into the flat weight array at the node offset', () => {
    const layout = new PoseLayout(3, [0, 2, 3]);
    const pose = new Pose(layout);
    const clip = new AnimationClip('m', [new AnimationChannel(2, 'weights', 'LINEAR', f32(0, 1), f32(0, 0, 0, 1, 1, 1), 3)]);
    clip.sample(0.5, pose);
    expect(layout.morphOffset[2]).toBe(2);
    close(pose.w, [0, 0, 0.5, 0.5, 0.5]);
  });
});

function ecsSetup(nodes = 3) {
  const world = new World();
  const ents = Array.from({ length: nodes }, () => entityIndex(world.create()));
  ents.forEach((e) => world.transforms.add(e));
  const layout = new PoseLayout(nodes);
  const inst = new AnimatedInstance(layout, Int32Array.from(ents), [makeClip()], new Pose(layout));
  const owner = entityIndex(world.create());
  const anim = Animator.attach(world, owner, inst, 0);
  return { world, ents, owner, anim, sys: new AnimationSystem(world), ts: new TransformSystem(world.transforms) };
}

describe('Animator + AnimationSystem', () => {
  it('does nothing until play() is called', () => {
    const { world, ents, sys } = ecsSetup();
    sys.update(0.5);
    expect(sys.activeAnimators).toBe(0);
    expect(world.transforms.positionX[ents[1]]).toBe(0);
  });

  it('play advances time, writes ECS transforms and only dirties animated nodes', () => {
    const { world, ents, anim, sys, ts } = ecsSetup();
    ts.update(); // flush the initial dirty flags
    anim.play();
    sys.update(0.5);
    expect(anim.time).toBeCloseTo(0.5);
    expect(world.transforms.positionX[ents[1]]).toBeCloseTo(5);
    ts.update();
    expect(ts.matricesUpdated).toBe(1);          // only node 1
    expect(sys.nodesWritten).toBe(1);
    expect(world.transforms.worldMatrices[ents[1] * 16 + 12]).toBeCloseTo(5);
  });

  it('pause freezes time; resume continues', () => {
    const { anim, sys } = ecsSetup();
    anim.play(); sys.update(0.5); anim.pause(); sys.update(0.5);
    expect(anim.time).toBeCloseTo(0.5);
    anim.play(); sys.update(0.25);
    expect(anim.time).toBeCloseTo(0.75);
  });

  it('stop rewinds to 0 and halts', () => {
    const { anim, sys } = ecsSetup();
    anim.play(); sys.update(1.2); anim.stop(); sys.update(1);
    expect(anim.time).toBe(0);
    expect(anim.playing).toBe(false);
  });

  it('loop wraps; non-loop finishes at the end and play() restarts', () => {
    const { anim, sys } = ecsSetup();
    anim.play(); sys.update(2.5);
    expect(anim.time).toBeCloseTo(0.5);
    expect(anim.playing).toBe(true);
    anim.setLoop(false).stop().play(); sys.update(3);
    expect(anim.time).toBeCloseTo(2);
    expect(anim.finished).toBe(true);
    expect(anim.playing).toBe(false);
    anim.play();
    expect(anim.time).toBe(0);
    expect(anim.playing).toBe(true);
  });

  it('speed scales, negative speed plays backwards', () => {
    const { anim, sys } = ecsSetup();
    anim.setSpeed(2).play(); sys.update(0.25);
    expect(anim.time).toBeCloseTo(0.5);
    anim.setSpeed(-1); sys.update(0.25);
    expect(anim.time).toBeCloseTo(0.25);
  });

  it('time can be set directly and is applied on the next update', () => {
    const { world, ents, anim, sys } = ecsSetup();
    anim.play(); anim.time = 1; sys.update(0);
    expect(world.transforms.positionX[ents[1]]).toBeCloseTo(10);
  });

  it('play(name) selects clips and rejects unknown ones', () => {
    const { anim } = ecsSetup();
    expect(() => anim.play('nope')).toThrow();
    anim.play('walk');
    expect(anim.playing).toBe(true);
  });

  it('many animators advance independently', () => {
    const world = new World();
    const layout = new PoseLayout(2);
    const sys = new AnimationSystem(world);
    const animators: Animator[] = [];
    for (let i = 0; i < 50; i++) {
      const a = entityIndex(world.create()), b = entityIndex(world.create());
      world.transforms.add(a); world.transforms.add(b);
      const inst = new AnimatedInstance(layout, Int32Array.from([a, b]), [makeClip()], new Pose(layout));
      animators.push(Animator.attach(world, entityIndex(world.create()), inst, 0).setSpeed(1 + i * 0.01).play());
    }
    sys.update(0.5);
    expect(sys.activeAnimators).toBe(50);
    expect(animators[49].time).toBeCloseTo(0.5 * 1.49);
    expect(animators[0].time).toBeCloseTo(0.5);
  });
});

describe('end to end: glTF animation + morph rest pose', () => {
  async function asset() {
    const b = new GLBBuilder();
    const prim = addTriangle(b);
    prim.targets = [{ POSITION: b.accessor(new Float32Array(9), 'VEC3') }, { POSITION: b.accessor(new Float32Array(9), 'VEC3') }];
    const n = b.node({ mesh: b.mesh({ primitives: [prim], weights: [0.1, 0.9] }), translation: [1, 2, 3] });
    b.addToScene(n);
    const input = b.accessor(new Float32Array([0, 1]), 'SCALAR');
    const out = b.accessor(new Float32Array([0, 0, 0, 10, 0, 0]), 'VEC3');
    const wout = b.accessor(new Float32Array([0, 1, 1, 0]), 'SCALAR');
    b.json.animations = [{
      name: 'clip',
      samplers: [{ input, output: out }, { input, output: wout }],
      channels: [{ sampler: 0, target: { node: n, path: 'translation' } }, { sampler: 1, target: { node: n, path: 'weights' } }],
    }];
    return loadGLTF(b.glb());
  }
  it('rest pose uses node/mesh defaults; clip drives translation and morph weights', async () => {
    const a = await asset();
    const layout = PoseLayout.fromAsset(a);
    const rest = Pose.rest(a, layout);
    close(rest.t, [1, 2, 3]);
    close(rest.w, [0.1, 0.9]);
    const pose = rest.clone();
    AnimationClip.fromData(a.animations[0]).sample(0.5, pose);
    close(pose.t, [5, 0, 0]);
    close(pose.w, [0.5, 0.5]);
  });
});

describe('AnimationSystem only writes animated properties', () => {
  it('a weights-only clip does not dirty the node transform; a rotation-only clip does not touch translation/scale', () => {
    const world = new World();
    const e = entityIndex(world.create());
    world.transforms.add(e, 5, 6, 7);
    world.transforms.setScale(e, 2, 2, 2);
    world.morphs.add(e, 2);
    const layout = new PoseLayout(1, [2]);
    const weightsClip = new AnimationClip('w', [new AnimationChannel(0, 'weights', 'LINEAR', f32(0, 1), f32(0, 0, 1, 1), 2)]);
    const rotClip = new AnimationClip('r', [new AnimationChannel(0, 'rotation', 'LINEAR', f32(0, 1), Float32Array.from([0, 0, 0, 1, ...Quat.fromAxisAngle(Quat.create(), 0, 0, 1, 1)]), 4)]);
    expect(Array.from(weightsClip.nodeMask)).toEqual([8]);
    expect(Array.from(rotClip.nodeMask)).toEqual([2]);

    const ts = new TransformSystem(world.transforms), sys = new AnimationSystem(world);
    const owner = entityIndex(world.create());
    const inst = new AnimatedInstance(layout, Int32Array.from([e]), [weightsClip, rotClip], new Pose(layout));
    const anim = Animator.attach(world, owner, inst, 0).play();
    ts.update();
    sys.update(0.5);
    ts.update();
    expect(ts.matricesUpdated).toBe(0);                                  // morph-only animation: transform untouched
    expect(world.morphs.weights[world.morphs.weightOffset[e]]).toBeCloseTo(0.5);

    anim.play(1);
    sys.update(0.5);
    expect(world.transforms.positionX[e]).toBe(5);                       // translation left alone
    expect(world.transforms.scaleX[e]).toBe(2);                          // scale left alone
    expect(world.transforms.rotationZ[e]).toBeGreaterThan(0.1);          // rotation driven
  });
});
