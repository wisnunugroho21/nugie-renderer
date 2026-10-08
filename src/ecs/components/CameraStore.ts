import { ComponentStore, growF32 } from '../ComponentStore';

/** Perspective camera parameters; pose comes from the entity's transform. */
export class CameraStore extends ComponentStore {
  fovY = new Float32Array(0);
  near = new Float32Array(0);
  far = new Float32Array(0);

  /** Grow the camera parameter arrays. */
  protected grow(n: number): void { this.fovY = growF32(this.fovY, n); this.near = growF32(this.near, n); this.far = growF32(this.far, n); }
  /** Zero the entity's camera parameters. */
  protected reset(i: number): void { this.fovY[i] = 0; this.near[i] = 0; this.far[i] = 0; }

  /** Make the entity a perspective camera (`fovY` radians, near / far clip distances). The first camera entity is the active one. */
  add(i: number, fovY = Math.PI / 4, near = 0.1, far = 1000): void {
    this.ensureCapacity(i + 1);
    this.has.set(i);
    this.fovY[i] = fovY; this.near[i] = near; this.far[i] = far;
  }
}
