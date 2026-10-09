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
  private stack = new Int32Array(256);
  /** Dirty entity indices ordered by depth (counting sort), and the per-depth histogram that sorts them. */
  private ordered = new Int32Array(0);
  private depthStart = new Int32Array(MAX_DEPTH + 2);

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

    // Order the dirty entities shallowest first with a counting sort on depth (O(n), no comparison sort): a dirty descendant is
    // then already covered by its ancestor's subtree pass (stamp check) and each matrix is computed once.
    const start = this.depthStart;
    start.fill(0);
    let n = 0;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (t.dirty[i] === 1 && t.has.has(i)) { start[Math.min(t.depth[i], MAX_DEPTH) + 1]++; n++; }
    }
    for (let d = 1; d <= MAX_DEPTH + 1; d++) start[d] += start[d - 1];
    if (this.ordered.length < n) this.ordered = new Int32Array(Math.max(n, this.ordered.length * 2, 256));
    const ordered = this.ordered;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (t.dirty[i] === 1 && t.has.has(i)) ordered[start[Math.min(t.depth[i], MAX_DEPTH)]++] = i;
    }

    for (let k = 0; k < n; k++) {
      const root = ordered[k];
      if (this.stamp[root] === this.pass) continue; // already handled via an ancestor
      this.updateSubtree(root);
    }
    for (let k = 0; k < list.length; k++) t.dirty[list[k]] = 0;
    list.length = 0;
  }

  /** Depth-first recompute of `root` and all its descendants, stamping each so it is not processed twice this pass. */
  private updateSubtree(root: number): void {
    const t = this.t;
    let stack = this.stack, sp = 0;
    stack[sp++] = root;
    while (sp > 0) {
      const i = stack[--sp];
      this.compute(i);
      this.stamp[i] = this.pass;
      if (sp + 64 > stack.length) { const g = new Int32Array(stack.length * 2); g.set(stack); this.stack = stack = g; }
      for (let c = t.firstChild[i]; c !== -1; c = t.nextSibling[c]) {
        if (sp === stack.length) { const g = new Int32Array(stack.length * 2); g.set(stack); this.stack = stack = g; }
        stack[sp++] = c;
      }
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
      composeUnder(w, i * 16, p * 16, t.positionX[i], t.positionY[i], t.positionZ[i], t.rotationX[i], t.rotationY[i], t.rotationZ[i], t.rotationW[i],
        t.scaleX[i], t.scaleY[i], t.scaleZ[i]);
    }
    this.matricesUpdated++;
    this.updated.push(i);
  }
}

/** Deepest hierarchy level that is ordered exactly; deeper levels share the last bucket (still correct: a descendant visited before its ancestor is simply recomputed by the ancestor's subtree pass). */
const MAX_DEPTH = 2047;

/**
 * w[oo..] = (parent matrix at w[po..]) * T(p) * R(q) * S(s), fused: the local matrix is never materialised and the affine structure
 * (bottom row 0 0 0 1) is used, so a child costs 27 + 12 multiply-adds instead of compose + a full 4x4 product.
 */
function composeUnder(w: Float32Array, oo: number, po: number, px: number, py: number, pz: number,
  qx: number, qy: number, qz: number, qw: number, sx: number, sy: number, sz: number): void {
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  // local rotation * scale columns
  const c0x = (1 - (yy + zz)) * sx, c0y = (xy + wz) * sx, c0z = (xz - wy) * sx;
  const c1x = (xy - wz) * sy, c1y = (1 - (xx + zz)) * sy, c1z = (yz + wx) * sy;
  const c2x = (xz + wy) * sz, c2y = (yz - wx) * sz, c2z = (1 - (xx + yy)) * sz;
  // parent's upper 3x3 columns and translation
  const a00 = w[po], a01 = w[po + 1], a02 = w[po + 2], a10 = w[po + 4], a11 = w[po + 5], a12 = w[po + 6],
    a20 = w[po + 8], a21 = w[po + 9], a22 = w[po + 10], a30 = w[po + 12], a31 = w[po + 13], a32 = w[po + 14];
  w[oo] = c0x * a00 + c0y * a10 + c0z * a20; w[oo + 1] = c0x * a01 + c0y * a11 + c0z * a21; w[oo + 2] = c0x * a02 + c0y * a12 + c0z * a22; w[oo + 3] = 0;
  w[oo + 4] = c1x * a00 + c1y * a10 + c1z * a20; w[oo + 5] = c1x * a01 + c1y * a11 + c1z * a21; w[oo + 6] = c1x * a02 + c1y * a12 + c1z * a22; w[oo + 7] = 0;
  w[oo + 8] = c2x * a00 + c2y * a10 + c2z * a20; w[oo + 9] = c2x * a01 + c2y * a11 + c2z * a21; w[oo + 10] = c2x * a02 + c2y * a12 + c2z * a22; w[oo + 11] = 0;
  w[oo + 12] = px * a00 + py * a10 + pz * a20 + a30; w[oo + 13] = px * a01 + py * a11 + pz * a21 + a31; w[oo + 14] = px * a02 + py * a12 + pz * a22 + a32; w[oo + 15] = 1;
}
