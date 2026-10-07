import { describe, expect, it } from 'vitest';
import { deformVertexRef, type RefMorph } from '../src/animation/reference';
import { Mat4 } from '../src/math/Mat4';
import { Quat } from '../src/math/Quat';

const base = { position: [1, 0, 0], normal: [1, 0, 0], tangent: [0, 1, 0] };
const rotZ90 = (() => { const q = Quat.fromAxisAngle(Quat.create(), 0, 0, 1, Math.PI / 2); return Mat4.compose(new Float32Array(16), 0, 0, 0, q[0], q[1], q[2], q[3], 1, 1, 1) as Float32Array; })();
const morph: { targets: RefMorph[]; weights: number[] } = { targets: [{ position: Float32Array.from([1, 0, 0]) }], weights: [1] }; // +1 in X
const skin = { joints: Uint16Array.from([0, 0, 0, 0]), weights: Float32Array.from([1, 0, 0, 0]), matrices: rotZ90, jointOffset: 0 };

describe('Base vertex -> Morph -> Skin (required order)', () => {
  it('morph is applied BEFORE skinning: (1,0,0)+(1,0,0)=(2,0,0), then rotated 90deg about Z => (0,2,0)', () => {
    const r = deformVertexRef(0, base, morph, skin);
    expect(r.position[0]).toBeCloseTo(0, 5);
    expect(r.position[1]).toBeCloseTo(2, 5);
  });

  it('the reverse order would give a different answer: rotate first => (0,1,0), then +X morph => (1,1,0)', () => {
    const skinned = deformVertexRef(0, base, null, skin).position;
    const wrong = [skinned[0] + 1, skinned[1], skinned[2]];
    const right = deformVertexRef(0, base, morph, skin).position;
    expect(Math.hypot(wrong[0] - right[0], wrong[1] - right[1])).toBeGreaterThan(1);
  });

  it('morph-only and skin-only paths each reduce to their single operation', () => {
    expect(deformVertexRef(0, base, morph, null).position).toEqual([2, 0, 0]);
    const s = deformVertexRef(0, base, null, skin).position;
    expect(s[0]).toBeCloseTo(0, 5); expect(s[1]).toBeCloseTo(1, 5);
  });

  it('static path is the identity', () => {
    expect(deformVertexRef(0, base, null, null)).toEqual(base);
  });

  it('normals/tangents are morphed then skinned and stay unit length', () => {
    const m = { targets: [{ normal: Float32Array.from([0, 1, 0]) }], weights: [1] }; // tilts the normal to (1,1,0)/sqrt2
    const r = deformVertexRef(0, base, m, skin);
    expect(Math.hypot(...r.normal)).toBeCloseTo(1, 6);
    // (1,1,0)/sqrt2 rotated by 90deg about Z => (-1,1,0)/sqrt2
    expect(r.normal[0]).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(r.normal[1]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(Math.hypot(...r.tangent)).toBeCloseTo(1, 6);
  });

  it('zero-weight targets and zero-length tangents are safe (no NaN)', () => {
    const zeroTan = { position: [0, 0, 0], normal: [0, 0, 1], tangent: [0, 0, 0] };
    const r = deformVertexRef(0, zeroTan, { targets: [{ position: Float32Array.from([1, 1, 1]) }], weights: [0] }, skin);
    for (const v of [...r.position, ...r.normal, ...r.tangent]) expect(Number.isFinite(v)).toBe(true);
    expect(r.tangent).toEqual([0, 0, 0]);
  });

  it('skin weights blend matrices linearly (50/50 identity + rotation)', () => {
    const two = new Float32Array(32); two.set(Mat4.create(), 0); two.set(rotZ90, 16);
    const r = deformVertexRef(0, base, null, { joints: Uint16Array.from([0, 1, 0, 0]), weights: Float32Array.from([0.5, 0.5, 0, 0]), matrices: two, jointOffset: 0 });
    expect(r.position[0]).toBeCloseTo(0.5, 5);
    expect(r.position[1]).toBeCloseTo(0.5, 5);
  });
});
