import { Mat4 } from '../math/Mat4';
import { Frustum } from '../math/Frustum';

const TMP = new Float32Array(16);

/** Perspective camera. Owns CPU-side matrices only; GPU upload is done by the renderer. */
export class Camera {
  position = new Float32Array([0, 0, 5]);
  target = new Float32Array([0, 0, 0]);
  fovY = Math.PI / 4;
  near = 0.1;
  far = 1000;
  aspect = 1;

  readonly view = Mat4.create();
  readonly projection = Mat4.create();
  readonly viewProjection = Mat4.create();
  readonly frustum = new Frustum();

  /** Orbit around target by yaw/pitch (radians) at the given distance. */
  orbit(yaw: number, pitch: number, distance: number): this {
    const cp = Math.cos(pitch);
    this.position[0] = this.target[0] + distance * cp * Math.sin(yaw);
    this.position[1] = this.target[1] + distance * Math.sin(pitch);
    this.position[2] = this.target[2] + distance * cp * Math.cos(yaw);
    return this;
  }

  /** Configure from a camera entity's world matrix (view = inverse of it). Returns false if singular. */
  setFromWorldMatrix(world: ArrayLike<number>, off: number, fovY: number, aspect: number, near: number, far: number): boolean {
    const m = TMP;
    for (let i = 0; i < 16; i++) m[i] = world[off + i];
    if (!Mat4.invert(this.view, m)) return false;
    this.position[0] = m[12]; this.position[1] = m[13]; this.position[2] = m[14];
    this.fovY = fovY; this.aspect = aspect; this.near = near; this.far = far;
    Mat4.perspective(this.projection, fovY, aspect, near, far);
    Mat4.multiply(this.viewProjection, this.projection, this.view);
    this.frustum.setFromViewProjection(this.viewProjection);
    return true;
  }

  /**
   * Use explicit matrices (planar mirrors, orthographic maps, cube faces ...). `position`, `fovY` and `aspect` are derived from them
   * (so LOD and sorting keep working); `near` / `far` must match the projection.
   */
  setMatrices(view: ArrayLike<number>, projection: ArrayLike<number>, near: number, far: number): this {
    this.view.set(view as Float32Array);
    this.projection.set(projection as Float32Array);
    this.near = near; this.far = far;
    Mat4.multiply(this.viewProjection, this.projection, this.view);
    this.frustum.setFromViewProjection(this.viewProjection);
    const inv = Mat4.invert(TMP, this.view);
    if (inv) { this.position[0] = inv[12]; this.position[1] = inv[13]; this.position[2] = inv[14]; }
    const p5 = Math.abs(this.projection[5]);
    if (p5 > 1e-6) { this.fovY = 2 * Math.atan(1 / p5); this.aspect = p5 / (Math.abs(this.projection[0]) || p5); }
    return this;
  }

  /** Orthographic top-down map camera (looking down -Y, -Z at the top of the image) centred on (cx, cz), covering `halfWidth` world units left and right of it. */
  topDownOrthographic(cx: number, cz: number, halfWidth: number, aspect = 1, height = 100, near = 0.1, far = 400): this {
    const view = Mat4.lookAt(Mat4.create(), cx, height, cz, cx, 0, cz, 0, 0, -1);
    const proj = Mat4.ortho(Mat4.create(), -halfWidth, halfWidth, -halfWidth / aspect, halfWidth / aspect, near, far);
    return this.setMatrices(view, proj, near, far);
  }

  /** Recompute view, projection, view-projection and frustum from `position`, `target`, `fovY`, `aspect`, `near` and `far`. */
  update(): this {
    const p = this.position, t = this.target;
    Mat4.lookAt(this.view, p[0], p[1], p[2], t[0], t[1], t[2]);
    Mat4.perspective(this.projection, this.fovY, this.aspect, this.near, this.far);
    Mat4.multiply(this.viewProjection, this.projection, this.view);
    this.frustum.setFromViewProjection(this.viewProjection);
    return this;
  }
}
