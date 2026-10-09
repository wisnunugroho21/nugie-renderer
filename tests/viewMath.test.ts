import { describe, expect, it } from 'vitest';
import { Mat4 } from '../src/math/Mat4';
import { Camera } from '../src/rendering/Camera';
import {
  reflectionMatrix, mirrorView, planeToView, obliqueProjection, cubeFaceView, cubeFaceProjection, flipX,
} from '../src/rendering/viewMath';
import { halfToFloat } from '../src/rendering/RenderTarget';

/** Transform a point (w = 1) by a column-major matrix; returns [x, y, z, w]. */
function xf(m: ArrayLike<number>, x: number, y: number, z: number): number[] {
  return [0, 1, 2, 3].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
}

describe('reflectionMatrix / mirrorView', () => {
  it('reflects points in the plane and is its own inverse', () => {
    const r = reflectionMatrix(Mat4.create(), 0, 0, -6, 0, 0, 1);   // plane z = -6
    expect(xf(r, 1, 2, -4).slice(0, 3)).toEqual([1, 2, -8]);
    expect(xf(r, 3, 0, -6).slice(0, 3)).toEqual([3, 0, -6]);        // points on the plane stay
    const rr = Mat4.multiply(Mat4.create(), r, r);
    for (let i = 0; i < 16; i++) expect(rr[i]).toBeCloseTo(i % 5 === 0 ? 1 : 0, 6);
    expect(Mat4.maxScale(r)).toBeCloseTo(1, 6);
  });

  it('a tilted plane normal is normalised', () => {
    const r = reflectionMatrix(Mat4.create(), 1, 1, 1, 0, 5, 0);    // plane y = 1, unnormalised normal
    expect(xf(r, 2, 4, 3).slice(0, 3)).toEqual([2, -2, 3]);
  });

  it('the mirrored camera sits at the reflected position', () => {
    const view = Mat4.lookAt(Mat4.create(), 2, 3, 10, 0, 1, 0);
    const mv = mirrorView(Mat4.create(), view, [0, 0, -6], [0, 0, 1]);
    const inv = Mat4.invert(Mat4.create(), mv)!;
    expect([inv[12], inv[13], inv[14]].map((v) => Math.round(v * 1e4) / 1e4)).toEqual([2, 3, -22]);   // z: 10 -> -6 - 16
  });
});

describe('oblique near plane', () => {
  const proj = Mat4.perspective(Mat4.create(), Math.PI / 3, 16 / 9, 0.1, 100);

  it('puts depth 0 on the plane and keeps depth 1 at the far corner', () => {
    // slightly tilted plane through (0, 0, -5); the visible side is AWAY from the camera, which sits on the negative side
    const l = Math.hypot(0.2, 0.1, 1);
    const c = [0.2 / l, -0.1 / l, -1 / l, -5 / l];
    expect(c[3]).toBeLessThan(0);
    const o = obliqueProjection(Mat4.create(), proj, c);
    // a point on the plane: choose x, y, solve z from c . p = 0
    const px = 0.7, py = 0.3, pz = -(c[0] * px + c[1] * py + c[3]) / c[2];
    const clip = xf(o, px, py, pz);
    expect(clip[2] / clip[3]).toBeCloseTo(0, 6);                     // on the plane: depth 0
    // beyond the plane (further from the camera): positive depth below 1; in front of it: negative (clipped)
    const behind = xf(o, px, py, pz - 1), front = xf(o, px, py, pz + 1);
    expect(behind[2] / behind[3]).toBeGreaterThan(0);
    expect(front[2]).toBeLessThan(0);
  });

  it('leaves the x / y mapping untouched', () => {
    const o = obliqueProjection(Mat4.create(), proj, [0, 0, -1, -2]);
    for (const i of [0, 4, 8, 12, 1, 5, 9, 13, 3, 7, 11, 15]) expect(o[i]).toBe(proj[i]);
  });

  it('planeToView follows the camera: a world plane becomes a view-space plane with the same side', () => {
    const view = Mat4.lookAt(Mat4.create(), 0, 2, 8, 0, 2, 0);
    const p = planeToView(view, [0, 0, 0], [0, 0, 1]);               // world plane z = 0, normal +z (towards the camera)
    // the camera (view-space origin) is on the positive side, 8 units away
    expect(p[3]).toBeCloseTo(8, 6);
    // a view-space point 8 units ahead lies on the plane
    expect(p[0] * 0 + p[1] * 0 + p[2] * -8 + p[3]).toBeCloseTo(0, 6);
  });
});

describe('cube faces follow the WebGPU cube-map convention', () => {
  /** Where WebGPU samples direction r: [face, u, v] with v = 0 at the top row of the face image. */
  function sampleFace(r: number[]): [number, number, number] {
    const [x, y, z] = r, ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    let face: number, sc: number, tc: number, ma: number;
    if (ax >= ay && ax >= az) { ma = ax; face = x > 0 ? 0 : 1; sc = x > 0 ? -z : z; tc = -y; }
    else if (ay >= az) { ma = ay; face = y > 0 ? 2 : 3; sc = x; tc = y > 0 ? z : -z; }
    else { ma = az; face = z > 0 ? 4 : 5; sc = z > 0 ? x : -x; tc = -y; }
    return [face, (sc / ma + 1) / 2, (tc / ma + 1) / 2];
  }

  it('renders a direction to the same texel the sampler would read', () => {
    const proj = cubeFaceProjection(Mat4.create(), 0.1, 100);
    const view = Mat4.create();
    const dirs = [[1, 0.5, -0.5], [-0.7, 0.2, 0.4], [0.3, 1, 0.2], [-0.2, -1, 0.6], [0.4, 0.3, 1], [-0.3, -0.2, -1], [0.6, -0.4, 0.2], [-0.5, 0.45, -0.3]];
    for (const d of dirs) {
      const [face, u, v] = sampleFace(d);
      cubeFaceView(view, face, 0, 0, 0);
      const clip = xf(Mat4.multiply(Mat4.create(), proj, view), d[0], d[1], d[2]);
      const ndcX = clip[0] / clip[3], ndcY = clip[1] / clip[3];
      expect((ndcX + 1) / 2).toBeCloseTo(u, 5);                      // image column
      expect((1 - ndcY) / 2).toBeCloseTo(v, 5);                      // image row (0 = top)
    }
  });

  it('every face views a 90 degree square frustum', () => {
    const proj = cubeFaceProjection(Mat4.create(), 0.1, 50);
    expect(Math.abs(proj[0])).toBeCloseTo(1, 6);
    expect(proj[5]).toBeCloseTo(1, 6);
    expect(proj[0]).toBeLessThan(0);                                  // mirrored horizontally
    expect(flipX(Mat4.create(), Mat4.perspective(Mat4.create(), 1, 1, 0.1, 10))[0]).toBeLessThan(0);
  });
});

describe('Camera.setMatrices / topDownOrthographic', () => {
  it('derives position, fov and frustum from the matrices', () => {
    const cam = new Camera();
    const view = Mat4.lookAt(Mat4.create(), 3, 4, 5, 0, 0, 0);
    const proj = Mat4.perspective(Mat4.create(), 1.0, 2, 0.5, 80);
    cam.setMatrices(view, proj, 0.5, 80);
    expect(Array.from(cam.position).map((v) => Math.round(v * 1e4) / 1e4)).toEqual([3, 4, 5]);
    expect(cam.fovY).toBeCloseTo(1.0, 6);
    expect(cam.aspect).toBeCloseTo(2, 6);
    expect(cam.far).toBe(80);
  });

  it('a top-down map covers +-halfWidth around its centre, with -Z at the top', () => {
    const cam = new Camera().topDownOrthographic(4, -2, 10, 1);
    const at = (x: number, z: number) => { const c = xf(cam.viewProjection, x, 0, z); return [c[0] / c[3], c[1] / c[3], c[2] / c[3]]; };
    expect(at(4, -2)[0]).toBeCloseTo(0, 6);
    expect(at(4, -2)[1]).toBeCloseTo(0, 6);
    expect(at(14, -2)[0]).toBeCloseTo(1, 6);                          // +X is to the right
    expect(at(4, -12)[1]).toBeCloseTo(1, 6);                          // -Z is at the top
    expect(at(4, 8)[1]).toBeCloseTo(-1, 6);
    const depth = at(4, -2)[2];
    expect(depth).toBeGreaterThan(0); expect(depth).toBeLessThan(1);
  });
});

describe('halfToFloat', () => {
  it('decodes IEEE half floats', () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x3555)).toBeCloseTo(1 / 3, 3);
    expect(halfToFloat(0x7bff)).toBe(65504);
    expect(halfToFloat(0)).toBe(0);
    expect(halfToFloat(0x0001)).toBeCloseTo(5.96e-8, 10);
  });
});
