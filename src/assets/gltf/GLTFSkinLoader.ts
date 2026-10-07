import type { GLTFDocument } from './GLTFParser';
import { GLTFError } from './GLTFParser';
import { readAccessorFloat, readAccessorUint } from './Accessors';
import type { SkinAsset } from '../AssetTypes';

/** Parse skin.joints / inverseBindMatrices / skeleton. */
export function loadSkins(doc: GLTFDocument): SkinAsset[] {
  return (doc.json.skins ?? []).map((s, i) => {
    if (!s.joints?.length) throw new GLTFError(`Skin ${i} has no joints`);
    let ibm: Float32Array;
    if (s.inverseBindMatrices !== undefined) {
      const r = readAccessorFloat(doc, s.inverseBindMatrices);
      if (r.count < s.joints.length) throw new GLTFError(`Skin ${i}: inverseBindMatrices count (${r.count}) < joint count (${s.joints.length})`);
      ibm = r.data.subarray(0, s.joints.length * 16).slice();
    } else {
      ibm = new Float32Array(s.joints.length * 16);
      for (let j = 0; j < s.joints.length; j++) ibm[j * 16] = ibm[j * 16 + 5] = ibm[j * 16 + 10] = ibm[j * 16 + 15] = 1;
    }
    return { name: s.name ?? `skin${i}`, joints: s.joints.slice(), inverseBindMatrices: ibm, skeleton: s.skeleton ?? -1 };
  });
}

/**
 * Read JOINTS_n (as u16) and WEIGHTS_n (normalized floats). Weights are renormalized so each vertex sums to 1
 * (vertices with all-zero weights are bound fully to joint 0 of their set).
 */
export function readSkinAttributes(doc: GLTFDocument, jointsAccessor: number, weightsAccessor: number): { joints: Uint16Array; weights: Float32Array } {
  const j = readAccessorUint(doc, jointsAccessor);
  const w = readAccessorFloat(doc, weightsAccessor);
  if (j.count !== w.count) throw new GLTFError('JOINTS/WEIGHTS accessor counts differ');
  const joints = new Uint16Array(j.count * 4);
  for (let i = 0; i < joints.length; i++) joints[i] = j.data[i];
  return { joints, weights: normalizeWeights(w.data) };
}

export function normalizeWeights(weights: Float32Array): Float32Array {
  const out = new Float32Array(weights);
  for (let v = 0; v < out.length; v += 4) {
    const sum = out[v] + out[v + 1] + out[v + 2] + out[v + 3];
    if (sum > 1e-8) { const inv = 1 / sum; out[v] *= inv; out[v + 1] *= inv; out[v + 2] *= inv; out[v + 3] *= inv; }
    else { out[v] = 1; out[v + 1] = out[v + 2] = out[v + 3] = 0; }
  }
  return out;
}
