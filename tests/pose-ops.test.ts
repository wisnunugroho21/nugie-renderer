import { describe, expect, it } from 'vitest';
import { Pose, PoseLayout } from '../src/animation/Pose';
import { applyAdditive, blendPoses, buildBoneMask, buildMorphMask, makeAdditive } from '../src/animation/PoseOps';
import { Quat } from '../src/math/Quat';

const close = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-5) => { for (let i = 0; i < b.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(eps); };
const q = (axis: [number, number, number], angle: number) => Quat.fromAxisAngle(Quat.create(), axis[0], axis[1], axis[2], angle);

/** 4-node chain 0 -> 1 -> 2 -> 3 plus a sibling branch 4 (child of 1); node 3 owns 2 morph weights. */
function layout() { return new PoseLayout(5, [0, 0, 0, 2, 0], [-1, 0, 1, 2, 1]); }

function pose(l: PoseLayout, fill: (p: Pose) => void): Pose { const p = new Pose(l); fill(p); return p; }

describe('PoseLayout hierarchy', () => {
  it('order lists every parent before its children (even if indices are shuffled)', () => {
    const l = new PoseLayout(6, undefined, [3, -1, 1, 1, 2, 4]); // 1 root; 3 child of 1; 0 child of 3; 2 child of 1; 4 of 2; 5 of 4
    const pos = new Map(Array.from(l.order).map((n, i) => [n, i]));
    for (let n = 0; n < 6; n++) if (l.parent[n] >= 0) expect(pos.get(l.parent[n])!).toBeLessThan(pos.get(n)!);
    expect(l.order.length).toBe(6);
  });
  it('rejects cycles', () => {
    expect(() => new PoseLayout(3, undefined, [2, 0, 1])).toThrow(/cycle/);
  });
});

describe('blendPoses', () => {
  const l = layout();
  const a = pose(l, (p) => { p.t.set([0, 0, 0], 3); p.s.set([1, 1, 1], 3); p.w.set([0, 1]); });
  const b = pose(l, (p) => { p.t.set([10, 20, 30], 3); p.s.set([3, 3, 3], 3); p.r.set(q([0, 0, 1], Math.PI / 2), 4); p.w.set([1, 0]); });

  it('w=0 gives a, w=1 gives b, w=0.5 is the midpoint (rotation = slerp)', () => {
    const o = new Pose(l);
    blendPoses(o, a, b, 0); close(o.t, a.t); close(o.r, a.r);
    blendPoses(o, a, b, 1); close(o.t, b.t); close(o.r, b.r);
    blendPoses(o, a, b, 0.5);
    close(o.t.subarray(3, 6), [5, 10, 15]); close(o.s.subarray(3, 6), [2, 2, 2]);
    close(o.r.subarray(4, 8), q([0, 0, 1], Math.PI / 4));
    close(o.w, [0.5, 0.5]);
  });
  it('blending the same pose is the identity and keeps rotations unit length', () => {
    const o = new Pose(l);
    blendPoses(o, b, b, 0.37);
    close(o.r, b.r); close(o.t, b.t);
    for (let n = 0; n < 5; n++) expect(Math.hypot(...o.r.subarray(n * 4, n * 4 + 4))).toBeCloseTo(1, 6);
  });
  it('takes the shortest rotation arc (q and -q are the same rotation)', () => {
    const neg = pose(l, (p) => { const nq = q([0, 0, 1], Math.PI / 2); p.r.set([-nq[0], -nq[1], -nq[2], -nq[3]], 4); });
    const o = new Pose(l);
    blendPoses(o, new Pose(l), neg, 0.5);
    close(o.r.subarray(4, 8), q([0, 0, 1], Math.PI / 4));
  });
  it('allows out to alias an input', () => {
    const x = a.clone();
    blendPoses(x, x, b, 0.5);
    close(x.t.subarray(3, 6), [5, 10, 15]);
  });
  it('no temporary garbage: result independent of call order for symmetric weights', () => {
    const o1 = new Pose(l), o2 = new Pose(l);
    blendPoses(o1, a, b, 0.25); blendPoses(o2, b, a, 0.75);
    close(o1.t, o2.t); close(o1.r, o2.r, 1e-5); close(o1.w, o2.w);
  });
});

describe('masks', () => {
  const l = layout();
  it('bone mask with descendants covers the subtree only', () => {
    const m = buildBoneMask(l, [1]);
    expect(Array.from(m.bones)).toEqual([0, 1, 1, 1, 1]);
    expect(Array.from(buildBoneMask(l, [2]).bones)).toEqual([0, 0, 1, 1, 0]);
    expect(Array.from(buildBoneMask(l, [1], { descendants: false }).bones)).toEqual([0, 1, 0, 0, 0]);
    expect(Array.from(buildBoneMask(l, [2], { weight: 0.5 }).bones)).toEqual([0, 0, 0.5, 0.5, 0]);
  });
  it('masked blend only moves masked nodes; unmasked nodes keep the base pose exactly', () => {
    const base = new Pose(l), over = pose(l, (p) => { for (let n = 0; n < 5; n++) p.t.set([n + 1, 0, 0], n * 3); });
    const o = new Pose(l);
    blendPoses(o, base, over, 1, buildBoneMask(l, [2])); // nodes 2,3
    expect(Array.from({ length: 5 }, (_, n) => o.t[n * 3])).toEqual([0, 0, 3, 4, 0]);
  });
  it('partial mask weights scale the blend', () => {
    const base = new Pose(l), over = pose(l, (p) => p.t.set([10, 0, 0], 6));
    const o = new Pose(l);
    blendPoses(o, base, over, 1, buildBoneMask(l, [2], { weight: 0.3, descendants: false }));
    expect(o.t[6]).toBeCloseTo(3);
    blendPoses(o, base, over, 0.5, buildBoneMask(l, [2], { weight: 0.4, descendants: false }));
    expect(o.t[6]).toBeCloseTo(2);
  });
  it('morph masks restrict facial/morph layers to chosen nodes (independent of bone mask)', () => {
    const base = new Pose(l), over = pose(l, (p) => { p.w.set([1, 1]); p.t.set([9, 9, 9], 9); });
    const o = new Pose(l);
    blendPoses(o, base, over, 1, buildMorphMask(l, [3]));
    close(o.w, [1, 1]);
    close(o.t.subarray(9, 12), [0, 0, 0]);           // bones untouched by a morph-only mask
    const none = new Pose(l);
    blendPoses(none, base, over, 1, buildMorphMask(l, [2]));
    close(none.w, [0, 0]);                              // wrong node => no morph change
  });
});

describe('additive blending', () => {
  const l = layout();
  const ref = pose(l, (p) => { p.t.set([1, 2, 3], 3); p.r.set(q([0, 1, 0], 0.3), 4); p.s.set([2, 2, 2], 3); p.w.set([0.1, 0.2]); });
  const target = pose(l, (p) => { p.t.set([4, 2, 3], 3); p.r.set(q([0, 1, 0], 1.0), 4); p.s.set([4, 4, 4], 3); p.w.set([0.6, 0.2]); });

  it('applying a pose-vs-reference difference on top of the reference reproduces the pose', () => {
    const delta = new Pose(l);
    makeAdditive(delta, target, ref);
    const o = new Pose(l);
    applyAdditive(o, ref, delta, 1);
    close(o.t, target.t); close(o.s, target.s); close(o.w, target.w);
    close(o.r.subarray(4, 8), target.r.subarray(4, 8));
  });
  it('weight 0 leaves the base untouched, weight 0.5 applies half of the translation / rotation angle', () => {
    const delta = new Pose(l); makeAdditive(delta, target, ref);
    const o = new Pose(l);
    applyAdditive(o, ref, delta, 0);
    close(o.t, ref.t); close(o.r, ref.r);
    applyAdditive(o, ref, delta, 0.5);
    expect(o.t[3]).toBeCloseTo(2.5);
    close(o.r.subarray(4, 8), q([0, 1, 0], 0.3 + (1.0 - 0.3) / 2), 1e-5);
    expect(o.s[3]).toBeCloseTo(2 * (1 + (2 - 1) * 0.5)); // ratio 2 -> 1.5x
  });
  it('additive on a DIFFERENT base: rotation delta is applied in the base frame (delta * base)', () => {
    const delta = new Pose(l);
    delta.r.set(q([0, 0, 1], Math.PI / 2), 4);
    const base = pose(l, (p) => p.r.set(q([0, 1, 0], 0.5), 4));
    const o = new Pose(l);
    applyAdditive(o, base, delta, 1);
    const expected = Quat.multiply(Quat.create(), q([0, 0, 1], Math.PI / 2), q([0, 1, 0], 0.5));
    close(o.r.subarray(4, 8), expected);
  });
  it('masked additive only affects masked nodes', () => {
    const delta = new Pose(l); delta.t.set([5, 5, 5], 0); delta.t.set([5, 5, 5], 6);
    const o = new Pose(l);
    applyAdditive(o, new Pose(l), delta, 1, buildBoneMask(l, [2], { descendants: false }));
    close(o.t.subarray(0, 3), [0, 0, 0]);
    close(o.t.subarray(6, 9), [5, 5, 5]);
  });
  it('additive delta of identical poses is the identity delta', () => {
    const d = new Pose(l); makeAdditive(d, ref, ref);
    for (let n = 0; n < 5; n++) { close(d.t.subarray(n * 3, n * 3 + 3), [0, 0, 0]); close(d.s.subarray(n * 3, n * 3 + 3), [1, 1, 1]); close(d.r.subarray(n * 4, n * 4 + 4), [0, 0, 0, 1]); }
  });
});
