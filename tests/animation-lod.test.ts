import { describe, expect, it } from 'vitest';
import { World } from '../src/ecs/World';
import { entityIndex } from '../src/ecs/Entity';
import { AnimationSystem } from '../src/ecs/systems/AnimationSystem';
import { AnimationLODSystem } from '../src/ecs/systems/AnimationLODSystem';
import { TransformSystem } from '../src/ecs/systems/TransformSystem';
import { AnimatedInstance } from '../src/animation/Animator';
import { AnimationClip, AnimationChannel } from '../src/animation/AnimationClip';
import { AnimatorFlags } from '../src/ecs/components/AnimatorStore';
import { Pose, PoseLayout } from '../src/animation/Pose';

const f32 = (...v: number[]) => Float32Array.from(v);

/** A one-node rig whose entity slides along +X by 10 units over 10 seconds (a looping, linear clip). */
function walker(world: World, x: number) {
  const t = world.transforms, e = entityIndex(world.create());
  t.add(e, x, 0, 0);
  const layout = new PoseLayout(1, [0], [-1]), rest = new Pose(layout);
  const clip = new AnimationClip('slide', [new AnimationChannel(0, 'translation', 'LINEAR', f32(0, 10), f32(0, 0, 0, 10, 0, 0), 3)]);
  const inst = new AnimatedInstance(layout, Int32Array.from([e]), [clip], rest);
  world.animators.add(e, inst, 0);
  world.animators.flags[e] |= AnimatorFlags.Playing;
  return e;
}

describe('animation update stride', () => {
  it('a stride of n evaluates every n-th frame with the accumulated time, so playback speed is exact', () => {
    const world = new World(), sys = new AnimationSystem(world), e = walker(world, 0);
    world.animators.stride[e] = 4;
    let evaluations = 0, last = world.animators.sampledTime[e];
    for (let frame = 0; frame < 40; frame++) {
      sys.update(0.1);
      if (world.animators.sampledTime[e] !== last) { evaluations++; last = world.animators.sampledTime[e]; }
    }
    expect(evaluations).toBe(10);   // 40 frames / stride 4
    expect(world.animators.time[e] + world.animators.pending[e]).toBeCloseTo(4, 4);   // 40 frames x 0.1 s: evaluated time plus the not yet applied remainder
  });

  it('time advances by the full elapsed time even though evaluations are sparse', () => {
    const world = new World(), sys = new AnimationSystem(world), e = walker(world, 0);
    world.animators.stride[e] = 5;
    for (let frame = 0; frame < 50; frame++) sys.update(0.1);
    // 50 frames x 0.1 s = 5 s; the last evaluation may lag by up to stride-1 frames
    expect(world.animators.time[e] + world.animators.pending[e]).toBeCloseTo(5, 4);
    expect(world.animators.time[e]).toBeGreaterThan(5 - 0.5 - 1e-4);
  });

  it('staggers entities so a crowd does not evaluate on the same frame', () => {
    const world = new World(), sys = new AnimationSystem(world);
    const ids = Array.from({ length: 8 }, (_, k) => walker(world, k));
    for (const e of ids) world.animators.stride[e] = 4;
    const perFrame: number[] = [];
    for (let frame = 0; frame < 8; frame++) { sys.update(0.1); perFrame.push(sys.activeAnimators - sys.skippedAnimators); }
    expect(Math.max(...perFrame)).toBeLessThanOrEqual(3);   // ~2 of 8 per frame, not 8 at once
    expect(perFrame.reduce((a, b) => a + b, 0)).toBe(16);    // each of the 8 entities evaluated twice in 8 frames
  });

  it('returning to stride 1 flushes the pending time', () => {
    const world = new World(), sys = new AnimationSystem(world), e = walker(world, 0);
    world.animators.stride[e] = 8;
    for (let frame = 0; frame < 3; frame++) sys.update(0.1);
    const before = world.animators.time[e] + world.animators.pending[e];
    world.animators.stride[e] = 1;
    sys.update(0.1);
    expect(world.animators.pending[e]).toBe(0);
    expect(world.animators.time[e]).toBeCloseTo(before + 0.1, 5);
  });
});

describe('AnimationLODSystem', () => {
  it('assigns strides from the distance to the camera', () => {
    const world = new World(), lod = new AnimationLODSystem(world), ts = new TransformSystem(world.transforms);
    const near = walker(world, 5), mid = walker(world, 40), far = walker(world, 90), veryFar = walker(world, 400);
    ts.update();
    lod.update(0, 0, 0);
    const s = world.animators.stride;
    expect([s[near], s[mid], s[far], s[veryFar]]).toEqual([1, 2, 4, 8]);
    expect(lod.bandCounts).toEqual([1, 1, 1, 1]);
  });

  it('moves entities between bands as the camera moves, and reset() restores every-frame updates', () => {
    const world = new World(), lod = new AnimationLODSystem(world, { distances: [10], strides: [1, 3] }), ts = new TransformSystem(world.transforms);
    const e = walker(world, 0);
    ts.update();
    lod.update(0, 0, 50);
    expect(world.animators.stride[e]).toBe(3);
    lod.update(0, 0, 2);
    expect(world.animators.stride[e]).toBe(1);
    lod.update(0, 0, 50);
    lod.reset();
    expect(world.animators.stride[e]).toBe(0);
  });

  it('rejects malformed bands', () => {
    const world = new World();
    expect(() => new AnimationLODSystem(world, { distances: [10, 20], strides: [1, 2] })).toThrow(RangeError);
    expect(() => new AnimationLODSystem(world, { distances: [20, 10], strides: [1, 2, 4] })).toThrow(RangeError);
    expect(() => new AnimationLODSystem(world, { distances: [10], strides: [1, 0] })).toThrow(RangeError);
    expect(() => new AnimationLODSystem(world, { distances: [10], strides: [1, 2.5] })).toThrow(RangeError);
  });
});
