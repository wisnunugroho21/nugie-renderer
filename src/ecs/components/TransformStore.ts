import { ComponentStore, growF32, growI32, growU8 } from '../ComponentStore';
import { hypot4 } from '../../math/hypot';

/**
 * Structure-of-arrays transform store with a parent/child hierarchy.
 * Local TRS in separate component arrays; world matrices in one packed array
 * (16 floats per entity index, column-major) ready for GPU upload.
 */
export class TransformStore extends ComponentStore {
  positionX = new Float32Array(0);
  positionY = new Float32Array(0);
  positionZ = new Float32Array(0);
  rotationX = new Float32Array(0);
  rotationY = new Float32Array(0);
  rotationZ = new Float32Array(0);
  rotationW = new Float32Array(0);
  scaleX = new Float32Array(0);
  scaleY = new Float32Array(0);
  scaleZ = new Float32Array(0);
  worldMatrices = new Float32Array(0);
  /** Parent entity index or -1. */
  parent = new Int32Array(0);
  firstChild = new Int32Array(0);
  nextSibling = new Int32Array(0);
  /** Hierarchy depth (roots = 0). */
  depth = new Int32Array(0);
  /** 1 if the transform needs recomputation. */
  dirty = new Uint8Array(0);

  /** Indices queued for the next TransformSystem.update(). */
  dirtyList: number[] = [];

  /** Grow all TRS, matrix, hierarchy and dirty arrays (new parents / children = -1). */
  protected grow(n: number): void {
    this.positionX = growF32(this.positionX, n); this.positionY = growF32(this.positionY, n); this.positionZ = growF32(this.positionZ, n);
    this.rotationX = growF32(this.rotationX, n); this.rotationY = growF32(this.rotationY, n);
    this.rotationZ = growF32(this.rotationZ, n); this.rotationW = growF32(this.rotationW, n);
    this.scaleX = growF32(this.scaleX, n); this.scaleY = growF32(this.scaleY, n); this.scaleZ = growF32(this.scaleZ, n);
    this.worldMatrices = growF32(this.worldMatrices, n, 16);
    this.parent = growI32(this.parent, n, -1);
    this.firstChild = growI32(this.firstChild, n, -1);
    this.nextSibling = growI32(this.nextSibling, n, -1);
    this.depth = growI32(this.depth, n);
    this.dirty = growU8(this.dirty, n);
  }

  /** Unlink the entity from its parent and turn its children into roots (marked dirty). */
  protected reset(i: number): void {
    this.detach(i);
    // Orphan children (they become roots).
    for (let c = this.firstChild[i]; c !== -1;) {
      const next = this.nextSibling[c];
      this.parent[c] = -1; this.nextSibling[c] = -1;
      this.setDepthRecursive(c, 0);
      this.markDirty(c);
      c = next;
    }
    this.firstChild[i] = -1;
    this.dirty[i] = 0;
  }

  /** Add (or reset) a transform on entity index `i`. */
  add(i: number, px = 0, py = 0, pz = 0): void {
    this.ensureCapacity(i + 1);
    this.has.set(i);
    this.positionX[i] = px; this.positionY[i] = py; this.positionZ[i] = pz;
    this.rotationX[i] = 0; this.rotationY[i] = 0; this.rotationZ[i] = 0; this.rotationW[i] = 1;
    this.scaleX[i] = 1; this.scaleY[i] = 1; this.scaleZ[i] = 1;
    this.parent[i] = -1; this.firstChild[i] = -1; this.nextSibling[i] = -1; this.depth[i] = 0;
    this.markDirty(i);
  }

  /** Queue the transform for recomputation by the next TransformSystem.update() (deduplicated). */
  markDirty(i: number): void {
    if (this.dirty[i] === 0) { this.dirty[i] = 1; this.dirtyList.push(i); }
  }

  /** Set the local position and mark the transform dirty. */
  setPosition(i: number, x: number, y: number, z: number): void {
    this.positionX[i] = x; this.positionY[i] = y; this.positionZ[i] = z; this.markDirty(i);
  }
  /** Set the local rotation from quaternion (x, y, z, w); the input is normalised and a zero quaternion becomes identity. */
  setRotation(i: number, x: number, y: number, z: number, w: number): void {
    // Non-unit quaternions would scale / shear the world matrix: always store a unit quaternion (identity for a zero input).
    const l = hypot4(x, y, z, w);
    if (l > 0) { const k = 1 / l; x *= k; y *= k; z *= k; w *= k; } else { x = y = z = 0; w = 1; }
    this.rotationX[i] = x; this.rotationY[i] = y; this.rotationZ[i] = z; this.rotationW[i] = w; this.markDirty(i);
  }
  /** Set the local scale and mark the transform dirty. */
  setScale(i: number, x: number, y: number, z: number): void {
    this.scaleX[i] = x; this.scaleY[i] = y; this.scaleZ[i] = z; this.markDirty(i);
  }

  /** Reparent `child` under `parent` (-1 = root). Rejects cycles. */
  setParent(child: number, parent: number): void {
    if (parent === child) throw new Error('Cannot parent an entity to itself');
    for (let p = parent; p !== -1; p = this.parent[p]) if (p === child) throw new Error('Reparenting would create a cycle');
    this.detach(child);
    this.parent[child] = parent;
    if (parent !== -1) {
      this.nextSibling[child] = this.firstChild[parent];
      this.firstChild[parent] = child;
    }
    this.setDepthRecursive(child, parent === -1 ? 0 : this.depth[parent] + 1);
    this.markDirty(child);
  }

  /** Remove `i` from its parent's child list (no-op for roots). */
  private detach(i: number): void {
    const p = this.parent[i];
    if (p === -1) return;
    if (this.firstChild[p] === i) this.firstChild[p] = this.nextSibling[i];
    else {
      for (let c = this.firstChild[p]; c !== -1; c = this.nextSibling[c]) {
        if (this.nextSibling[c] === i) { this.nextSibling[c] = this.nextSibling[i]; break; }
      }
    }
    this.parent[i] = -1; this.nextSibling[i] = -1;
  }

  /** Iterative (deep hierarchies must not overflow the call stack). */
  private setDepthRecursive(root: number, rootDepth: number): void {
    const stack = [root];
    this.depth[root] = rootDepth;
    while (stack.length > 0) {
      const i = stack.pop()!;
      for (let c = this.firstChild[i]; c !== -1; c = this.nextSibling[c]) {
        this.depth[c] = this.depth[i] + 1;
        stack.push(c);
      }
    }
  }
}
