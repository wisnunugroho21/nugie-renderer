import type { Pose, PoseLayout } from '../Pose';

/**
 * A procedural modification of the final blended pose (IK, look-at, ...). Runs after clip/state/layer blending
 * and before joint matrices are derived (the SkeletonSystem reads the ECS transforms the pose is written to).
 * All IK math is done in MODEL space (the space of the skeleton's root entity) and written back as LOCAL rotations;
 * translations/scales of the pose are never changed by the solvers here.
 */
export interface PoseConstraint {
  /** Nodes this constraint may write (so the controller knows which ECS nodes to update). */
  collectNodes(out: Set<number>): void;
  apply(pose: Pose, dt: number): void;
}

/** Model-space translation / rotation / scale of one node. */
export class Xform {
  readonly p = new Float32Array(3);
  readonly r = new Float32Array([0, 0, 0, 1]);
  readonly s = new Float32Array([1, 1, 1]);
}

let climb = new Int32Array(256);

/** out = model-space transform of `node`, composed from the pose's local TRS up the parent chain. */
export function modelTransform(layout: PoseLayout, pose: Pose, node: number, out: Xform): void {
  let depth = 0;
  for (let n = node; n >= 0; n = layout.parent[n]) {
    if (depth === climb.length) { const c = new Int32Array(climb.length * 2); c.set(climb); climb = c; }
    climb[depth++] = n;
  }
  out.p.fill(0); out.r[0] = out.r[1] = out.r[2] = 0; out.r[3] = 1; out.s.fill(1);
  for (let i = depth - 1; i >= 0; i--) composeLocal(out, pose.t, climb[i] * 3, pose.r, climb[i] * 4, pose.s, climb[i] * 3);
}

const tx = new Float32Array(3);

/** parent <- parent ∘ local (in place). Local TRS read from the given arrays/offsets. */
export function composeLocal(parent: Xform, lt: ArrayLike<number>, to: number, lr: ArrayLike<number>, ro: number, ls: ArrayLike<number>, so: number): void {
  // position: pp + pr * (ps ⊙ lt)
  const x = lt[to] * parent.s[0], y = lt[to + 1] * parent.s[1], z = lt[to + 2] * parent.s[2];
  const qx = parent.r[0], qy = parent.r[1], qz = parent.r[2], qw = parent.r[3];
  const ux = 2 * (qy * z - qz * y), uy = 2 * (qz * x - qx * z), uz = 2 * (qx * y - qy * x);
  tx[0] = x + qw * ux + (qy * uz - qz * uy);
  tx[1] = y + qw * uy + (qz * ux - qx * uz);
  tx[2] = z + qw * uz + (qx * uy - qy * ux);
  parent.p[0] += tx[0]; parent.p[1] += tx[1]; parent.p[2] += tx[2];
  // rotation: pr * lr
  const bx = lr[ro], by = lr[ro + 1], bz = lr[ro + 2], bw = lr[ro + 3];
  const nx = qw * bx + qx * bw + qy * bz - qz * by;
  const ny = qw * by - qx * bz + qy * bw + qz * bx;
  const nz = qw * bz + qx * by - qy * bx + qz * bw;
  const nw = qw * bw - qx * bx - qy * by - qz * bz;
  parent.r[0] = nx; parent.r[1] = ny; parent.r[2] = nz; parent.r[3] = nw;
  parent.s[0] *= ls[so]; parent.s[1] *= ls[so + 1]; parent.s[2] *= ls[so + 2];
}

/** Copy translation, rotation and scale of `src` into `dst`. */
export function copyXform(dst: Xform, src: Xform): void { dst.p.set(src.p); dst.r.set(src.r); dst.s.set(src.s); }

/** Verify `chain` is a parent->child chain (each entry's parent is the previous entry). */
export function assertChain(layout: PoseLayout, chain: number[], what: string): void {
  for (let i = 1; i < chain.length; i++) {
    if (layout.parent[chain[i]] !== chain[i - 1]) throw new Error(`${what}: node ${chain[i]} is not a child of node ${chain[i - 1]}`);
  }
}
