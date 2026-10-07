import { Pose, PoseLayout } from './Pose';
import { slerpInto } from './AnimationSampler';

/**
 * Per-node blend weights for layers / partial blends. `bones[n]` scales how much of a layer affects node n (0..1);
 * `morph[n]` does the same for the morph weights owned by node n (defaults to `bones` when omitted).
 */
export interface PoseMask { bones: Float32Array; morph?: Float32Array; }

/** Build a bone mask: 1 (or `weight`) for `roots` and (optionally) all their descendants, 0 elsewhere. */
export function buildBoneMask(layout: PoseLayout, roots: number[], opts: { descendants?: boolean; weight?: number } = {}): PoseMask {
  const w = opts.weight ?? 1, bones = new Float32Array(layout.nodeCount), inSet = new Uint8Array(layout.nodeCount);
  for (const r of roots) inSet[r] = 1;
  if (opts.descendants ?? true) {
    for (let k = 0; k < layout.order.length; k++) {
      const n = layout.order[k], p = layout.parent[n];
      if (p >= 0 && inSet[p]) inSet[n] = 1; // parents precede children, so one pass suffices
    }
  }
  for (let n = 0; n < layout.nodeCount; n++) if (inSet[n]) bones[n] = w;
  return { bones };
}

/** Mask that selects only the morph weights of `nodes` (e.g. a facial layer driving the head mesh node). */
export function buildMorphMask(layout: PoseLayout, nodes: number[], weight = 1): PoseMask {
  const morph = new Float32Array(layout.nodeCount);
  for (const n of nodes) morph[n] = weight;
  return { bones: new Float32Array(layout.nodeCount), morph };
}

/** out = lerp(a, b, w) per node (translation/scale/morph linear, rotation slerp). Aliasing out === a or out === b is allowed. */
export function blendPoses(out: Pose, a: Pose, b: Pose, w: number, mask?: PoseMask): void {
  const layout = a.layout;
  for (let n = 0; n < layout.nodeCount; n++) {
    const bw = w * (mask ? mask.bones[n] : 1);
    const mw = w * (mask ? (mask.morph ? mask.morph[n] : mask.bones[n]) : 1);
    if (bw === 0) {
      if (out !== a) copyNode(out, a, n, false);
    } else {
      const t = n * 3, q = n * 4;
      for (let c = 0; c < 3; c++) {
        out.t[t + c] = a.t[t + c] + (b.t[t + c] - a.t[t + c]) * bw;
        out.s[t + c] = a.s[t + c] + (b.s[t + c] - a.s[t + c]) * bw;
      }
      slerpInto(out.r, q, a.r, q, b.r, q, bw);
    }
    const mc = layout.morphCount[n];
    if (mc > 0) {
      const o = layout.morphOffset[n];
      for (let k = 0; k < mc; k++) out.w[o + k] = a.w[o + k] + (b.w[o + k] - a.w[o + k]) * mw;
    }
  }
}

function copyNode(out: Pose, src: Pose, n: number, morph: boolean): void {
  const t = n * 3, q = n * 4;
  out.t[t] = src.t[t]; out.t[t + 1] = src.t[t + 1]; out.t[t + 2] = src.t[t + 2];
  out.s[t] = src.s[t]; out.s[t + 1] = src.s[t + 1]; out.s[t + 2] = src.s[t + 2];
  out.r[q] = src.r[q]; out.r[q + 1] = src.r[q + 1]; out.r[q + 2] = src.r[q + 2]; out.r[q + 3] = src.r[q + 3];
  if (morph) { const mc = src.layout.morphCount[n], o = src.layout.morphOffset[n]; for (let k = 0; k < mc; k++) out.w[o + k] = src.w[o + k]; }
}

/**
 * Additive "difference" pose: how `pose` deviates from `reference`.
 *   translation: pose - ref      rotation: pose * inverse(ref)      scale: pose / ref      weights: pose - ref
 */
export function makeAdditive(out: Pose, pose: Pose, reference: Pose): void {
  const layout = pose.layout;
  for (let n = 0; n < layout.nodeCount; n++) {
    const t = n * 3, q = n * 4;
    for (let c = 0; c < 3; c++) {
      out.t[t + c] = pose.t[t + c] - reference.t[t + c];
      out.s[t + c] = reference.s[t + c] !== 0 ? pose.s[t + c] / reference.s[t + c] : 1;
    }
    // delta = pose * conj(ref)
    const rx = -reference.r[q], ry = -reference.r[q + 1], rz = -reference.r[q + 2], rw = reference.r[q + 3];
    const px = pose.r[q], py = pose.r[q + 1], pz = pose.r[q + 2], pw = pose.r[q + 3];
    out.r[q] = pw * rx + px * rw + py * rz - pz * ry;
    out.r[q + 1] = pw * ry - px * rz + py * rw + pz * rx;
    out.r[q + 2] = pw * rz + px * ry - py * rx + pz * rw;
    out.r[q + 3] = pw * rw - px * rx - py * ry - pz * rz;
  }
  for (let i = 0; i < pose.w.length; i++) out.w[i] = pose.w[i] - reference.w[i];
}

const IDENTITY_Q = new Float32Array([0, 0, 0, 1]);
const tmpQ = new Float32Array(4);

/** out = base (+) delta * weight, optionally masked per node. Aliasing out === base is allowed. */
export function applyAdditive(out: Pose, base: Pose, delta: Pose, weight: number, mask?: PoseMask): void {
  const layout = base.layout;
  for (let n = 0; n < layout.nodeCount; n++) {
    const bw = weight * (mask ? mask.bones[n] : 1);
    const mw = weight * (mask ? (mask.morph ? mask.morph[n] : mask.bones[n]) : 1);
    if (bw === 0) { if (out !== base) copyNode(out, base, n, false); }
    else {
      const t = n * 3, q = n * 4;
      for (let c = 0; c < 3; c++) {
        out.t[t + c] = base.t[t + c] + delta.t[t + c] * bw;
        out.s[t + c] = base.s[t + c] * (1 + (delta.s[t + c] - 1) * bw);
      }
      // scaled delta rotation = slerp(identity, delta, bw); result = scaledDelta * base
      slerpInto(tmpQ, 0, IDENTITY_Q, 0, delta.r, q, bw);
      const dx = tmpQ[0], dy = tmpQ[1], dz = tmpQ[2], dw = tmpQ[3];
      const bx = base.r[q], by = base.r[q + 1], bz = base.r[q + 2], bwq = base.r[q + 3];
      out.r[q] = dw * bx + dx * bwq + dy * bz - dz * by;
      out.r[q + 1] = dw * by - dx * bz + dy * bwq + dz * bx;
      out.r[q + 2] = dw * bz + dx * by - dy * bx + dz * bwq;
      out.r[q + 3] = dw * bwq - dx * bx - dy * by - dz * bz;
    }
    const mc = layout.morphCount[n];
    if (mc > 0) {
      const o = layout.morphOffset[n];
      for (let k = 0; k < mc; k++) out.w[o + k] = base.w[o + k] + delta.w[o + k] * mw;
    }
  }
}
