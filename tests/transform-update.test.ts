import { describe, expect, it } from 'vitest';
import { World } from '../src/ecs/World';
import { entityIndex } from '../src/ecs/Entity';
import { TransformSystem } from '../src/ecs/systems/TransformSystem';
import { AnimationSystem } from '../src/ecs/systems/AnimationSystem';
import { AnimatedInstance } from '../src/animation/Animator';
import { Animator } from '../src/animation/AnimatorHandle';
import { AnimationClip, AnimationChannel } from '../src/animation/AnimationClip';
import { Pose, PoseLayout } from '../src/animation/Pose';
import { Mat4 } from '../src/math/Mat4';

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** Reference: world = parentWorld * compose(local), computed recursively with the generic 4x4 product. */
function referenceWorld(w: World, i: number, cache: Map<number, Float32Array>): Float32Array {
  const hit = cache.get(i);
  if (hit) return hit;
  const t = w.transforms;
  const local = Mat4.compose(Mat4.create(), t.positionX[i], t.positionY[i], t.positionZ[i], t.rotationX[i], t.rotationY[i], t.rotationZ[i], t.rotationW[i], t.scaleX[i], t.scaleY[i], t.scaleZ[i]);
  const p = t.parent[i];
  const out = p === -1 ? local : Mat4.multiply(Mat4.create(), referenceWorld(w, p, cache), local);
  cache.set(i, out as Float32Array);
  return out as Float32Array;
}

describe('TransformSystem (depth-ordered, fused parent multiply)', () => {
  it('matches the generic reference for random forests and random dirty subsets, over several updates', () => {
    const r = rng(42);
    const w = new World(), t = w.transforms, ts = new TransformSystem(t);
    const n = 600, idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const e = entityIndex(w.create());
      t.add(e, r() * 10 - 5, r() * 10 - 5, r() * 10 - 5);
      const q = [r() - 0.5, r() - 0.5, r() - 0.5, r() + 0.1];
      t.setRotation(e, q[0], q[1], q[2], q[3]);
      t.setScale(e, 0.5 + r(), 0.5 + r(), 0.5 + r());
      if (i > 0 && r() < 0.9) t.setParent(e, idx[Math.floor(r() * Math.min(i, 40)) + Math.max(0, i - 40)]);   // mostly deep chains
      idx.push(e);
    }
    for (let round = 0; round < 6; round++) {
      for (let k = 0; k < 80; k++) {
        const e = idx[Math.floor(r() * n)];
        if (r() < 0.5) t.setPosition(e, r() * 4, r() * 4, r() * 4); else t.setScale(e, 0.5 + r(), 1, 1);
      }
      ts.update();
      const cache = new Map<number, Float32Array>();
      for (const e of idx) {
        const ref = referenceWorld(w, e, cache);
        for (let k = 0; k < 16; k++) expect(t.worldMatrices[e * 16 + k]).toBeCloseTo(ref[k], 3);
      }
    }
  });

  it('computes each matrix once per update (a dirty descendant is covered by its dirty ancestor)', () => {
    const w = new World(), t = w.transforms, ts = new TransformSystem(t);
    const chain = Array.from({ length: 50 }, () => entityIndex(w.create()));
    chain.forEach((e, i) => { t.add(e, 0, 1, 0); if (i > 0) t.setParent(e, chain[i - 1]); });
    ts.update();
    for (const e of [...chain].reverse()) t.setPosition(e, 0, 2, 0);   // deepest first: ordering must still start at the top
    ts.update();
    expect(ts.matricesUpdated).toBe(50);
    expect(t.worldMatrices[chain[49] * 16 + 13]).toBeCloseTo(100, 4);
  });
});

describe('Animator writes nothing when it is still at the same time', () => {
  function setup(speed: number) {
    const w = new World(), t = w.transforms;
    const layout = new PoseLayout(2, undefined, [-1, 0]);
    const rest = new Pose(layout);
    const nodes = [entityIndex(w.create()), entityIndex(w.create())];
    nodes.forEach((e, i) => { t.add(e); if (i > 0) t.setParent(e, nodes[0]); });
    const clip = new AnimationClip('c', [new AnimationChannel(1, 'translation', 'LINEAR', Float32Array.from([0, 1]), Float32Array.from([0, 0, 0, 2, 0, 0]), 3)]);
    const inst = new AnimatedInstance(layout, Int32Array.from(nodes), [clip], rest);
    const root = entityIndex(w.create());
    t.add(root);
    Animator.attach(w, root, inst, 0).setSpeed(speed).play();
    const ts = new TransformSystem(t), sys = new AnimationSystem(w);
    ts.update();
    return { w, t, nodes, ts, sys };
  }

  it('speed 0: written once, then the pose is left alone', () => {
    const s = setup(0);
    s.sys.update(0.5); s.ts.update();
    expect(s.sys.nodesWritten).toBe(1);
    expect(s.ts.matricesUpdated).toBe(1);
    s.sys.update(0.5); s.ts.update();
    expect(s.sys.nodesWritten).toBe(0);
    expect(s.ts.matricesUpdated).toBe(0);
  });

  it('a playing animator keeps writing every frame, and seeking resamples', () => {
    const s = setup(1);
    s.sys.update(0.25); s.ts.update();
    expect(s.sys.nodesWritten).toBe(1);
    s.sys.update(0.25); s.ts.update();
    expect(s.sys.nodesWritten).toBe(1);
    expect(s.t.positionX[s.nodes[1]]).toBeCloseTo(1);
  });
});
