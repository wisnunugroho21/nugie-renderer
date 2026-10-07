import type { GLTFDocument } from './GLTFParser';
import { readAccessorFloat, readAccessorUint } from './Accessors';
import { readSkinAttributes } from './GLTFSkinLoader';
import { loadMorphTargets, remapMorphTargets } from './GLTFMorphLoader';
import type { MeshAsset, PrimitiveAsset } from '../AssetTypes';
import type { GLTFPrimitive } from './GLTFTypes';
import { STANDARD_VERTEX_FLOATS } from '../../rendering/VertexLayouts';

/** Convert triangle strip/fan index sequences to a plain triangle list. */
export function toTriangleList(indices: Uint32Array, mode: number): Uint32Array {
  if (mode === 4) {
    return indices.length % 3 === 0 ? indices : indices.subarray(0, indices.length - (indices.length % 3));
  }
  const tris = Math.max(0, indices.length - 2);
  const out = new Uint32Array(tris * 3);
  for (let i = 0; i < tris; i++) {
    if (mode === 5) { // strip: alternate winding to keep CCW
      const even = (i & 1) === 0;
      out[i * 3] = even ? indices[i] : indices[i + 1]; out[i * 3 + 1] = even ? indices[i + 1] : indices[i]; out[i * 3 + 2] = indices[i + 2];
    } else { // fan
      out[i * 3] = indices[0]; out[i * 3 + 1] = indices[i + 1]; out[i * 3 + 2] = indices[i + 2];
    }
  }
  return out;
}

function remap<T extends Float32Array | Uint16Array>(src: T, indexMap: Uint32Array, comps: number): T {
  const o = new (src.constructor as new (n: number) => T)(indexMap.length * comps);
  for (let i = 0; i < indexMap.length; i++) for (let c = 0; c < comps; c++) o[i * comps + c] = src[indexMap[i] * comps + c];
  return o;
}

/** Flat normals: requires unshared vertices (every 3 consecutive vertices form a triangle). */
export function computeFlatNormals(positions: Float32Array): Float32Array {
  const n = new Float32Array(positions.length);
  for (let t = 0; t + 8 < positions.length; t += 9) {
    const ax = positions[t + 3] - positions[t], ay = positions[t + 4] - positions[t + 1], az = positions[t + 5] - positions[t + 2];
    const bx = positions[t + 6] - positions[t], by = positions[t + 7] - positions[t + 1], bz = positions[t + 8] - positions[t + 2];
    let x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    for (let k = 0; k < 3; k++) { n[t + k * 3] = x; n[t + k * 3 + 1] = y; n[t + k * 3 + 2] = z; }
  }
  return n;
}

/** Load one primitive into engine geometry. Returns null (with a warning) for unsupported modes. */
export function loadPrimitive(doc: GLTFDocument, prim: GLTFPrimitive, warn: (m: string) => void, label: string): PrimitiveAsset | null {
  const mode = prim.mode ?? 4;
  if (mode < 4) { warn(`${label}: primitive mode ${mode} (points/lines) is not supported; skipped`); return null; }
  if (prim.attributes.POSITION === undefined) { warn(`${label}: primitive without POSITION skipped`); return null; }

  const pos = readAccessorFloat(doc, prim.attributes.POSITION);
  const vcount = pos.count;
  let positions = pos.data;
  let normals = prim.attributes.NORMAL !== undefined ? readAccessorFloat(doc, prim.attributes.NORMAL).data : null;
  let uvs = prim.attributes.TEXCOORD_0 !== undefined ? readAccessorFloat(doc, prim.attributes.TEXCOORD_0).data : null;
  let tangents = prim.attributes.TANGENT !== undefined ? readAccessorFloat(doc, prim.attributes.TANGENT).data : null;
  let joints0: Uint16Array | undefined, weights0: Float32Array | undefined, joints1: Uint16Array | undefined, weights1: Float32Array | undefined;
  if (prim.attributes.JOINTS_0 !== undefined && prim.attributes.WEIGHTS_0 !== undefined) {
    ({ joints: joints0, weights: weights0 } = readSkinAttributes(doc, prim.attributes.JOINTS_0, prim.attributes.WEIGHTS_0));
  }
  if (prim.attributes.JOINTS_1 !== undefined && prim.attributes.WEIGHTS_1 !== undefined) {
    ({ joints: joints1, weights: weights1 } = readSkinAttributes(doc, prim.attributes.JOINTS_1, prim.attributes.WEIGHTS_1));
  }
  let morph = loadMorphTargets(doc, prim, vcount);

  let rawIndices: Uint32Array;
  if (prim.indices !== undefined) rawIndices = readAccessorUint(doc, prim.indices).data;
  else { rawIndices = new Uint32Array(vcount); for (let i = 0; i < vcount; i++) rawIndices[i] = i; }
  let indices = toTriangleList(rawIndices, mode);
  for (let i = 0; i < indices.length; i++) if (indices[i] >= vcount) { warn(`${label}: index ${indices[i]} out of range; primitive skipped`); return null; }

  // glTF: missing normals => flat shading. That needs unshared vertices.
  if (!normals) {
    const map = indices;
    positions = remap(positions, map, 3);
    uvs = uvs ? remap(uvs, map, 2) : null;
    tangents = tangents ? remap(tangents, map, 4) : null;
    if (joints0) joints0 = remap(joints0, map, 4);
    if (weights0) weights0 = remap(weights0, map, 4);
    if (joints1) joints1 = remap(joints1, map, 4);
    if (weights1) weights1 = remap(weights1, map, 4);
    morph = remapMorphTargets(morph, map);
    normals = computeFlatNormals(positions);
    indices = Uint32Array.from({ length: map.length }, (_, i) => i);
  }

  const n = positions.length / 3;
  const verts = new Float32Array(n * STANDARD_VERTEX_FLOATS);
  for (let i = 0; i < n; i++) {
    const o = i * STANDARD_VERTEX_FLOATS;
    verts[o] = positions[i * 3]; verts[o + 1] = positions[i * 3 + 1]; verts[o + 2] = positions[i * 3 + 2];
    verts[o + 3] = normals[i * 3]; verts[o + 4] = normals[i * 3 + 1]; verts[o + 5] = normals[i * 3 + 2];
    if (uvs) { verts[o + 6] = uvs[i * 2]; verts[o + 7] = uvs[i * 2 + 1]; }
    if (tangents) { verts[o + 8] = tangents[i * 4]; verts[o + 9] = tangents[i * 4 + 1]; verts[o + 10] = tangents[i * 4 + 2]; verts[o + 11] = tangents[i * 4 + 3]; }
  }
  return {
    mesh: { vertices: verts, indices }, materialIndex: prim.material ?? -1, hasTangents: tangents !== null,
    joints0, weights0, joints1, weights1, morphTargets: morph.length ? morph : undefined,
  };
}

export function loadMeshes(doc: GLTFDocument, warn: (m: string) => void): MeshAsset[] {
  return (doc.json.meshes ?? []).map((m, mi) => {
    const prims: PrimitiveAsset[] = [];
    m.primitives.forEach((p, pi) => {
      const a = loadPrimitive(doc, p, warn, `mesh ${mi}/primitive ${pi}`);
      if (a) prims.push(a);
    });
    return { name: m.name ?? `mesh${mi}`, primitives: prims, defaultMorphWeights: m.weights ? Float32Array.from(m.weights) : null };
  });
}
