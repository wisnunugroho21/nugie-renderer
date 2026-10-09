import { Mat4, type M4 } from '../math/Mat4';


/**
 * Matrix helpers for off-screen views: planar mirrors (reflected view + oblique near plane) and cube-map faces.
 * Conventions: column-major, right-handed, camera looks down -Z, clip depth [0, 1].
 */

/** World-space reflection about the plane through `p` with normal `n` (need not be unit length). */
export function reflectionMatrix(o: M4, px: number, py: number, pz: number, nx: number, ny: number, nz: number): M4 {
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  const d = nx * px + ny * py + nz * pz;
  o[0] = 1 - 2 * nx * nx; o[1] = -2 * ny * nx;    o[2] = -2 * nz * nx;    o[3] = 0;
  o[4] = -2 * nx * ny;    o[5] = 1 - 2 * ny * ny; o[6] = -2 * nz * ny;    o[7] = 0;
  o[8] = -2 * nx * nz;    o[9] = -2 * ny * nz;    o[10] = 1 - 2 * nz * nz; o[11] = 0;
  o[12] = 2 * d * nx;     o[13] = 2 * d * ny;     o[14] = 2 * d * nz;     o[15] = 1;
  return o;
}

/** View matrix of the camera mirrored in the plane (`view * reflection`). Triangle winding flips: render it with `flipWinding`. */
export function mirrorView(o: M4, view: ArrayLike<number>, p: ArrayLike<number>, n: ArrayLike<number>): M4 {
  const r = reflectionMatrix(new Float32Array(16), p[0], p[1], p[2], n[0], n[1], n[2]);
  return Mat4.multiply(o, view as M4, r);
}

/** The world plane through `p` with normal `n` as a view-space plane (a, b, c, d): a*x + b*y + c*z + d > 0 on the side `n` points to. */
export function planeToView(view: ArrayLike<number>, p: ArrayLike<number>, n: ArrayLike<number>): [number, number, number, number] {
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  const nx = n[0] / l, ny = n[1] / l, nz = n[2] / l;
  const cw = [nx, ny, nz, -(nx * p[0] + ny * p[1] + nz * p[2])];
  const inv = Mat4.invert(Mat4.create(), view as M4);
  if (!inv) return [0, 0, -1, -0.1];
  // plane covectors transform with the inverse transpose of the view matrix
  const c = (i: number) => inv[i * 4] * cw[0] + inv[i * 4 + 1] * cw[1] + inv[i * 4 + 2] * cw[2] + inv[i * 4 + 3] * cw[3];
  return [c(0), c(1), c(2), c(3)];
}

/**
 * Replace the near plane of a perspective projection (depth [0, 1]) with the view-space `plane` (Lengyel's oblique frustum, adapted to
 * [0, 1] depth) so nothing on its negative side is drawn - the camera must be on the negative side. The far plane is kept.
 */
export function obliqueProjection(o: M4, proj: ArrayLike<number>, plane: ArrayLike<number>): M4 {
  for (let i = 0; i < 16; i++) o[i] = proj[i];
  const inv = Mat4.invert(Mat4.create(), proj as M4);
  if (!inv) return o;
  const sx = plane[0] >= 0 ? 1 : -1, sy = plane[1] >= 0 ? 1 : -1;
  // far-plane frustum corner farthest along the plane normal, in view space
  const q = [0, 1, 2, 3].map((r) => inv[r] * sx + inv[4 + r] * sy + inv[8 + r] + inv[12 + r]);
  const qx = q[0] / q[3], qy = q[1] / q[3], qz = q[2] / q[3];
  const dot = plane[0] * qx + plane[1] * qy + plane[2] * qz + plane[3];
  if (Math.abs(dot) < 1e-9) return o;
  const k = -qz / dot;                        // makes the corner map to depth 1 (z_clip = w_clip = -z_view)
  o[2] = k * plane[0]; o[6] = k * plane[1]; o[10] = k * plane[2]; o[14] = k * plane[3];
  return o;
}

/** Mirror the image horizontally (negate the x scale). Cube-map faces use it: their texture space has the opposite handedness. */
export function flipX(o: M4, proj: ArrayLike<number>): M4 {
  for (let i = 0; i < 16; i++) o[i] = proj[i];
  o[0] = -o[0];
  return o;
}

/** Look direction and up vector of the six cube-map faces in WebGPU layer order (+X, -X, +Y, -Y, +Z, -Z). */
export const CUBE_FACES: readonly { forward: readonly [number, number, number]; up: readonly [number, number, number] }[] = [
  { forward: [1, 0, 0], up: [0, 1, 0] },
  { forward: [-1, 0, 0], up: [0, 1, 0] },
  { forward: [0, 1, 0], up: [0, 0, -1] },
  { forward: [0, -1, 0], up: [0, 0, 1] },
  { forward: [0, 0, 1], up: [0, 1, 0] },
  { forward: [0, 0, -1], up: [0, 1, 0] },
];

/** View matrix of cube face `face` (0..5) for a camera at (ex, ey, ez). Pair it with {@link cubeFaceProjection}. */
export function cubeFaceView(o: M4, face: number, ex: number, ey: number, ez: number): M4 {
  const f = CUBE_FACES[face];
  return Mat4.lookAt(o, ex, ey, ez, ex + f.forward[0], ey + f.forward[1], ez + f.forward[2], f.up[0], f.up[1], f.up[2]);
}

/** 90 degree square projection for cube faces, mirrored horizontally to match the cube-map texture convention. */
export function cubeFaceProjection(o: M4, near: number, far: number): M4 {
  return flipX(o, Mat4.perspective(Mat4.create(), Math.PI / 2, 1, near, far));
}
