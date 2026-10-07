import { describe, expect, it } from 'vitest';
import { makeFakeGPU } from './helpers/fakeGPU';
import { GLBBuilder, addTriangle } from './helpers/glbBuilder';
import { loadGLTF } from '../src/assets/gltf/GLTFLoader';
import { instantiateGLTF } from '../src/assets/gltf/GLTFInstantiator';
import { SkeletonAsset, SkeletonInstance } from '../src/animation/Skeleton';
import { SkeletonSystem } from '../src/ecs/systems/SkeletonSystem';
import { TransformSystem } from '../src/ecs/systems/TransformSystem';
import { BoundsSystem } from '../src/ecs/systems/BoundsSystem';
import { RenderExtractor } from '../src/rendering/RenderExtractor';
import { RenderWorld } from '../src/rendering/RenderWorld';
import { packSkinData, DeformMask } from '../src/rendering/MeshManager';
import { entityIndex } from '../src/ecs/Entity';
import { Mat4 } from '../src/math/Mat4';
import { Quat } from '../src/math/Quat';
import { bitsToFloat } from '../src/rendering/MorphPacking';
import { STANDARD_VERTEX_FLOATS as F } from '../src/rendering/VertexLayouts';

const close = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-4) => { for (let i = 0; i < b.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(eps); };

describe('skin data packing', () => {
  const unpack = (p: Uint32Array, v: number) => ({
    joints: [p[v * 4] & 0xffff, p[v * 4] >>> 16, p[v * 4 + 1] & 0xffff, p[v * 4 + 1] >>> 16],
    weights: [p[v * 4 + 2] & 0xffff, p[v * 4 + 2] >>> 16, p[v * 4 + 3] & 0xffff, p[v * 4 + 3] >>> 16].map((w) => w / 65535),
  });
  it('round-trips joints and weights; quantized weights sum to exactly 1', () => {
    const joints = Uint16Array.from([3, 70, 65535, 0, 1, 2, 3, 4]);
    const weights = Float32Array.from([0.5, 0.25, 0.125, 0.125, 1 / 3, 1 / 3, 1 / 3, 0]);
    const p = packSkinData(joints, weights);
    const a = unpack(p, 0), b = unpack(p, 1);
    expect(a.joints).toEqual([3, 70, 65535, 0]);
    close(a.weights, [0.5, 0.25, 0.125, 0.125], 2e-5);
    expect(b.joints).toEqual([1, 2, 3, 4]);
    for (const u of [a, b]) expect(u.weights.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
  });
});

describe('SkeletonAsset', () => {
  it('parent indices skip non-joint ancestors', async () => {
    const b = new GLBBuilder();
    const j2 = b.node({ name: 'j2' });
    const mid = b.node({ name: 'not-a-joint', children: [j2] });
    const j1 = b.node({ name: 'j1', children: [mid] });
    const j0 = b.node({ name: 'j0', children: [j1] });
    b.json.skins = [{ joints: [j0, j1, j2] }];
    b.addToScene(j0);
    const a = await loadGLTF(b.glb());
    const sk = SkeletonAsset.fromSkin(a.skins[0], a);
    expect(Array.from(sk.parent)).toEqual([-1, 0, 1]);
    expect(sk.jointCount).toBe(3);
  });
  it('validates inverse bind matrix size', () => {
    expect(() => new SkeletonAsset('x', Int32Array.from([0, 1]), new Float32Array(16), Int32Array.from([-1, 0]))).toThrow();
  });
});

/** ECS rig: owner mesh node (arbitrary transform) + 3-joint chain, IBM = inverse(jointWorld at bind). */
function rig(ownerPose: { p: number[]; s: number; yaw: number }) {
  const g = makeFakeGPU();
  const w = g.world, t = w.transforms;
  const ts = new TransformSystem(t), sk = new SkeletonSystem(w, g.joints);
  const owner = entityIndex(w.create());
  t.add(owner, ownerPose.p[0], ownerPose.p[1], ownerPose.p[2]);
  const q = Quat.fromAxisAngle(Quat.create(), 0, 1, 0, ownerPose.yaw);
  t.setRotation(owner, q[0], q[1], q[2], q[3]); t.setScale(owner, ownerPose.s, ownerPose.s, ownerPose.s);
  const joints = [0, 1, 2].map(() => entityIndex(w.create()));
  joints.forEach((j, i) => { t.add(j, 0, i === 0 ? 0 : 1, 0); if (i > 0) t.setParent(j, joints[i - 1]); }); // chain along +Y
  ts.update();
  // glTF IBM: inverse of the joint WORLD matrix at bind time
  const ibm = new Float32Array(48);
  joints.forEach((j, i) => {
    const inv = Mat4.invert(Mat4.create(), t.worldMatrices.subarray(j * 16, j * 16 + 16))!;
    ibm.set(inv, i * 16);
  });
  const skeleton = new SkeletonAsset('rig', Int32Array.from([0, 1, 2]), ibm, Int32Array.from([-1, 0, 1]));
  const inst = new SkeletonInstance(skeleton, owner, Int32Array.from(joints));
  w.skins.add(owner, inst);
  ts.update(); sk.update(ts.updated);
  return { g, w, t, ts, sk, owner, joints, inst };
}

describe('joint matrix convention: inverse(ownerWorld) * jointWorld * inverseBind', () => {
  const ownerPoses = [
    { p: [0, 0, 0], s: 1, yaw: 0 },
    { p: [5, -2, 3], s: 2, yaw: 0.9 },
    { p: [-10, 4, 1], s: 0.25, yaw: -2.1 },
  ];
  for (const pose of ownerPoses) {
    it(`bind pose: ownerWorld * jointMatrix == identity (owner at ${JSON.stringify(pose)})`, () => {
      const { t, g, owner, inst } = rig(pose);
      for (let j = 0; j < 3; j++) {
        const jm = g.joints.cpu.subarray((inst.jointOffset + j) * 16, (inst.jointOffset + j) * 16 + 16);
        const fin = Mat4.multiply(Mat4.create(), t.worldMatrices.subarray(owner * 16, owner * 16 + 16) as unknown as number[], jm as unknown as number[]);
        close(fin, Mat4.create(), 1e-4);
      }
    });
  }

  it('after bending, final = jointWorld * IBM (the owner transform cancels out) for a vertex bound to joint 1', () => {
    const { t, ts, sk, g, owner, joints, inst } = rig({ p: [5, -2, 3], s: 2, yaw: 0.9 });
    const bend = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, 0.8);
    t.setRotation(joints[1], bend[0], bend[1], bend[2], bend[3]);
    ts.update(); sk.update(ts.updated);
    const bindPoint = [0, 1.5, 0]; // a vertex in world/bind space near joint 1
    const jm = g.joints.cpu.subarray((inst.jointOffset + 1) * 16, (inst.jointOffset + 1) * 16 + 16);
    const skinned = Mat4.transformPoint([0, 0, 0], jm as unknown as number[], bindPoint[0], bindPoint[1], bindPoint[2]);
    const world = Mat4.transformPoint([0, 0, 0], t.worldMatrices.subarray(owner * 16, owner * 16 + 16) as unknown as number[], skinned[0], skinned[1], skinned[2]);
    // reference: jointWorld(1) * inverse(jointWorld_bind(1)) applied to the bind point
    const jw = t.worldMatrices.subarray(joints[1] * 16, joints[1] * 16 + 16);
    const ibm1 = inst.skeleton.inverseBind.subarray(16, 32);
    const ref = Mat4.transformPoint([0, 0, 0], Mat4.multiply(Mat4.create(), jw as unknown as number[], ibm1 as unknown as number[]), bindPoint[0], bindPoint[1], bindPoint[2]);
    close(world, ref, 1e-4);
    // and the bend actually moved the point
    expect(Math.hypot(ref[0] - bindPoint[0], ref[1] - bindPoint[1], ref[2] - bindPoint[2])).toBeGreaterThan(0.1);
  });
});

describe('SkeletonSystem dirty propagation', () => {
  function crowd(n: number, g = makeFakeGPU()) {
    const buffersBefore = g.res.stats.buffers;
    const w = g.world, t = w.transforms;
    const ts = new TransformSystem(t), sk = new SkeletonSystem(w, g.joints);
    const insts: SkeletonInstance[] = [], jointEnts: number[][] = [];
    const ibm = new Float32Array(16 * 4); for (let j = 0; j < 4; j++) ibm.set(Mat4.create(), j * 16);
    const skel = new SkeletonAsset('s', Int32Array.from([0, 1, 2, 3]), ibm, Int32Array.from([-1, 0, 1, 2]));
    for (let i = 0; i < n; i++) {
      const owner = entityIndex(w.create()); t.add(owner, i * 3, 0, 0);
      const js = [0, 1, 2, 3].map(() => entityIndex(w.create()));
      js.forEach((j, k) => { t.add(j, 0, k ? 1 : 0, 0); if (k) t.setParent(j, js[k - 1]); t.setParent(js[0], owner); });
      const inst = new SkeletonInstance(skel, owner, Int32Array.from(js));
      w.skins.add(owner, inst); insts.push(inst); jointEnts.push(js);
    }
    ts.update(); sk.update(ts.updated);
    return { g, w, t, ts, sk, insts, jointEnts, buffersBefore };
  }

  it('first update computes every skeleton once; an idle frame computes none', () => {
    const c = crowd(100);
    expect(c.sk.updatedSkeletons).toBe(100); // the initial update inside crowd() computed each skeleton once
    c.ts.update(); c.sk.update(c.ts.updated);
    expect(c.sk.updatedSkeletons).toBe(0);
  });

  it('moving one joint recomputes only that skeleton (1 of 100)', () => {
    const c = crowd(100);
    c.t.setPosition(c.jointEnts[42][2], 0, 2, 1);
    c.ts.update(); c.sk.update(c.ts.updated);
    expect(c.sk.updatedSkeletons).toBe(1);
    expect(c.sk.updatedJoints).toBe(4);
    expect(c.insts[42].dirty).toBe(false);
  });

  it('moving the owner dirties its skeleton (joints are children of it here, so all joints move)', () => {
    const c = crowd(10);
    c.t.setPosition(c.insts[3].owner, 1, 1, 1);
    c.ts.update(); c.sk.update(c.ts.updated);
    expect(c.sk.updatedSkeletons).toBe(1);
  });

  it('1000 skeletons share ONE joint buffer (no per-character buffers)', () => {
    const c = crowd(1000);
    expect(c.g.res.stats.buffers).toBe(c.buffersBefore); // 1000 skeletons created zero additional GPU buffers
    expect(c.g.joints.usedMatrices).toBe(1 + 1000 * 4);
    const offs = new Set(c.insts.map((i) => i.jointOffset));
    expect(offs.size).toBe(1000);
  });

  it('removing a skeleton releases its joint range for reuse', () => {
    const c = crowd(3);
    const off = c.insts[1].jointOffset, used = c.g.joints.usedMatrices;
    c.w.skins.remove(c.insts[1].owner);
    const t = c.t;
    const owner = entityIndex(c.w.create()); t.add(owner);
    const js = [0, 1, 2, 3].map(() => entityIndex(c.w.create())); js.forEach((j) => t.add(j));
    const inst = new SkeletonInstance(c.insts[0].skeleton, owner, Int32Array.from(js));
    c.w.skins.add(owner, inst);
    expect(inst.jointOffset).toBe(off);
    expect(c.g.joints.usedMatrices).toBe(used);
  });

  it('matrices uploaded only for dirty skeletons, coalesced', () => {
    const c = crowd(50);
    c.g.joints.flush(); c.g.writes.length = 0; c.g.joints.beginFrame();
    c.t.setPosition(c.jointEnts[10][1], 0, 5, 0);
    c.t.setPosition(c.jointEnts[11][1], 0, 5, 0); // adjacent skeleton => coalesced
    c.t.setPosition(c.jointEnts[40][1], 0, 5, 0);
    c.ts.update(); c.sk.update(c.ts.updated);
    c.g.joints.flush();
    const w = c.g.writes.filter((x) => x.label === 'JointMatrixBuffer');
    expect(w.length).toBe(2);
    expect(c.g.joints.uploadBytes).toBe(3 * 4 * 64);
  });
});

describe('JointMatrixBuffer', () => {
  it('reserves matrix 0 as identity and grows with a full re-upload', () => {
    const g = makeFakeGPU();
    const jb = g.joints;
    expect(Array.from(jb.cpu.subarray(0, 16))).toEqual(Array.from(Mat4.create()));
    jb.flush(); g.writes.length = 0;
    const gen = jb.generation;
    const off = jb.allocate(5000);
    expect(jb.generation).toBe(gen + 1);
    jb.flush();
    expect(g.writes[0].bytes).toBe((off + 5000) * 64 >= 5001 * 64 ? jb.usedMatrices * 64 : 0);
    expect(g.writes.length).toBe(1);
  });
});

describe('instantiation of skinned + morphed glTF', () => {
  async function model(skinned: boolean, morphed: boolean) {
    const b = new GLBBuilder();
    const prim: Record<string, any> = addTriangle(b);
    if (skinned) {
      prim.attributes.JOINTS_0 = b.accessor(new Uint8Array([0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0]), 'VEC4');
      prim.attributes.WEIGHTS_0 = b.accessor(new Float32Array([0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0]), 'VEC4');
    }
    if (morphed) prim.targets = [
      { POSITION: b.accessor(new Float32Array([0, 0, 2, 0, 0, 2, 0, 0, 2]), 'VEC3') },
      { POSITION: b.accessor(new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]), 'VEC3') },
    ];
    const meshIdx = b.mesh({ primitives: [prim], weights: morphed ? [0.25, 0.75] : undefined });
    const j0 = b.node({ name: 'j0', children: [1] }), j1 = b.node({ name: 'j1', translation: [0, 1, 0] });
    const skinNode = b.node({ mesh: meshIdx, ...(skinned ? { skin: 0 } : {}) });
    if (skinned) b.json.skins = [{ joints: [j0, j1] }];
    b.addToScene(j0, skinNode);
    return loadGLTF(b.glb());
  }

  it('skinned mesh: skeleton instance, skinOwner, deformMask, joint range in the render world', async () => {
    const g = makeFakeGPU();
    const sk = new SkeletonSystem(g.world, g.joints);
    const inst = instantiateGLTF(await model(true, false), g);
    expect(inst.skeletons.length).toBe(1);
    expect(inst.skeletons[0].jointCount).toBe(2);
    const e = entityIndex(inst.meshEntities[0]);
    expect(g.world.meshRenderers.skinOwner[e]).toBe(e);
    const mesh = g.meshes.get(g.world.meshRenderers.meshId[e]);
    expect(mesh.deformMask).toBe(DeformMask.Skin);

    const ts = new TransformSystem(g.world.transforms), bs = new BoundsSystem(g.world.transforms, g.world.bounds);
    const ex = new RenderExtractor(g.world, ts), rw = new RenderWorld();
    ts.update(); sk.update(ts.updated); bs.update(ts.updated); ex.extract(rw, 1);
    expect(rw.count).toBe(1);
    expect(rw.jointCount[0]).toBe(2);
    expect(rw.jointOffset[0]).toBe(inst.skeletons[0].jointOffset);
    expect(rw.skinInstanceId[0]).toBe(inst.skeletons[0].id);
  });

  it('skinned bounds are expanded conservatively (bind-pose bounds would be invalid once deformed)', async () => {
    const g = makeFakeGPU();
    const asset = await model(true, false);
    const inst = instantiateGLTF(asset, g);
    const g2 = makeFakeGPU();
    const plain = instantiateGLTF(await model(false, false), g2);
    const e1 = entityIndex(inst.meshEntities[0]), e2 = entityIndex(plain.meshEntities[0]);
    const skinnedExtent = g.world.bounds.local[e1 * 6 + 3] - g.world.bounds.local[e1 * 6];
    const plainExtent = g2.world.bounds.local[e2 * 6 + 3] - g2.world.bounds.local[e2 * 6];
    expect(skinnedExtent).toBeGreaterThan(plainExtent + 0.5 - 1e-6); // padded by 0.5 x extent on each side
  });

  it('morphed mesh: delta arenas, default weights from mesh.weights, shared weight pool, max displacement', async () => {
    const g = makeFakeGPU();
    const inst = instantiateGLTF(await model(false, true), g);
    const e = entityIndex(inst.meshEntities[0]);
    const mesh = g.meshes.get(g.world.meshRenderers.meshId[e]);
    expect(mesh.deformMask).toBe(DeformMask.Morph);
    expect(mesh.morphTargetCount).toBe(2);
    expect(mesh.morphMaxDisplacement).toBeCloseTo(3); // 2 + 1
    const owner = g.world.meshRenderers.morphOwner[e];
    expect(owner).toBeGreaterThanOrEqual(0);
    const m = g.world.morphs;
    expect(Array.from(m.weights.subarray(m.weightOffset[owner], m.weightOffset[owner] + 2))).toEqual([0.25, 0.75]);
    // bounds padded by the max displacement so morphing never leaves the box
    expect(g.world.bounds.local[e * 6 + 2]).toBeLessThanOrEqual(-3 + 1e-6);
  });

  it('extraction compacts ACTIVE morph targets into (index, weight) pairs and mirrors only CHANGED states', async () => {
    const g = makeFakeGPU();
    const inst = instantiateGLTF(await model(false, true), g);
    const e = entityIndex(inst.meshEntities[0]);
    const owner = g.world.meshRenderers.morphOwner[e];
    const ts = new TransformSystem(g.world.transforms), ex = new RenderExtractor(g.world, ts), rw = new RenderWorld();
    ts.update(); ex.extract(rw, 1);
    expect(rw.morph.changedRanges.length).toBeGreaterThan(0);      // initial upload
    const pairs = (n: number) => Array.from({ length: n }, (_, k) => [rw.morph.pool[k * 2], bitsToFloat(rw.morph.pool[k * 2 + 1])]);
    expect(pairs(2)).toEqual([[0, 0.25], [1, 0.75]]);
    expect(rw.morphCount[0]).toBe(2);                              // 2 ACTIVE targets
    ts.update(); ex.extract(rw, 1);
    expect(rw.morph.changedRanges.length).toBe(0);                  // nothing changed => nothing to upload
    g.world.morphs.setWeights(owner, [1, 0]);
    ts.update(); ex.extract(rw, 1);
    const off = g.world.morphs.weightOffset[owner] * 2;
    expect(rw.morph.changedRanges).toEqual([off, 2]);               // only ONE active target now => 2 words uploaded
    expect(pairs(1)).toEqual([[0, 1]]);
    expect(rw.morphCount[0]).toBe(1);
    expect(rw.morph.activeStates).toBe(1);
    expect(rw.morph.activeTargets).toBe(1);
    g.world.morphs.setWeights(owner, [0, 0]);                       // all weights zero => zero active targets, nothing to upload
    ts.update(); ex.extract(rw, 1);
    expect(rw.morphCount[0]).toBe(0);
    expect(rw.morph.changedRanges.length).toBe(0);
  });

  it('skin+morph mesh uses both deform bits; vertex data uploaded once per mesh', async () => {
    const g = makeFakeGPU();
    const asset = await model(true, true);
    const inst = instantiateGLTF(asset, g);
    const mesh = g.meshes.get(g.world.meshRenderers.meshId[entityIndex(inst.meshEntities[0])]);
    expect(mesh.deformMask).toBe(DeformMask.Skin | DeformMask.Morph);
    const bytes = g.meshes.uploadedBytes;
    instantiateGLTF(asset, g); instantiateGLTF(asset, g);
    expect(g.meshes.uploadedBytes).toBe(bytes);
    expect(g.meshes.count).toBe(1);
    void F;
  });
});
