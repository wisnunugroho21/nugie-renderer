import { bench, report } from './harness';
import { World } from '../src/ecs/World';
import { entityIndex } from '../src/ecs/Entity';
import { TransformSystem } from '../src/ecs/systems/TransformSystem';

function forest() {
  const w = new World();
  const idx: number[] = [];
  for (let i = 0; i < 10000; i++) { const e = entityIndex(w.create()); w.transforms.add(e, i, 0, 0); idx.push(e); }
  for (let r = 0; r < 100; r++) for (let c = 1; c < 100; c++) w.transforms.setParent(idx[r * 100 + c], idx[r * 100]);
  const sys = new TransformSystem(w.transforms);
  sys.update();
  return { w, idx, sys };
}

// Benchmark: 10,000 entities, 100 dirty transforms. Baseline is listed last.
{
  const a = forest();
  const dirty = bench('dirty-only update (100 leaves)', () => {
    for (let r = 0; r < 100; r++) a.w.transforms.setPosition(a.idx[r * 100 + 50], Math.random(), 0, 0);
    a.sys.update();
  });
  const b = forest();
  const full = bench('baseline: recompute all 10,000', () => {
    for (let i = 0; i < 10000; i++) b.w.transforms.setPosition(b.idx[i], Math.random(), 0, 0);
    b.sys.update();
  });
  report('Transform update (10,000 entities / 100 dirty)', [dirty, full]);
}

// Benchmark B (CPU part): visibility over 100,000 objects.
import { RenderWorld } from '../src/rendering/RenderWorld';
import { FrustumCuller } from '../src/visibility/FrustumCuller';
import { VisibilitySystem } from '../src/visibility/VisibilitySystem';
import { Mat4 } from '../src/math/Mat4';
import { RenderFlags } from '../src/ecs/components/MeshRendererStore';
{
  const N = 100000;
  let seed = 99; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const makeWorld = (staticFlag: number) => {
    const rw = new RenderWorld(); rw.ensureCapacity(N); rw.count = N;
    for (let i = 0; i < N; i++) {
      const cx = (rnd() - 0.5) * 1000, cy = (rnd() - 0.5) * 1000, cz = (rnd() - 0.5) * 1000, h = 0.3 + rnd();
      rw.boundsAABB.set([cx - h, cy - h, cz - h, cx + h, cy + h, cz + h], i * 6);
      rw.boundsSphere.set([cx, cy, cz, h * 1.732], i * 4);
      rw.flags[i] = staticFlag;
    }
    const view = Mat4.lookAt(Mat4.create(), 0, 0, 700, 0, 0, 0);
    const proj = Mat4.perspective(Mat4.create(), 0.6, 16 / 9, 0.1, 400);
    rw.camera.frustum.setFromViewProjection(Mat4.multiply(Mat4.create(), proj, view));
    return rw;
  };
  const rw = makeWorld(RenderFlags.Static);
  const lin = new FrustumCuller();
  const vis = new VisibilitySystem(); vis.mode = 'bvh';
  vis.update(rw); // build once (static scene: rebuild cost is not per frame)
  lin.cull(rw, rw.camera.frustum, 'sphere');
  const visibleCount = lin.count;
  const rBvh = bench('BVH (static scene)', () => { vis.update(rw); });
  const rSph = bench('linear, bounding sphere', () => { lin.cull(rw, rw.camera.frustum, 'sphere'); });
  const rAabb = bench('linear, AABB', () => { lin.cull(rw, rw.camera.frustum, 'aabb'); });
  const none = bench('no culling (pass all objects on)', () => { vis.mode = 'none'; vis.update(rw); vis.mode = 'bvh'; });
  report(`Benchmark B (CPU): ${N} objects, ~${visibleCount} visible (${((visibleCount / N) * 100).toFixed(1)}%)`, [rBvh, rSph, rAabb, none], 1);
  const t0 = performance.now(); const fresh = new VisibilitySystem(); fresh.mode = 'bvh'; fresh.update(rw);
  console.log(`  BVH build (100k, one-off): ${(performance.now() - t0).toFixed(1)} ms, ${fresh.bvhNodes} nodes`);
}

// Motion matching: brute-force search cost vs database size (decides whether an acceleration structure is justified).
import { AnimationClip, AnimationChannel } from '../src/animation/AnimationClip';
import { Pose, PoseLayout } from '../src/animation/Pose';
import { MotionDatabase } from '../src/animation/motionmatching/MotionDatabase';
import { MotionMatcher } from '../src/animation/motionmatching/MotionMatcher';
{
  const layout = new PoseLayout(3, undefined, [-1, 0, 0]);
  const rest = new Pose(layout); rest.t.set([-0.15, 0, 0], 3); rest.t.set([0.15, 0, 0], 6);
  let seed = 3; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const randomClip = (i: number): AnimationClip => {
    const K = 301, times = new Float32Array(K), rt = new Float32Array(K * 3), rr = new Float32Array(K * 4), fl = new Float32Array(K * 3), fr = new Float32Array(K * 3);
    const vx = (rnd() - 0.5) * 4, vz = rnd() * 4, yaw = (rnd() - 0.5) * 2, ph = rnd() * 6, hz = 1 + rnd() * 2;
    for (let k = 0; k < K; k++) {
      const t = k / 30; times[k] = t;
      rt.set([vx * t, 0, vz * t], k * 3); const h = yaw * t; rr.set([0, Math.sin(h / 2), 0, Math.cos(h / 2)], k * 4);
      const s = Math.sin(2 * Math.PI * hz * t + ph), c = Math.cos(2 * Math.PI * hz * t + ph);
      fl.set([-0.15, Math.max(0, c) * 0.15, 0.3 * s], k * 3); fr.set([0.15, Math.max(0, -c) * 0.15, -0.3 * s], k * 3);
    }
    return new AnimationClip('c' + i, [new AnimationChannel(0, 'translation', 'LINEAR', times, rt, 3), new AnimationChannel(0, 'rotation', 'LINEAR', times, rr, 4),
      new AnimationChannel(1, 'translation', 'LINEAR', times, fl, 3), new AnimationChannel(2, 'translation', 'LINEAR', times, fr, 3)]);
  };
  const results = [];
  for (const nClips of [20, 100, 400]) {
    const clips = Array.from({ length: nClips }, (_, i) => ({ clip: randomClip(i), loop: true }));
    const t0 = performance.now();
    const db = MotionDatabase.build(layout, rest, clips, { rootNode: 0, featureJoints: [1, 2], footJoints: [1, 2] });
    const buildMs = performance.now() - t0;
    const m = new MotionMatcher(db);
    m.buildQuery({ vx: 0.5, vz: 2, yawRate: 0.2 }, 10);
    const r = bench(`search ${db.frameCount} frames x ${db.dim} dims (build ${buildMs.toFixed(0)} ms)`, () => { m.search(); }, 300);
    results.push(r);
  }
  report('Motion matching brute-force search', results, 0);
}
