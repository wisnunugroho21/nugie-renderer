import { ComponentStore, growF32 } from '../ComponentStore';

/**
 * Local-space AABB plus cached world-space AABB and bounding sphere.
 * World bounds are recomputed by BoundsSystem only for transforms that changed.
 */
export class BoundsStore extends ComponentStore {
  /** minXYZ, maxXYZ per entity (6 floats). */
  local = new Float32Array(0);
  world = new Float32Array(0);
  /** centerXYZ, radius per entity (4 floats). */
  sphere = new Float32Array(0);
  /** Extra conservative world-space padding (animated bounds). */
  padding = new Float32Array(0);

  /** Grow the local / world AABB, sphere and padding arrays. */
  protected grow(n: number): void {
    this.local = growF32(this.local, n, 6); this.world = growF32(this.world, n, 6);
    this.sphere = growF32(this.sphere, n, 4); this.padding = growF32(this.padding, n);
  }
  /** Zero the entity's bounds. */
  protected reset(i: number): void {
    this.local.fill(0, i * 6, i * 6 + 6); this.world.fill(0, i * 6, i * 6 + 6);
    this.sphere.fill(0, i * 4, i * 4 + 4); this.padding[i] = 0;
  }

  /** Set the entity's LOCAL-space AABB (min/max corners). World bounds are filled in by BoundsSystem once the transform is computed. */
  add(i: number, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void {
    this.ensureCapacity(i + 1);
    this.has.set(i);
    const o = i * 6;
    this.local[o] = minX; this.local[o + 1] = minY; this.local[o + 2] = minZ;
    this.local[o + 3] = maxX; this.local[o + 4] = maxY; this.local[o + 5] = maxZ;
    this.padding[i] = 0;
  }
}
