import { describe, expect, it } from 'vitest';
import { Pose, PoseLayout } from '../src/animation/Pose';
import { Xform, modelTransform } from '../src/animation/ik/IK';
import { TwoBoneIK } from '../src/animation/ik/TwoBoneIK';
import { FABRIK } from '../src/animation/ik/FABRIK';
import { LookAt } from '../src/animation/ik/LookAt';
import { AnimationController } from '../src/animation/graph/AnimationController';
import { AnimationParams } from '../src/animation/graph/AnimationParams';
import { StateMachine } from '../src/animation/graph/StateMachine';
import { ClipMotion } from '../src/animation/graph/Motion';
import { AnimationClip, AnimationChannel } from '../src/animation/AnimationClip';
import { Quat } from '../src/math/Quat';

const close = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-3) => { for (let i = 0; i < b.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(eps); };

/**
 * Leg rig under a rotated, offset pelvis:
 *   0 pelvis (rotated 30deg about Z, translated)   1 hip (child of 0)   2 knee (child of 1, 1 unit down)   3 ankle (child of 2, 1 unit down)
 */
function legRig(withPelvisXform = true) {
  const l = new PoseLayout(4, undefined, [-1, 0, 1, 2]);
  const pose = new Pose(l);
  if (withPelvisXform) { pose.t.set([0.5, 2, 0.25], 0); pose.r.set(Quat.fromAxisAngle(Quat.create(), 0, 0, 1, 0.5), 0); }
  pose.t.set([0, 0, 0], 3);
  pose.t.set([0, -1, 0.05], 6);          // slight forward knee offset => a natural bend direction
  pose.t.set([0, -1, 0], 9);
  return { l, pose };
}

function pos(l: PoseLayout, pose: Pose, node: number): number[] { const x = new Xform(); modelTransform(l, pose, node, x); return Array.from(x.p); }
const dist = (a: number[], b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('TwoBoneIK', () => {
  it('end effector reaches any reachable target (with a rotated/offset parent), preserving bone lengths', () => {
    const { l, pose } = legRig();
    const hip0 = pos(l, pose, 1), knee0 = pos(l, pose, 2), ankle0 = pos(l, pose, 3);
    const l1 = dist(hip0, knee0), l2 = dist(knee0, ankle0);
    const ik = new TwoBoneIK(l, 1, 2, 3);
    const targets = [[hip0[0] + 0.4, hip0[1] - 1.2, hip0[2] + 0.3], [hip0[0] - 0.8, hip0[1] - 0.9, hip0[2]], [hip0[0], hip0[1] - 0.5, hip0[2] + 0.9], [hip0[0] + 0.2, hip0[1] + 0.3, hip0[2] - 1.0]];
    for (const t of targets) {
      const p = pose.clone();
      ik.target.set(t);
      ik.apply(p);
      expect(ik.reachable).toBe(true);
      expect(dist(pos(l, p, 3), t)).toBeLessThan(2e-3);
      expect(dist(pos(l, p, 1), pos(l, p, 2))).toBeCloseTo(l1, 4);
      expect(dist(pos(l, p, 2), pos(l, p, 3))).toBeCloseTo(l2, 4);
      expect(dist(pos(l, p, 1), hip0)).toBeLessThan(1e-4);                 // root joint stays put
      for (let n = 0; n < 4; n++) expect(Math.hypot(...p.r.subarray(n * 4, n * 4 + 4))).toBeCloseTo(1, 4);
    }
  });

  it('works with an identity parent too', () => {
    const { l, pose } = legRig(false);
    const ik = new TwoBoneIK(l, 1, 2, 3); ik.target.set([0.7, -1.3, 0.2]);
    ik.apply(pose);
    expect(dist(pos(l, pose, 3), ik.target)).toBeLessThan(2e-3);
  });

  it('unreachable targets straighten the chain toward the target (no NaN)', () => {
    const { l, pose } = legRig();
    const hip = pos(l, pose, 1);
    const ik = new TwoBoneIK(l, 1, 2, 3); ik.target.set([hip[0] + 10, hip[1], hip[2]]);
    ik.apply(pose);
    expect(ik.reachable).toBe(false);
    const end = pos(l, pose, 3);
    expect(dist(end, hip)).toBeCloseTo(2.0, 2);                              // fully extended (l1 + l2 ~ 2.0)
    expect(end[0] - hip[0]).toBeGreaterThan(1.9);                            // pointing at the target
    for (const v of pose.r) expect(Number.isFinite(v)).toBe(true);
  });

  it('pole vector selects the bend side', () => {
    const { l, pose } = legRig(false);
    const hip = pos(l, pose, 1);
    const target = [hip[0], hip[1] - 1.4, hip[2]];                          // bent leg directly below the hip
    const bendZ = (pz: number) => {
      const p = pose.clone();
      const ik = new TwoBoneIK(l, 1, 2, 3); ik.target.set(target); ik.pole = Float32Array.from([hip[0], hip[1] - 0.7, hip[2] + pz]);
      ik.apply(p);
      return pos(l, p, 2)[2] - hip[2];
    };
    expect(bendZ(+2)).toBeGreaterThan(0.2);
    expect(bendZ(-2)).toBeLessThan(-0.2);
  });

  it('weight 0 changes nothing; weight 0.5 ends up between FK and IK; weight 1 reaches the target', () => {
    const { l, pose } = legRig();
    const ik = new TwoBoneIK(l, 1, 2, 3);
    const hip = pos(l, pose, 1);
    ik.target.set([hip[0] + 0.9, hip[1] - 0.8, hip[2]]);
    const fk = pos(l, pose, 3);
    const p0 = pose.clone(); ik.weight = 0; ik.apply(p0);
    expect(dist(pos(l, p0, 3), fk)).toBeLessThan(1e-6);
    const ph = pose.clone(); ik.weight = 0.5; ik.apply(ph);
    const p1 = pose.clone(); ik.weight = 1; ik.apply(p1);
    const dFk = dist(fk, ik.target), dHalf = dist(pos(l, ph, 3), ik.target), dFull = dist(pos(l, p1, 3), ik.target);
    expect(dFull).toBeLessThan(2e-3);
    expect(dHalf).toBeLessThan(dFk); expect(dHalf).toBeGreaterThan(dFull);
  });

  it('degenerate inputs: target at the root joint, perfectly straight chain along the target axis', () => {
    const { l, pose } = legRig(false);
    const hip = pos(l, pose, 1);
    const ik = new TwoBoneIK(l, 1, 2, 3);
    ik.target.set(hip); ik.apply(pose.clone());
    // straight chain (remove the knee offset) with target straight below
    const straight = legRig(false).pose; straight.t.set([0, -1, 0], 6);
    ik.target.set([hip[0], hip[1] - 1.5, hip[2]]);
    const p = straight.clone(); ik.apply(p);
    for (const v of p.r) expect(Number.isFinite(v)).toBe(true);
    expect(dist(pos(l, p, 3), ik.target)).toBeLessThan(2e-3);
  });

  it('rejects joints that do not form a parent->child chain', () => {
    const { l } = legRig();
    expect(() => new TwoBoneIK(l, 1, 3, 2)).toThrow(/not a child/);
  });

  it('does not modify translations or scales', () => {
    const { l, pose } = legRig();
    const t0 = pose.t.slice(), s0 = pose.s.slice();
    const ik = new TwoBoneIK(l, 1, 2, 3); ik.target.set([0.6, -1.2, 0.1]); ik.apply(pose);
    expect(Array.from(pose.t)).toEqual(Array.from(t0)); expect(Array.from(pose.s)).toEqual(Array.from(s0));
  });
});

describe('FABRIK', () => {
  /** 5-joint tentacle under a rotated base: 0 base, then 1..4 each 1 unit along +Y. */
  function tentacle() {
    const l = new PoseLayout(5, undefined, [-1, 0, 1, 2, 3]);
    const pose = new Pose(l);
    pose.t.set([1, 0.5, -2], 0); pose.r.set(Quat.fromAxisAngle(Quat.create(), 1, 0, 0, 0.4), 0);
    for (let i = 1; i < 5; i++) pose.t.set([0, 1, 0], i * 3);
    return { l, pose };
  }
  const lens = (l: PoseLayout, p: Pose, chain: number[]) => chain.slice(1).map((n, i) => dist(pos(l, p, chain[i]), pos(l, p, n)));

  it('reaches a reachable target, keeps the root pinned and bone lengths constant', () => {
    const { l, pose } = tentacle();
    const chain = [1, 2, 3, 4];
    const before = lens(l, pose, chain), root0 = pos(l, pose, 1);
    const ik = new FABRIK(l, chain);
    ik.target.set([root0[0] + 1.5, root0[1] + 1.5, root0[2] + 1.2]);
    ik.apply(pose);
    expect(ik.reached).toBe(true);
    expect(dist(pos(l, pose, 4), ik.target)).toBeLessThan(5e-3);
    close(lens(l, pose, chain), before, 1e-3);
    expect(dist(pos(l, pose, 1), root0)).toBeLessThan(1e-4);
  });

  it('unreachable targets give a straight chain pointing at the target', () => {
    const { l, pose } = tentacle();
    const chain = [1, 2, 3, 4], root = pos(l, pose, 1);
    const ik = new FABRIK(l, chain);
    ik.target.set([root[0] - 20, root[1], root[2]]);
    ik.apply(pose);
    expect(ik.reached).toBe(false);
    const tip = pos(l, pose, 4);
    expect(dist(tip, root)).toBeCloseTo(3, 2);
    expect(root[0] - tip[0]).toBeGreaterThan(2.9);
  });

  it('weight 0 is a no-op and rotations stay normalized', () => {
    const { l, pose } = tentacle();
    const ref = pose.clone();
    const ik = new FABRIK(l, [1, 2, 3, 4]); ik.target.set([2, 2, 2]); ik.weight = 0; ik.apply(pose);
    expect(Array.from(pose.r)).toEqual(Array.from(ref.r));
    ik.weight = 1; ik.apply(pose);
    for (let n = 0; n < 5; n++) expect(Math.hypot(...pose.r.subarray(n * 4, n * 4 + 4))).toBeCloseTo(1, 5);
  });

  it('converges within the iteration budget for typical reach targets', () => {
    const { l, pose } = tentacle();
    const ik = new FABRIK(l, [1, 2, 3, 4]); const root = pos(l, pose, 1);
    ik.target.set([root[0] + 0.5, root[1] + 2.0, root[2] - 1.0]);
    ik.apply(pose);
    expect(ik.iterations).toBeLessThanOrEqual(ik.maxIterations);
    expect(dist(pos(l, pose, 4), ik.target)).toBeLessThan(5e-3);
  });

  it('chains shorter than 2 bones are rejected; non-chains are rejected', () => {
    const { l } = tentacle();
    expect(() => new FABRIK(l, [1, 2])).toThrow();
    expect(() => new FABRIK(l, [1, 3, 2])).toThrow(/not a child/);
  });
});

describe('LookAt', () => {
  function headRig() {
    const l = new PoseLayout(3, undefined, [-1, 0, 1]); // 0 body (yawed), 1 neck, 2 head
    const pose = new Pose(l);
    pose.r.set(Quat.fromAxisAngle(Quat.create(), 0, 1, 0, 0.7), 0);
    pose.t.set([0, 1, 0], 3); pose.t.set([0, 0.3, 0], 6);
    return { l, pose };
  }
  const aim = (l: PoseLayout, p: Pose, node: number, axis = [0, 0, 1]): number[] => { const x = new Xform(); modelTransform(l, p, node, x); return Array.from(Quat.rotateVec3([0, 0, 0], x.r, axis)); };

  it('points the joint axis at the target (model space)', () => {
    const { l, pose } = headRig();
    const head = pos(l, pose, 2);
    const la = new LookAt(l, 2); la.target.set([head[0] + 3, head[1] + 1, head[2] - 2]);
    la.apply(pose);
    const want = [3, 1, -2].map((v) => v / Math.hypot(3, 1, 2));
    close(aim(l, pose, 2), want, 1e-4);
  });

  it('maxAngle limits the deviation from the animated aim', () => {
    const { l, pose } = headRig();
    const before = aim(l, pose, 2);
    const head = pos(l, pose, 2);
    const la = new LookAt(l, 2); la.maxAngle = 0.3; la.target.set([head[0] - 5, head[1], head[2] - 0.1]);
    la.apply(pose);
    const after = aim(l, pose, 2);
    const ang = Math.acos(Math.min(1, before[0] * after[0] + before[1] * after[1] + before[2] * after[2]));
    expect(ang).toBeCloseTo(0.3, 3);
  });

  it('weight blends between animated and aimed', () => {
    const { l, pose } = headRig();
    const head = pos(l, pose, 2), fk = aim(l, pose, 2);
    const full = pose.clone(), half = pose.clone();
    const la = new LookAt(l, 2); la.target.set([head[0] + 2, head[1], head[2]]);
    la.apply(full); la.weight = 0.5; la.apply(half);
    const ang = (a: number[], b: number[]) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    const aFull = ang(fk, aim(l, full, 2)), aHalf = ang(fk, aim(l, half, 2));
    expect(aHalf).toBeGreaterThan(0.05); expect(aHalf).toBeLessThan(aFull);
  });

  it('target at the joint position is ignored (no NaN)', () => {
    const { l, pose } = headRig();
    const la = new LookAt(l, 2); la.target.set(pos(l, pose, 2));
    la.apply(pose);
    for (const v of pose.r) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('IK inside the AnimationController (runs after blending, before output)', () => {
  it('constraints modify the final pose and their nodes join animatedNodes', () => {
    const { l, pose: rest } = legRig(false);
    const clip = new AnimationClip('idle', [new AnimationChannel(0, 'translation', 'LINEAR', Float32Array.from([0, 1]), Float32Array.from([0, 2, 0, 0, 2, 0]), 3)]);
    const sm = new StateMachine(l, rest, [{ name: 'idle', motion: new ClipMotion(clip) }], [], 0);
    const c = new AnimationController(l, rest, new AnimationParams(), [{ name: 'base', stateMachine: sm }], -1);
    const ik = new TwoBoneIK(l, 1, 2, 3);
    c.constraints.push(ik); c.refreshAnimatedNodes();
    expect(Array.from(c.animatedNodes).sort()).toEqual([0, 1, 2]);
    const hip = pos(l, rest, 1);
    // the clip lifts the pelvis (and so the hip) by +2 in Y; the target is expressed in the same MODEL space as the output pose
    ik.target.set([hip[0] + 0.5, hip[1] + 2 - 1.2, hip[2]]);
    c.update(0.1);
    expect(dist(pos(l, c.pose, 3), ik.target)).toBeLessThan(2e-3);
  });
});
