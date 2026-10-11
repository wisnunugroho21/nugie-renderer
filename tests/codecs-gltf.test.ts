import { beforeAll, describe, expect, it } from 'vitest';
import { loadGLTF } from '../src/assets/gltf/GLTFLoader';
import { parseGLB, parseGLTF, GLTFError } from '../src/assets/gltf/GLTFParser';
import { readAccessorFloat, readAccessorUint } from '../src/assets/gltf/Accessors';
import { decompressGLTF } from '../src/assets/gltf/GLTFCompression';
import { STANDARD_VERTEX_FLOATS as F } from '../src/rendering/VertexLayouts';
import { buildDracoGLB, buildMeshoptGLB, useVendoredDecoders } from './helpers/codecFixtures';
import { GLBBuilder, addTriangle } from './helpers/glbBuilder';

beforeAll(() => useVendoredDecoders());

/** Largest absolute difference between a mesh asset's attribute and its source array. */
function maxError(vertices: Float32Array, offset: number, comps: number, source: Float32Array): number {
  let worst = 0;
  for (let i = 0; i < source.length / comps; i++) for (let k = 0; k < comps; k++) worst = Math.max(worst, Math.abs(vertices[i * F + offset + k] - source[i * comps + k]));
  return worst;
}

describe('EXT_meshopt_compression', () => {
  it('decodes positions, octahedral normals, uvs and indices', async () => {
    const { glb, source } = await buildMeshoptGLB();
    const asset = await loadGLTF(glb);
    const prim = asset.meshes[0].primitives[0];
    // the index codec may rotate the corners of a triangle (the winding is kept), so compare triangles with their smallest corner first
    const canonical = (indices: ArrayLike<number>) => Array.from({ length: indices.length / 3 }, (_, t) => {
      const c = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]], m = c.indexOf(Math.min(...c));
      return [c[m], c[(m + 1) % 3], c[(m + 2) % 3]].join(',');
    });
    expect(canonical(prim.mesh.indices)).toEqual(canonical(source.indices));
    expect(maxError(prim.mesh.vertices, 0, 3, source.positions)).toBe(0);
    expect(maxError(prim.mesh.vertices, 6, 2, source.uvs)).toBe(0);
    expect(maxError(prim.mesh.vertices, 3, 3, source.normals)).toBeLessThan(0.03);   // 8-bit octahedral encoding
    expect(asset.warnings).toEqual([]);
  });

  it('returns plain glTF: the extension objects are gone and the fallback buffer is never read', async () => {
    const { glb } = await buildMeshoptGLB();
    const doc = await parseGLTF(glb);
    for (const view of doc.json.bufferViews!) expect(view.extensions?.EXT_meshopt_compression).toBeUndefined();
    const decoded = doc.json.bufferViews![doc.json.bufferViews!.length - 1];
    expect(doc.buffers[decoded.buffer].byteLength).toBeGreaterThanOrEqual(decoded.byteOffset! + decoded.byteLength);
    expect(doc.buffers[1].byteLength).toBe(0);   // the uncompressed fallback was skipped, not loaded
  });

  it('rejects a corrupt stream with a GLTFError', async () => {
    const b = new GLBBuilder();
    b.view(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    b.json.bufferViews.push({ buffer: 0, byteLength: 24, byteStride: 12, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: 8, byteStride: 12, count: 2, mode: 'ATTRIBUTES', filter: 'NONE' } } });
    await expect(decompressGLTF(b.json, [new Uint8Array(64)])).rejects.toThrow(GLTFError);
  });

  it('rejects a stream that lies outside its buffer', async () => {
    const b = new GLBBuilder();
    b.json.bufferViews.push({ buffer: 0, byteLength: 24, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 60, byteLength: 40, byteStride: 12, count: 2, mode: 'ATTRIBUTES' } } });
    await expect(decompressGLTF(b.json, [new Uint8Array(64)])).rejects.toThrow(/exceeds its buffer/);
  });
});

describe('KHR_draco_mesh_compression', () => {
  it('decodes attributes and indices within the quantisation error', async () => {
    const { glb, source, stream } = await buildDracoGLB();
    const asset = await loadGLTF(glb);
    const prim = asset.meshes[0].primitives[0];
    expect(prim.mesh.vertices.length / F).toBe(stream.vertexCount);
    expect(prim.mesh.indices.length).toBe(stream.faceCount * 3);   // Draco drops the sphere's degenerate pole triangles
    // Draco reorders vertices, so compare geometry through the triangles: every decoded triangle must be a source triangle (14-bit position quantisation)
    // a position is identified by the first source vertex within 1e-3 of it (the sphere has duplicated seam / pole vertices)
    const canon = (x: number, y: number, z: number) => {
      for (let j = 0; j < source.vertexCount; j++) {
        if (Math.hypot(source.positions[j * 3] - x, source.positions[j * 3 + 1] - y, source.positions[j * 3 + 2] - z) < 1e-3) return j;
      }
      return -1;
    };
    const sourceId = Array.from({ length: source.vertexCount }, (_, j) => canon(source.positions[j * 3], source.positions[j * 3 + 1], source.positions[j * 3 + 2]));
    const decodedId = Array.from({ length: stream.vertexCount }, (_, i) => canon(prim.mesh.vertices[i * F], prim.mesh.vertices[i * F + 1], prim.mesh.vertices[i * F + 2]));
    expect(decodedId).not.toContain(-1);   // every decoded position is within 1e-3 of a source position
    const triangle = (ids: number[], indices: ArrayLike<number>, t: number) => [0, 1, 2].map((k) => ids[indices[t + k]]).sort((a, b) => a - b).join(',');
    const wanted = new Set<string>();
    for (let t = 0; t < source.indices.length; t += 3) wanted.add(triangle(sourceId, source.indices, t));
    let matches = 0;
    for (let t = 0; t < prim.mesh.indices.length; t += 3) if (wanted.has(triangle(decodedId, prim.mesh.indices, t))) matches++;
    expect(matches).toBe(stream.faceCount);
    for (let i = 0; i < stream.vertexCount; i++) {
      const o = i * F, len = Math.hypot(prim.mesh.vertices[o + 3], prim.mesh.vertices[o + 4], prim.mesh.vertices[o + 5]);
      expect(Math.abs(len - 1)).toBeLessThan(0.1);
      expect(prim.mesh.vertices[o + 6]).toBeGreaterThanOrEqual(-0.01); expect(prim.mesh.vertices[o + 6]).toBeLessThanOrEqual(1.01);
    }
  });

  it('leaves ordinary accessors behind (so skinning, morphing etc. need no changes) and sets TRIANGLES', async () => {
    const { glb, stream } = await buildDracoGLB();
    const doc = await parseGLTF(glb);
    const prim = doc.json.meshes![0].primitives[0];
    expect(prim.extensions).toBeUndefined();
    expect(prim.mode).toBe(4);
    expect(readAccessorFloat(doc, prim.attributes.POSITION).count).toBe(stream.vertexCount);
    expect(readAccessorUint(doc, prim.indices!).count).toBe(stream.faceCount * 3);
  });

  it('reports an accessor that disagrees with the stream', async () => {
    const { glb } = await buildDracoGLB();
    const { json, bin } = parseGLB(glb);
    json.accessors![json.meshes![0].primitives[0].attributes.POSITION].count += 1;
    await expect(decompressGLTF(json, [bin!])).rejects.toThrow(/Draco stream/);
  });
});

describe('documents without compression', () => {
  it('load no decoder and keep their buffers untouched', async () => {
    const b = new GLBBuilder(); const prim = addTriangle(b); b.addToScene(b.node({ mesh: b.mesh({ primitives: [prim] }) }));
    const doc = await parseGLTF(b.glb());
    expect(doc.buffers).toHaveLength(1);
  });
});
