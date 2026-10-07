import { describe, expect, it } from 'vitest';
import { Mat4 } from '../src/math/Mat4';
import { Quat } from '../src/math/Quat';
import { Vec3 } from '../src/math/Vec3';
import { AABB } from '../src/math/AABB';
import { BoundingSphere } from '../src/math/BoundingSphere';
import { Frustum } from '../src/math/Frustum';

const close = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-5) => {
  for (let i = 0; i < b.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(eps);
};

describe('Vec3', () => {
  it('cross/dot/normalize', () => {
    close(Vec3.cross([0, 0, 0], [1, 0, 0], [0, 1, 0]), [0, 0, 1]);
    expect(Vec3.dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(Vec3.length(Vec3.normalize([0, 0, 0], [3, 0, 4]))).toBeCloseTo(1);
  });
});

describe('Quat', () => {
  it('rotates +X by 90deg about +Z to +Y', () => {
    const q = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, Math.PI / 2);
    close(Quat.rotateVec3([0, 0, 0], q, [1, 0, 0]), [0, 1, 0]);
  });
  it('multiply composes (b first)', () => {
    const a = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, Math.PI / 2);
    const c = Quat.multiply(Quat.create(), a, a);
    close(Quat.rotateVec3([0, 0, 0], c, [1, 0, 0]), [-1, 0, 0]);
  });
  it('slerp midpoint and shortest path', () => {
    const a = Quat.create(), b = Quat.fromAxisAngle(Quat.create(), 0, 1, 0, Math.PI / 2);
    const m = Quat.slerp(Quat.create(), a, b, 0.5);
    close(m, Quat.fromAxisAngle(Quat.create(), 0, 1, 0, Math.PI / 4));
    const nb = [-b[0], -b[1], -b[2], -b[3]];
    close(Quat.slerp(Quat.create(), a, nb, 0.5), Quat.fromAxisAngle(Quat.create(), 0, 1, 0, Math.PI / 4));
  });
});

describe('Mat4', () => {
  it('compose matches quat rotation + translation + scale', () => {
    const q = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, Math.PI / 2);
    const m = Mat4.compose(Mat4.create(), 5, 6, 7, q[0], q[1], q[2], q[3], 2, 2, 2);
    close(Mat4.transformPoint([0, 0, 0], m, 1, 0, 0), [5, 8, 7]);
  });
  it('multiply order: a*b applies b first', () => {
    const t = Mat4.compose(Mat4.create(), 10, 0, 0, 0, 0, 0, 1, 1, 1, 1);
    const s = Mat4.compose(Mat4.create(), 0, 0, 0, 0, 0, 0, 1, 2, 2, 2);
    close(Mat4.transformPoint([0, 0, 0], Mat4.multiply(Mat4.create(), t, s), 1, 0, 0), [12, 0, 0]);
    close(Mat4.transformPoint([0, 0, 0], Mat4.multiply(Mat4.create(), s, t), 1, 0, 0), [22, 0, 0]);
  });
  it('invert gives identity', () => {
    const q = Quat.normalize(Quat.create(), [0.3, 0.5, 0.1, 0.8]);
    const m = Mat4.compose(Mat4.create(), 1, 2, 3, q[0], q[1], q[2], q[3], 1, 2, 3);
    const inv = Mat4.invert(Mat4.create(), m)!;
    close(Mat4.multiply(Mat4.create(), m, inv), Mat4.create());
  });
  it('invert singular returns null', () => {
    expect(Mat4.invert(Mat4.create(), new Float32Array(16))).toBeNull();
  });
  it('perspective maps near->0 and far->1 (WebGPU depth, standard Z)', () => {
    const p = Mat4.perspective(Mat4.create(), 1, 1.5, 0.1, 100);
    const ndc = (z: number) => Mat4.transformPoint([0, 0, 0], p, 0, 0, z)[2];
    expect(ndc(-0.1)).toBeCloseTo(0, 5);
    expect(ndc(-100)).toBeCloseTo(1, 4);
  });
  it('lookAt: eye maps to origin, target on -Z', () => {
    const v = Mat4.lookAt(Mat4.create(), 0, 0, 5, 0, 0, 0);
    close(Mat4.transformPoint([0, 0, 0], v, 0, 0, 5), [0, 0, 0]);
    close(Mat4.transformPoint([0, 0, 0], v, 0, 0, 0), [0, 0, -5]);
  });
});

describe('AABB / Sphere', () => {
  it('transform by rotation expands box', () => {
    const q = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, Math.PI / 4);
    const m = Mat4.compose(Mat4.create(), 0, 0, 0, q[0], q[1], q[2], q[3], 1, 1, 1);
    const b = AABB.transform(AABB.create(), [-1, -1, -1, 1, 1, 1], m);
    expect(b[3]).toBeCloseTo(Math.SQRT2, 5);
    expect(b[5]).toBeCloseTo(1, 5);
  });
  it('union / intersects', () => {
    const u = AABB.union(AABB.create(), [0, 0, 0, 1, 1, 1], [2, 2, 2, 3, 3, 3]);
    close(u, [0, 0, 0, 3, 3, 3]);
    expect(AABB.intersects([0, 0, 0, 1, 1, 1], [1, 1, 1, 2, 2, 2])).toBe(true);
    expect(AABB.intersects([0, 0, 0, 1, 1, 1], [1.1, 0, 0, 2, 1, 1])).toBe(false);
  });
  it('sphere transform scales radius conservatively', () => {
    const m = Mat4.compose(Mat4.create(), 1, 0, 0, 0, 0, 0, 1, 1, 3, 2);
    close(BoundingSphere.transform([0, 0, 0, 0], [0, 0, 0, 1], m), [1, 0, 0, 3]);
  });
});

describe('Frustum', () => {
  const proj = Mat4.perspective(Mat4.create(), Math.PI / 2, 1, 1, 100);
  const view = Mat4.lookAt(Mat4.create(), 0, 0, 0, 0, 0, -1);
  const vp = Mat4.multiply(Mat4.create(), proj, view);
  const f = new Frustum().setFromViewProjection(vp);
  it('sphere in front is inside, behind is outside', () => {
    expect(f.intersectsSphere(0, 0, -10, 1)).toBe(true);
    expect(f.intersectsSphere(0, 0, 10, 1)).toBe(false);
  });
  it('rejects beyond far, left, and before near', () => {
    expect(f.intersectsSphere(0, 0, -200, 1)).toBe(false);
    expect(f.intersectsSphere(-50, 0, -10, 1)).toBe(false);
    expect(f.intersectsSphere(0, 0, -0.5, 0.1)).toBe(false);
  });
  it('fov 90 boundary: x=-z is on left plane', () => {
    expect(f.intersectsSphere(-9, 0, -10, 0.01)).toBe(true);
    expect(f.intersectsSphere(-11, 0, -10, 0.01)).toBe(false);
  });
  it('AABB test agrees', () => {
    expect(f.intersectsAABB([-1, -1, -11, 1, 1, -9])).toBe(true);
    expect(f.intersectsAABB([-1, -1, 9, 1, 1, 11])).toBe(false);
    expect(f.intersectsAABB([100, 100, -11, 101, 101, -9])).toBe(false);
  });
});

describe('Quat.fromTo', () => {
  const rot = (q: ArrayLike<number>, v: number[]) => Quat.rotateVec3([0, 0, 0], q as number[], v);
  it('rotates a onto b for general vectors', () => {
    const cases: [number[], number[]][] = [[[1, 0, 0], [0, 1, 0]], [[0, 0, 1], [1, 1, 0]], [[1, 2, 3], [-3, 0.5, 2]], [[0, -1, 0], [0.3, 0.2, 0.9]]];
    for (const [a, b] of cases) {
      const q = Quat.fromTo(Quat.create(), a[0], a[1], a[2], b[0], b[1], b[2]);
      const la = Math.hypot(...a), lb = Math.hypot(...b);
      close(rot(q, a.map((x) => x / la)), b.map((x) => x / lb));
      expect(Math.hypot(...q)).toBeCloseTo(1, 6);
    }
  });
  it('identity for parallel vectors, 180 degrees for anti-parallel (all axes, no NaN)', () => {
    close(Quat.fromTo(Quat.create(), 0, 1, 0, 0, 2, 0), [0, 0, 0, 1]);
    for (const a of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0.6, 0.8, 0]]) {
      const q = Quat.fromTo(Quat.create(), a[0], a[1], a[2], -a[0], -a[1], -a[2]);
      for (const v of q) expect(Number.isFinite(v)).toBe(true);
      close(rot(q, a), [-a[0], -a[1], -a[2]]);
    }
  });
  it('zero-length input gives identity', () => {
    close(Quat.fromTo(Quat.create(), 0, 0, 0, 1, 0, 0), [0, 0, 0, 1]);
  });
});
