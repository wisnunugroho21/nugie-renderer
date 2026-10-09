import { World } from '../src/ecs/World';
import { entityIndex } from '../src/ecs/Entity';
import { TransformSystem } from '../src/ecs/systems/TransformSystem';
import { AnimationSystem } from '../src/ecs/systems/AnimationSystem';
import { SkeletonSystem } from '../src/ecs/systems/SkeletonSystem';
import { AnimatedInstance } from '../src/animation/Animator';
import { Animator } from '../src/animation/AnimatorHandle';
import { AnimationClip, AnimationChannel } from '../src/animation/AnimationClip';
import { Pose, PoseLayout } from '../src/animation/Pose';
import { SkeletonAsset, SkeletonInstance } from '../src/animation/Skeleton';
import { AnimationController } from '../src/animation/graph/AnimationController';
import { AnimationParams } from '../src/animation/graph/AnimationParams';
import { StateMachine } from '../src/animation/graph/StateMachine';
import { ClipMotion } from '../src/animation/graph/Motion';
import type { JointMatrixBuffer } from '../src/rendering/JointMatrixBuffer';

/**
 * CPU cost of animating a crowd of skinned characters, per frame and per phase (no GPU): clip sampling + writing the pose into the
 * ECS (AnimationSystem), the transform hierarchy (TransformSystem) and the skinning matrices (SkeletonSystem).
 * Run with `npm run bench:anim`. Options: `--joints=64 --chars=200`.
 */
declare const process: { argv: string[] };   // no @types/node in this project
const arg = (name: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? d);
const KEYS = 61;   // 2 s at 30 Hz

/** Stand-in for the GPU joint buffer: a plain growing Float32Array. */
class FakeJoints {
  cpu = new Float32Array(12 * 4096);
  private used = 1;
  private dirty = 0;
  /** Matrices marked for upload since the last call. */
  dirtyCount(): number { const d = this.dirty; this.dirty = 0; return d; }
  allocate(n: number): number {
    const o = this.used; this.used += n;
    if (this.used * 12 > this.cpu.length) { const c = new Float32Array(Math.max(this.cpu.length * 2, this.used * 12)); c.set(this.cpu); this.cpu = c; }
    return o;
  }
  release(): void {}
  markDirty(_offset: number, count: number): void { this.dirty += count; }
}

/** Parent of joint i in a skeleton of chains of 8 joints hanging off the root. */
const parentOf = (i: number) => (i === 0 ? -1 : i % 8 === 0 ? 0 : i - 1);

function makeClip(J: number, seed: number): AnimationClip {
  const times = new Float32Array(KEYS).map((_, k) => k / 30);
  const channels: AnimationChannel[] = [];
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let j = 0; j < J; j++) {
    const rot = new Float32Array(KEYS * 4);
    const ax = rnd() * 0.4, ay = rnd() * 0.4, ph = rnd() * 6;
    for (let k = 0; k < KEYS; k++) {
      const a = 0.3 * Math.sin(k * 0.21 + ph) / 2, c = Math.cos(a), sn = Math.sin(a);
      const l = Math.hypot(ax, ay, 1);
      rot.set([ax / l * sn, ay / l * sn, 1 / l * sn, c], k * 4);
    }
    channels.push(new AnimationChannel(j, 'rotation', 'LINEAR', times, rot, 4));
  }
  const trans = new Float32Array(KEYS * 3);
  for (let k = 0; k < KEYS; k++) trans.set([0, Math.sin(k * 0.2) * 0.05, 0], k * 3);
  channels.push(new AnimationChannel(0, 'translation', 'LINEAR', times, trans, 3));
  return new AnimationClip('walk', channels);
}

interface Crowd { joints: FakeJoints; roots: number[]; world: World; ts: TransformSystem; anim: AnimationSystem; skel: SkeletonSystem; clip: AnimationClip; layout: PoseLayout; rest: Pose; }

function buildCrowd(N: number, J: number, mode: 'animator' | 'controller' | 'paused' | 'moving'): Crowd {
  const world = new World(), t = world.transforms;
  const layout = new PoseLayout(J, undefined, Array.from({ length: J }, (_, i) => parentOf(i)));
  const rest = new Pose(layout);
  for (let j = 0; j < J; j++) if (j > 0) rest.t.set([0, 0.1, 0], j * 3);
  const clip = makeClip(J, 7);
  const ibm = new Float32Array(J * 16);
  for (let j = 0; j < J; j++) { ibm[j * 16] = ibm[j * 16 + 5] = ibm[j * 16 + 10] = ibm[j * 16 + 15] = 1; ibm[j * 16 + 13] = -0.1 * j; }
  const asset = new SkeletonAsset('rig', Int32Array.from({ length: J }, (_, i) => i), ibm, Int32Array.from({ length: J }, (_, i) => parentOf(i)));
  const joints = new FakeJoints();
  const ts = new TransformSystem(t), anim = new AnimationSystem(world), skel = new SkeletonSystem(world, joints as unknown as JointMatrixBuffer);
  const side = Math.ceil(Math.sqrt(N));
  const roots: number[] = [];
  for (let n = 0; n < N; n++) {
    const root = entityIndex(world.create());
    roots.push(root);
    t.add(root, (n % side) * 2, 0, Math.floor(n / side) * 2);
    const nodes = Array.from({ length: J }, () => entityIndex(world.create()));
    nodes.forEach((e, j) => { t.add(e, rest.t[j * 3], rest.t[j * 3 + 1], rest.t[j * 3 + 2]); t.setParent(e, parentOf(j) < 0 ? root : nodes[parentOf(j)]); });
    const mesh = entityIndex(world.create());
    t.add(mesh); t.setParent(mesh, root);
    world.skins.add(mesh, new SkeletonInstance(asset, mesh, Int32Array.from(nodes)));
    const inst = new AnimatedInstance(layout, Int32Array.from(nodes), [clip], rest);
    if (mode === 'animator' || mode === 'paused') {
      const a = Animator.attach(world, root, inst, 0); a.time = (n * 0.137) % clip.duration; a.setLoop(true).setSpeed(mode === 'paused' ? 0 : 1).play();
    } else if (mode === 'moving') {
      // a posed character that is only translated as a whole (moving platform, root motion done elsewhere)
    } else {
      const sm = new StateMachine(layout, rest, [{ name: 'walk', motion: new ClipMotion(clip) }], [], 0);
      const c = new AnimationController(layout, rest, new AnimationParams(), [{ name: 'base', stateMachine: sm }], 0);
      c.refreshAnimatedNodes();
      world.controllers.add(root, inst, c);
    }
  }
  ts.update();
  skel.update(ts.updated);
  return { joints, roots, world, ts, anim, skel, clip, layout, rest };
}

function run(label: string, N: number, J: number, mode: 'animator' | 'controller' | 'paused' | 'moving'): void {
  const c = buildCrowd(N, J, mode);
  const frames = 60, dt = 1 / 60;
  const t = c.world.transforms;
  const move = () => { if (mode === 'moving') for (const r of c.roots) t.setPosition(r, t.positionX[r] + 0.01, 0, t.positionZ[r]); };
  for (let i = 0; i < 10; i++) { move(); c.anim.update(dt); c.ts.update(); c.skel.update(c.ts.updated); }
  let a = 0, x = 0, k = 0, upload = 0;
  c.joints.dirtyCount();   // forget the allocation / warm-up uploads
  for (let f = 0; f < frames; f++) {
    move();
    const t0 = performance.now(); c.anim.update(dt);
    const t1 = performance.now(); c.ts.update();
    const t2 = performance.now(); c.skel.update(c.ts.updated);
    const t3 = performance.now();
    a += t1 - t0; x += t2 - t1; k += t3 - t2;
    upload += c.joints.dirtyCount();
  }
  a /= frames; x /= frames; k /= frames;
  const total = a + x + k, joints = N * J;
  console.log(`${label.padEnd(30)} ${String(N).padStart(5)} x ${String(J).padStart(3)}  anim ${a.toFixed(3).padStart(7)}  xform ${x.toFixed(3).padStart(7)}  skeleton ${k.toFixed(3).padStart(7)}  total ${total.toFixed(3).padStart(7)} ms   ${(total * 1e6 / joints).toFixed(0).padStart(5)} ns/joint   (${c.anim.nodesWritten} nodes written, ${c.ts.matricesUpdated} matrices, ${c.skel.updatedJoints} skin joints, ${(upload / frames * 48 / 1024).toFixed(0)} KB uploaded/frame)`);
}

console.log('\n== Animation CPU cost per frame (ms): clip sampling + ECS writes / transform hierarchy / skinning matrices ==');
const J = arg('joints', 64), N = arg('chars', 200);
for (const mode of ['animator', 'controller'] as const) {
  run(`${mode}`, N, J, mode);
  run(`${mode}`, N * 5, J, mode);
  run(`${mode}`, N, 24, mode);
}
run('animator, speed 0', N, J, 'paused');
run('posed, moved as a whole', N, J, 'moving');

// micro: sampling alone (no ECS), to separate sampling cost from the write-back
{
  const clip = makeClip(J, 7), layout = new PoseLayout(J, undefined, Array.from({ length: J }, (_, i) => parentOf(i))), pose = new Pose(layout), hints = new Int32Array(clip.channels.length);
  const reps = 20000;
  for (let i = 0; i < 2000; i++) clip.sample((i % 100) / 60, pose, hints);
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) clip.sample((i % 100) / 60, pose, hints);
  const ms = (performance.now() - t0) / reps;
  console.log(`\nclip.sample, ${J} rotation channels + 1 translation: ${(ms * 1000).toFixed(2)} us (${(ms * 1e6 / (J + 1)).toFixed(0)} ns/channel)`);
}
