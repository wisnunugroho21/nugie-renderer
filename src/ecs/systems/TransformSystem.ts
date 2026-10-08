import { Mat4 } from '../../math/Mat4';
import type { TransformStore } from '../components/TransformStore';

/**
 * Recomputes world matrices ONLY for changed transforms and their descendants.
 * Dirty entries are processed shallowest-first; a descendant that is itself dirty is
 * covered by its ancestor's subtree pass (stamp check), so each matrix is computed once.
 */
export class TransformSystem {
  /** Matrices recomputed in the last update() (benchmark metric). */
  matricesUpdated = 0;
  /** Entity indices whose world matrix changed in the last update() (for sparse GPU upload). */
  updated: number[] = [];

  private stamp = new Uint32Array(0);
  private pass = 0;
  private stack: number[] = [];
  private keys = new Int32Array(0);

  /** Create the system over a transform store. */
  constructor(private t: TransformStore) {}

  /** Recompute world matrices of all dirty transforms and their descendants (shallowest first), then clear the dirty list. */
  update(): void {
    const t = this.t;
    this.matricesUpdated = 0;
    this.updated.length = 0;
    if (this.stamp.length < t.dirty.length) { const s = new Uint32Array(t.dirty.length); s.set(this.stamp); this.stamp = s; }
    const list = t.dirtyList;
    if (list.length === 0) return;
    this.pass++;

    // Shallowest first: key = depth << 20 | index (depth < 2^11, index < 2^20).
    if (this.keys.length < list.length) this.keys = new Int32Array(Math.max(list.length, this.keys.length * 2));
    let n = 0;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (t.dirty[i] === 1 && t.has.has(i)) this.keys[n++] = (Math.min(t.depth[i], 2047) << 20) | i;
    }
    const keys = this.keys.subarray(0, n);
    keys.sort();

    for (let k = 0; k < n; k++) {
      const root = keys[k] & 0xfffff;
      if (this.stamp[root] === this.pass) continue; // already handled via an ancestor
      this.updateSubtree(root);
    }
    for (let k = 0; k < list.length; k++) t.dirty[list[k]] = 0;
    list.length = 0;
  }

  /** Depth-first recompute of `root` and all its descendants, stamping each so it is not processed twice this pass. */
  private updateSubtree(root: number): void {
    const t = this.t, stack = this.stack;
    stack.length = 0;
    stack.push(root);
    while (stack.length > 0) {
      const i = stack.pop()!;
      this.compute(i);
      this.stamp[i] = this.pass;
      for (let c = t.firstChild[i]; c !== -1; c = t.nextSibling[c]) stack.push(c);
    }
  }

  /** Compute entity `i`'s world matrix: local TRS, multiplied by the parent's world matrix when it has one. */
  private compute(i: number): void {
    const t = this.t, w = t.worldMatrices;
    const p = t.parent[i];
    if (p === -1) {
      Mat4.compose(w, t.positionX[i], t.positionY[i], t.positionZ[i], t.rotationX[i], t.rotationY[i], t.rotationZ[i], t.rotationW[i],
        t.scaleX[i], t.scaleY[i], t.scaleZ[i], i * 16);
    } else {
      Mat4.compose(LOCAL, t.positionX[i], t.positionY[i], t.positionZ[i], t.rotationX[i], t.rotationY[i], t.rotationZ[i], t.rotationW[i],
        t.scaleX[i], t.scaleY[i], t.scaleZ[i]);
      mulInto(w, i * 16, w, p * 16, LOCAL);
    }
    this.matricesUpdated++;
    this.updated.push(i);
  }
}

const LOCAL = new Float32Array(16);

/** out[oo..] = a[ao..] * b (b is a standalone 16-float matrix). */
function mulInto(out: Float32Array, oo: number, a: Float32Array, ao: number, b: Float32Array): void {
  const a00 = a[ao], a01 = a[ao + 1], a02 = a[ao + 2], a03 = a[ao + 3], a10 = a[ao + 4], a11 = a[ao + 5], a12 = a[ao + 6], a13 = a[ao + 7],
    a20 = a[ao + 8], a21 = a[ao + 9], a22 = a[ao + 10], a23 = a[ao + 11], a30 = a[ao + 12], a31 = a[ao + 13], a32 = a[ao + 14], a33 = a[ao + 15];
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[oo + c * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[oo + c * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[oo + c * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[oo + c * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
}
