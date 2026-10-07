import { Mat4 } from '../../math/Mat4';

/** Practical split scheme: blend of logarithmic and uniform splits. Returns the far distance of each cascade. */
export function cascadeSplits(near: number, far: number, count: number, lambda: number, out: Float32Array | number[] = new Float32Array(4)): Float32Array | number[] {
  for (let i = 1; i <= count; i++) {
    const p = i / count;
    const log = near * Math.pow(far / near, p), uni = near + (far - near) * p;
    out[i - 1] = lambda * log + (1 - lambda) * uni;
  }
  for (let i = count; i < out.length; i++) out[i] = far;
  return out;
}

export interface CascadeResult {
  /** Light view-projection (column-major, depth [0,1]). */
  viewProjection: Float32Array;
  /** Radius of the bounding sphere of the sliced camera frustum (== half the ortho extent). */
  radius: number;
  /** World-space size of one shadow texel. */
  texelSize: number;
}

const up0 = [0, 1, 0], up1 = [1, 0, 0];

/**
 * Stable cascade fit: bounds the camera-frustum slice [d0, d1] with a sphere (rotation independent => constant size) and
 * snaps the projection to whole shadow texels so the shadow does not shimmer when the camera moves.
 * `invView` is the camera world matrix (inverse of the view matrix).
 */
export function fitCascade(
  invView: ArrayLike<number>, fovY: number, aspect: number, d0: number, d1: number,
  lightDir: ArrayLike<number>, mapSize: number, casterRange: number,
): CascadeResult {
  const th = Math.tan(fovY / 2);
  // slice corners in world space
  const corners: number[][] = [];
  for (const z of [d0, d1]) {
    const hh = z * th, hw = hh * aspect;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = sx * hw, y = sy * hh, zz = -z, m = invView;
      corners.push([m[0] * x + m[4] * y + m[8] * zz + m[12], m[1] * x + m[5] * y + m[9] * zz + m[13], m[2] * x + m[6] * y + m[10] * zz + m[14]]);
    }
  }
  const c = [0, 0, 0];
  for (const p of corners) { c[0] += p[0] / 8; c[1] += p[1] / 8; c[2] += p[2] / 8; }
  let r = 0;
  for (const p of corners) r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
  r = Math.ceil(r * 16) / 16;   // quantise so tiny fov / aspect jitter does not change the size
  const texel = (2 * r) / mapSize;

  const l = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1, d = [lightDir[0] / l, lightDir[1] / l, lightDir[2] / l];
  const up = Math.abs(d[1]) > 0.99 ? up1 : up0;
  const back = r + casterRange;
  const view = Mat4.lookAt(Mat4.create(), c[0] - d[0] * back, c[1] - d[1] * back, c[2] - d[2] * back, c[0], c[1], c[2], up[0], up[1], up[2]);
  const proj = Mat4.ortho(Mat4.create(), -r, r, -r, r, 0, back + r);
  const vp = Mat4.multiply(Mat4.create(), proj, view);
  // texel snapping: move the projection so the world origin lands on a texel corner
  const ox = (vp[12] * mapSize) / 2, oy = (vp[13] * mapSize) / 2;
  proj[12] += (Math.round(ox) - ox) * 2 / mapSize;
  proj[13] += (Math.round(oy) - oy) * 2 / mapSize;
  Mat4.multiply(vp, proj, view);
  return { viewProjection: new Float32Array(vp), radius: r, texelSize: texel };
}

export interface SpotShadowResult { viewProjection: Float32Array; /** tan of the half field of view used (for texel-size estimation). */ tanHalfFov: number; }

/** Perspective shadow matrix for a spot light (fov = outer cone * 2 plus a small margin for the PCF kernel). */
export function fitSpot(pos: ArrayLike<number>, dir: ArrayLike<number>, outerCone: number, range: number): SpotShadowResult {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1, d = [dir[0] / l, dir[1] / l, dir[2] / l];
  const up = Math.abs(d[1]) > 0.99 ? up1 : up0;
  const half = Math.min(outerCone + 0.03, 1.5);
  const far = range > 0 ? range : 100, near = Math.max(0.05, far * 0.005);
  const view = Mat4.lookAt(Mat4.create(), pos[0], pos[1], pos[2], pos[0] + d[0], pos[1] + d[1], pos[2] + d[2], up[0], up[1], up[2]);
  const proj = Mat4.perspective(Mat4.create(), half * 2, 1, near, far);
  return { viewProjection: new Float32Array(Mat4.multiply(Mat4.create(), proj, view)), tanHalfFov: Math.tan(half) };
}

export interface PointShadowResult { /** One view-projection per cube face in the order +X -X +Y -Y +Z -Z. */ faces: Float32Array[]; tanHalfFov: number; }

const FACES: { dir: number[]; up: number[] }[] = [
  { dir: [1, 0, 0], up: [0, 1, 0] }, { dir: [-1, 0, 0], up: [0, 1, 0] },
  { dir: [0, 1, 0], up: [0, 0, 1] }, { dir: [0, -1, 0], up: [0, 0, 1] },
  { dir: [0, 0, 1], up: [0, 1, 0] }, { dir: [0, 0, -1], up: [0, 1, 0] },
];

/** Six 90-degree (plus a margin for PCF / normal offset) perspective matrices around a point light. */
export function fitPoint(pos: ArrayLike<number>, range: number): PointShadowResult {
  const half = Math.PI / 4 + 0.04, far = range > 0 ? range : 100, near = Math.max(0.05, far * 0.005);
  const proj = Mat4.perspective(Mat4.create(), half * 2, 1, near, far);
  const faces = FACES.map((f) => {
    const view = Mat4.lookAt(Mat4.create(), pos[0], pos[1], pos[2], pos[0] + f.dir[0], pos[1] + f.dir[1], pos[2] + f.dir[2], f.up[0], f.up[1], f.up[2]);
    return new Float32Array(Mat4.multiply(Mat4.create(), proj, view));
  });
  return { faces, tanHalfFov: Math.tan(half) };
}

/** Cube face (0..5 = +X -X +Y -Y +Z -Z) that direction d points into (largest absolute component; ties favour X, then Y). */
export function cubeFaceOf(dx: number, dy: number, dz: number): number {
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  if (ax >= ay && ax >= az) return dx >= 0 ? 0 : 1;
  if (ay >= az) return dy >= 0 ? 2 : 3;
  return dz >= 0 ? 4 : 5;
}
