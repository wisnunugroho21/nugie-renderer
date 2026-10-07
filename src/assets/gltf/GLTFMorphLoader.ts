import type { GLTFDocument } from './GLTFParser';
import { readAccessorFloat } from './Accessors';
import type { MorphTargetData } from '../AssetTypes';
import type { GLTFPrimitive } from './GLTFTypes';

/**
 * Parse morph targets of a primitive as DELTAS (never duplicated meshes).
 * Per glTF, targets can omit attributes; omitted attributes mean zero delta (left undefined here).
 */
export function loadMorphTargets(doc: GLTFDocument, prim: GLTFPrimitive, vertexCount: number): MorphTargetData[] {
  if (!prim.targets?.length) return [];
  return prim.targets.map((t) => {
    const out: MorphTargetData = {};
    const read = (acc: number | undefined): Float32Array | undefined => {
      if (acc === undefined) return undefined;
      const r = readAccessorFloat(doc, acc);
      if (r.count !== vertexCount) throw new Error(`Morph target accessor count ${r.count} != vertex count ${vertexCount}`);
      return r.data;
    };
    out.position = read(t.POSITION);
    out.normal = read(t.NORMAL);
    out.tangent = read(t.TANGENT); // glTF tangent deltas are VEC3 (w unchanged)
    return out;
  });
}

/** Remap per-vertex delta arrays (3 floats/vertex) after vertices are duplicated/reordered. */
export function remapMorphTargets(targets: MorphTargetData[], indexMap: Uint32Array): MorphTargetData[] {
  const remap = (a?: Float32Array): Float32Array | undefined => {
    if (!a) return undefined;
    const o = new Float32Array(indexMap.length * 3);
    for (let i = 0; i < indexMap.length; i++) { const s = indexMap[i] * 3; o[i * 3] = a[s]; o[i * 3 + 1] = a[s + 1]; o[i * 3 + 2] = a[s + 2]; }
    return o;
  };
  return targets.map((t) => ({ position: remap(t.position), normal: remap(t.normal), tangent: remap(t.tangent) }));
}
