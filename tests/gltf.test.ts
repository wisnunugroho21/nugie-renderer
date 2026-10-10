import { describe, expect, it } from 'vitest';
import { GLBBuilder, addTriangle } from './helpers/glbBuilder';
import { parseGLB, parseGLTF, decodeDataURI, GLTFError } from '../src/assets/gltf/GLTFParser';
import { readAccessorFloat, readAccessorUint } from '../src/assets/gltf/Accessors';
import { loadGLTF, decomposeMatrix } from '../src/assets/gltf/GLTFLoader';
import { toTriangleList } from '../src/assets/gltf/GLTFMeshLoader';
import { normalizeWeights } from '../src/assets/gltf/GLTFSkinLoader';
import { toSamplerDescriptor } from '../src/assets/gltf/GLTFTextureLoader';
import { Mat4 } from '../src/math/Mat4';
import { Quat } from '../src/math/Quat';
import { STANDARD_VERTEX_FLOATS as F } from '../src/rendering/VertexLayouts';

const close = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-5) => { for (let i = 0; i < b.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(eps); };

function triangleModel(): GLBBuilder {
  const b = new GLBBuilder();
  const prim = addTriangle(b);
  const m = b.mesh({ primitives: [prim] });
  b.addToScene(b.node({ mesh: m }));
  return b;
}

describe('GLB container', () => {
  it('parses header, JSON and BIN chunks', () => {
    const { json, bin } = parseGLB(triangleModel().glb());
    expect(json.asset.version).toBe('2.0');
    expect(bin!.byteLength).toBeGreaterThan(0);
  });
  it('rejects bad magic, bad version, truncated data', () => {
    const g = triangleModel().glb();
    const bad = g.slice(); bad[0] = 0;
    expect(() => parseGLB(bad)).toThrow(GLTFError);
    const v = g.slice(); new DataView(v.buffer).setUint32(4, 1, true);
    expect(() => parseGLB(v)).toThrow(/version/);
    expect(() => parseGLB(g.subarray(0, 10))).toThrow();
    expect(() => parseGLB(g.subarray(0, g.length - 8))).toThrow(/length/);
  });
  it('parseGLTF loads .glb, data-URI .gltf and external .gltf (resolver)', async () => {
    const b = triangleModel();
    expect((await parseGLTF(b.glb())).buffers[0].byteLength).toBeGreaterThan(0);
    expect((await parseGLTF(b.gltfDataURI())).buffers[0].byteLength).toBeGreaterThan(0);
    const ext = b.gltfExternal();
    const doc = await parseGLTF(ext.json, async (uri) => { expect(uri).toBe('model.bin'); return ext.bin; });
    expect(doc.buffers[0].byteLength).toBe(ext.bin.byteLength);
    await expect(parseGLTF(ext.json)).rejects.toThrow(/resolver/);
  });
  it('rejects unsupported versions and required extensions', async () => {
    const b = triangleModel(); b.json.asset.version = '1.0';
    await expect(parseGLTF(b.gltfDataURI())).rejects.toThrow(/version/);
    const c = triangleModel(); c.json.extensionsRequired = ['KHR_draco_mesh_compression'];
    await expect(parseGLTF(c.glb())).rejects.toThrow(/Unsupported required/);
  });
  it('data URIs decode base64', () => {
    expect(Array.from(decodeDataURI('data:application/octet-stream;base64,AQID'))).toEqual([1, 2, 3]);
  });
});

describe('accessors', () => {
  it('reads interleaved data with byteStride', async () => {
    const b = new GLBBuilder();
    const inter = new Float32Array([0, 0, 0, 9, 9, 1, 0, 0, 9, 9, 0, 1, 0, 9, 9]); // pos(3) + junk(2) stride 20
    const v = b.view(new Uint8Array(inter.buffer), { stride: 20 });
    const a = b.accessorOnView(v, 0, 5126, 3, 'VEC3');
    b.addToScene(b.node({}));
    const doc = await parseGLTF(b.glb());
    close(readAccessorFloat(doc, a).data, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });
  it('normalizes integer components', async () => {
    const b = new GLBBuilder();
    const a8 = b.accessor(new Uint8Array([0, 255, 128, 0]), 'VEC4', { normalized: true });
    const a16 = b.accessor(new Int16Array([32767, -32768, 0]), 'SCALAR', { normalized: true });
    const doc = await parseGLTF(b.glb());
    close(readAccessorFloat(doc, a8).data, [0, 1, 128 / 255, 0]);
    close(readAccessorFloat(doc, a16).data, [1, -1, 0]);
  });
  it('reads unsigned ints without normalization', async () => {
    const b = new GLBBuilder();
    const a = b.accessor(new Uint16Array([3, 65535, 7]), 'SCALAR');
    expect(Array.from(readAccessorUint(await parseGLTF(b.glb()), a).data)).toEqual([3, 65535, 7]);
  });
  it('applies sparse substitution on top of zeros / base data', async () => {
    const b = new GLBBuilder();
    const base = b.accessor(new Float32Array([1, 1, 1, 1, 1, 1]), 'SCALAR');
    const idx = b.view(new Uint8Array(new Uint16Array([1, 4]).buffer));
    const val = b.view(new Uint8Array(new Float32Array([7, 9]).buffer));
    b.json.accessors[base].sparse = { count: 2, indices: { bufferView: idx, componentType: 5123 }, values: { bufferView: val } };
    const sp = (n: number) => ({ count: n, indices: { bufferView: idx, componentType: 5123 }, values: { bufferView: val } });
    const zero = b.json.accessors.push({ componentType: 5126, count: 3, type: 'SCALAR', sparse: sp(1) }) - 1; // no bufferView => zeros + sparse
    const bad = b.json.accessors.push({ componentType: 5126, count: 3, type: 'SCALAR', sparse: sp(2) }) - 1;  // second index (4) is out of range
    const doc = await parseGLTF(b.glb());
    close(readAccessorFloat(doc, base).data, [1, 7, 1, 1, 9, 1]);
    close(readAccessorFloat(doc, zero).data, [0, 7, 0]);
    expect(() => readAccessorFloat(doc, bad)).toThrow(/out of range/);
  });
  it('detects accessors that exceed their bufferView', async () => {
    const b = new GLBBuilder();
    const a = b.accessor(new Float32Array([1, 2, 3]), 'SCALAR');
    b.json.accessors[a].count = 10;
    expect(() => readAccessorFloat(parseGLTFSync(b), a)).toThrow(/exceeds/);
  });
});

function parseGLTFSync(b: GLBBuilder) {
  const { json, bin } = parseGLB(b.glb());
  return { json, buffers: [bin!] };
}

describe('mesh loading', () => {
  it('converts a triangle to the standard vertex layout with uint32 indices', async () => {
    const a = await loadGLTF(triangleModel().glb());
    const p = a.meshes[0].primitives[0];
    expect(p.mesh.vertices.length).toBe(3 * F);
    expect(p.mesh.indices).toBeInstanceOf(Uint32Array);
    expect(Array.from(p.mesh.indices)).toEqual([0, 1, 2]);
    close(p.mesh.vertices.subarray(F, F + 8), [1, 0, 0, 0, 0, 1, 1, 0]); // position, normal, uv of vertex 1
    expect(p.hasTangents).toBe(false);
    expect(p.mesh.vertices[F + 11]).toBe(0); // tangent.w = 0 => derivative fallback in shader
    expect(a.warnings).toEqual([]);
  });

  it('generates flat normals + unshares vertices when NORMAL is missing', async () => {
    const b = new GLBBuilder();
    const prim = addTriangle(b, { normals: false });
    b.addToScene(b.node({ mesh: b.mesh({ primitives: [prim] }) }));
    const p = (await loadGLTF(b.glb())).meshes[0].primitives[0];
    close(p.mesh.vertices.subarray(3, 6), [0, 0, 1]);
    close(p.mesh.vertices.subarray(F + 3, F + 6), [0, 0, 1]);
  });

  it('non-indexed primitives get sequential indices', async () => {
    const b = new GLBBuilder();
    const prim = addTriangle(b, { indices: false });
    b.addToScene(b.node({ mesh: b.mesh({ primitives: [prim] }) }));
    expect(Array.from((await loadGLTF(b.glb())).meshes[0].primitives[0].mesh.indices)).toEqual([0, 1, 2]);
  });

  it('strip and fan modes expand to triangle lists with consistent winding', () => {
    expect(Array.from(toTriangleList(Uint32Array.from([0, 1, 2, 3, 4]), 5))).toEqual([0, 1, 2, 2, 1, 3, 2, 3, 4]);
    expect(Array.from(toTriangleList(Uint32Array.from([0, 1, 2, 3, 4]), 6))).toEqual([0, 1, 2, 0, 2, 3, 0, 3, 4]);
    expect(Array.from(toTriangleList(Uint32Array.from([0, 1, 2, 3]), 4))).toEqual([0, 1, 2]); // trailing partial triangle dropped
  });

  it('skips lines/points with a warning', async () => {
    const b = new GLBBuilder();
    const prim = addTriangle(b);
    b.addToScene(b.node({ mesh: b.mesh({ primitives: [{ ...prim, mode: 1 }, prim] }) }));
    const a = await loadGLTF(b.glb());
    expect(a.meshes[0].primitives.length).toBe(1);
    expect(a.warnings.join()).toMatch(/not supported/);
  });

  it('rejects out-of-range indices (skips primitive with warning)', async () => {
    const b = new GLBBuilder();
    const prim = addTriangle(b, { indices: false });
    prim.indices = b.accessor(new Uint16Array([0, 1, 9]), 'SCALAR');
    b.addToScene(b.node({ mesh: b.mesh({ primitives: [prim] }) }));
    const a = await loadGLTF(b.glb());
    expect(a.meshes[0].primitives.length).toBe(0);
    expect(a.warnings.join()).toMatch(/out of range/);
  });

  it('keeps TANGENT data and flags it', async () => {
    const b = new GLBBuilder();
    const prim = addTriangle(b);
    prim.attributes.TANGENT = b.accessor(new Float32Array([1, 0, 0, -1, 1, 0, 0, -1, 1, 0, 0, -1]), 'VEC4');
    b.addToScene(b.node({ mesh: b.mesh({ primitives: [prim] }) }));
    const p = (await loadGLTF(b.glb())).meshes[0].primitives[0];
    expect(p.hasTangents).toBe(true);
    close(p.mesh.vertices.subarray(8, 12), [1, 0, 0, -1]);
  });
});

describe('nodes and hierarchy', () => {
  it('reads TRS, parents and children', async () => {
    const b = new GLBBuilder();
    const child = b.node({ name: 'child', translation: [1, 2, 3], scale: [2, 2, 2] });
    const root = b.node({ name: 'root', children: [child], rotation: [0, 0, 0.7071068, 0.7071068] });
    b.addToScene(root);
    const a = await loadGLTF(b.glb());
    expect(a.nodes[child].parent).toBe(root);
    expect(a.nodes[root].parent).toBe(-1);
    expect(a.nodes[child].translation).toEqual([1, 2, 3]);
    expect(a.scenes[0].nodes).toEqual([root]);
  });
  it('decomposes node.matrix back to TRS (round trip incl. negative scale)', () => {
    const q = Quat.normalize(Quat.create(), [0.2, 0.5, -0.3, 0.8]);
    for (const s of [[1, 1, 1], [2, 3, 0.5], [-1, 2, 2]]) {
      const m = Mat4.compose(Mat4.create(), 4, -5, 6, q[0], q[1], q[2], q[3], s[0], s[1], s[2]);
      const d = decomposeMatrix(m);
      const m2 = Mat4.compose(Mat4.create(), d.t[0], d.t[1], d.t[2], d.r[0], d.r[1], d.r[2], d.r[3], d.s[0], d.s[1], d.s[2]);
      close(m2, m, 1e-4);
    }
  });
  it('node with matrix is decomposed on load', async () => {
    const b = new GLBBuilder();
    const m = Mat4.compose(Mat4.create(), 1, 2, 3, 0, 0, 0, 1, 2, 2, 2);
    b.addToScene(b.node({ matrix: Array.from(m) }));
    const n = (await loadGLTF(b.glb())).nodes[0];
    close(n.translation, [1, 2, 3]); close(n.scale, [2, 2, 2]);
  });
  it('rejects cycles and multi-parent nodes', async () => {
    const b = new GLBBuilder();
    b.node({ children: [1] }); b.node({ children: [0] }); b.addToScene(0);
    await expect(loadGLTF(b.glb())).rejects.toThrow(/cycle|parent/);
    const c = new GLBBuilder();
    c.node({ children: [2] }); c.node({ children: [2] }); c.node({}); c.addToScene(0, 1);
    await expect(loadGLTF(c.glb())).rejects.toThrow(/more than one parent/);
  });
  it('parses cameras', async () => {
    const b = new GLBBuilder();
    b.json.cameras = [{ type: 'perspective', perspective: { yfov: 0.8, znear: 0.1, zfar: 50, aspectRatio: 1.5 } }, { type: 'orthographic', orthographic: { xmag: 2, ymag: 1, znear: 0, zfar: 10 } }];
    b.addToScene(b.node({ camera: 0 }));
    const a = await loadGLTF(b.glb());
    expect(a.cameras[0]).toMatchObject({ type: 'perspective', yfov: 0.8, zfar: 50 });
    expect(a.cameras[1]).toMatchObject({ type: 'orthographic', xmag: 2 });
    expect(a.nodes[0].camera).toBe(0);
  });
});

describe('materials and textures', () => {
  it('maps PBR factors, emissive strength extension, alpha and double-sided', async () => {
    const b = new GLBBuilder();
    b.material({
      name: 'm', pbrMetallicRoughness: { baseColorFactor: [0.1, 0.2, 0.3, 0.4], metallicFactor: 0.25, roughnessFactor: 0.75 },
      emissiveFactor: [1, 0.5, 0], extensions: { KHR_materials_emissive_strength: { emissiveStrength: 5 } },
      alphaMode: 'MASK', alphaCutoff: 0.3, doubleSided: true, normalTexture: undefined,
    });
    b.addToScene(b.node({}));
    const m = (await loadGLTF(b.glb())).materials[0];
    expect(m.desc).toMatchObject({ baseColor: [0.1, 0.2, 0.3, 0.4], metallic: 0.25, roughness: 0.75, emissive: [1, 0.5, 0], emissiveStrength: 5, alphaMode: 'MASK', alphaCutoff: 0.3, doubleSided: true });
  });
  it('applies glTF defaults', async () => {
    const b = new GLBBuilder(); b.material({}); b.addToScene(b.node({}));
    expect((await loadGLTF(b.glb())).materials[0].desc).toMatchObject({ baseColor: [1, 1, 1, 1], metallic: 1, roughness: 1, alphaMode: 'OPAQUE', doubleSided: false, emissiveStrength: 1 });
  });
  it('colour textures are sRGB, data textures linear; identical uses are de-duplicated', async () => {
    const b = new GLBBuilder();
    b.json.images = [{ uri: 'a.png' }, { uri: 'b.jpg' }];
    b.json.samplers = [{ magFilter: 9728, minFilter: 9987, wrapS: 33071, wrapT: 33648 }];
    b.json.textures = [{ source: 0, sampler: 0 }, { source: 1 }];
    b.material({
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } },
      normalTexture: { index: 1, scale: 0.5 }, emissiveTexture: { index: 0 }, occlusionTexture: { index: 1, strength: 0.7 },
    });
    b.material({ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } });
    b.addToScene(b.node({}));
    const a = await loadGLTF(b.glb());
    const [m0, m1] = a.materials;
    expect(a.textures[m0.textures.baseColor!].srgb).toBe(true);
    expect(a.textures[m0.textures.emissive!].srgb).toBe(true);
    expect(a.textures[m0.textures.normal!].srgb).toBe(false);
    expect(m0.textures.baseColor).toBe(m0.textures.emissive); // same image/sampler/srgb
    expect(m1.textures.baseColor).toBe(m0.textures.baseColor);
    expect(m0.textures.normal).toBe(m0.textures.metalRough);  // linear, same
    expect(m0.desc.normalScale).toBe(0.5);
    expect(m0.desc.occlusionStrength).toBe(0.7);
    expect(a.images.map((i) => i.mimeType)).toEqual(['image/png', 'image/jpeg']);
    expect(a.textures.length).toBe(2); // (img0, sRGB, sampler0) and (img1, linear, default)
  });
  it('samplers map to WebGPU descriptors', () => {
    expect(toSamplerDescriptor({ magFilter: 9728, minFilter: 9984, wrapS: 33071, wrapT: 33648 })).toEqual({
      magFilter: 'nearest', minFilter: 'nearest', mipmapFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'mirror-repeat',
    });
    expect(toSamplerDescriptor()).toEqual({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
  });
  it('warns about unsupported texCoord sets', async () => {
    const b = new GLBBuilder();
    b.json.images = [{ uri: 'a.png' }]; b.json.textures = [{ source: 0 }];
    b.material({ pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 1 } } });
    b.addToScene(b.node({}));
    expect((await loadGLTF(b.glb())).warnings.join()).toMatch(/TEXCOORD_1/);
  });
  it('embedded images (bufferView) are exposed as bytes', async () => {
    const b = new GLBBuilder();
    const v = b.view(new Uint8Array([137, 80, 78, 71]));
    b.json.images = [{ bufferView: v, mimeType: 'image/png' }];
    b.addToScene(b.node({}));
    expect(Array.from((await loadGLTF(b.glb())).images[0].data!)).toEqual([137, 80, 78, 71]);
  });
});

describe('skins', () => {
  function skinned(): GLBBuilder {
    const b = new GLBBuilder();
    const prim = addTriangle(b);
    prim.attributes.JOINTS_0 = b.accessor(new Uint8Array([0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]), 'VEC4');
    prim.attributes.WEIGHTS_0 = b.accessor(new Float32Array([0.5, 0.5, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0]), 'VEC4');
    const j0 = b.node({ name: 'j0', children: [1] }), j1 = b.node({ name: 'j1' });
    const ibm = new Float32Array(32);
    Mat4.identity(ibm.subarray(0, 16)); Mat4.compose(ibm as unknown as number[], 0, -1, 0, 0, 0, 0, 1, 1, 1, 1, 16);
    b.json.skins = [{ joints: [j0, j1], inverseBindMatrices: b.accessor(ibm, 'MAT4'), skeleton: j0 }];
    b.addToScene(j0, b.node({ mesh: b.mesh({ primitives: [prim] }), skin: 0 }));
    return b;
  }
  it('parses joints, inverse bind matrices and skeleton', async () => {
    const a = await loadGLTF(skinned().glb());
    expect(a.skins[0].joints).toEqual([0, 1]);
    expect(a.skins[0].skeleton).toBe(0);
    expect(a.skins[0].inverseBindMatrices[16 + 13]).toBeCloseTo(-1);
    expect(a.nodes[2].skin).toBe(0);
  });
  it('reads JOINTS_0/WEIGHTS_0 and normalizes weights per vertex', async () => {
    const p = (await loadGLTF(skinned().glb())).meshes[0].primitives[0];
    expect(p.joints0).toBeInstanceOf(Uint16Array);
    expect(Array.from(p.joints0!.subarray(0, 8))).toEqual([0, 1, 0, 0, 1, 0, 0, 0]);
    close(p.weights0!.subarray(0, 8), [0.5, 0.5, 0, 0, 1, 0, 0, 0]); // second vertex 2 -> 1
    close(p.weights0!.subarray(8, 12), [1, 0, 0, 0]);               // all-zero -> joint 0
    for (let v = 0; v < 3; v++) expect(p.weights0![v * 4] + p.weights0![v * 4 + 1] + p.weights0![v * 4 + 2] + p.weights0![v * 4 + 3]).toBeCloseTo(1);
  });
  it('defaults to identity inverse bind matrices', async () => {
    const b = skinned(); delete b.json.skins[0].inverseBindMatrices;
    const a = await loadGLTF(b.glb());
    expect(a.skins[0].inverseBindMatrices[0]).toBe(1);
    expect(a.skins[0].inverseBindMatrices[16 + 13]).toBe(0);
  });
  it('rejects inverseBindMatrices with too few entries', async () => {
    const b = skinned(); b.json.accessors[b.json.skins[0].inverseBindMatrices].count = 1;
    await expect(loadGLTF(b.glb())).rejects.toThrow(/inverseBindMatrices/);
  });
  it('JOINTS_1/WEIGHTS_1 are parsed when present (architecture ready for >4 influences)', async () => {
    const b = skinned();
    const prim = b.json.meshes[0].primitives[0];
    prim.attributes.JOINTS_1 = b.accessor(new Uint16Array(12), 'VEC4');
    prim.attributes.WEIGHTS_1 = b.accessor(new Float32Array(12), 'VEC4');
    const p = (await loadGLTF(b.glb())).meshes[0].primitives[0];
    expect(p.joints1!.length).toBe(12);
  });
  it('normalizeWeights helper', () => {
    close(normalizeWeights(Float32Array.from([1, 1, 1, 1])), [0.25, 0.25, 0.25, 0.25]);
  });
});

describe('morph targets', () => {
  function morphed(): GLBBuilder {
    const b = new GLBBuilder();
    const prim = addTriangle(b);
    prim.targets = [
      { POSITION: b.accessor(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 'VEC3') },
      { POSITION: b.accessor(new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]), 'VEC3'), NORMAL: b.accessor(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 'VEC3') },
    ];
    const m = b.mesh({ primitives: [prim], weights: [0.25, 0.5] });
    b.addToScene(b.node({ mesh: m, weights: [1, 0] }));
    return b;
  }
  it('parses deltas (not duplicated meshes) and default weights', async () => {
    const a = await loadGLTF(morphed().glb());
    const p = a.meshes[0].primitives[0];
    expect(p.morphTargets!.length).toBe(2);
    close(p.morphTargets![0].position!, [0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(p.morphTargets![0].normal).toBeUndefined();
    close(p.morphTargets![1].normal!, [0, 1, 0, 0, 1, 0, 0, 1, 0]);
    expect(Array.from(a.meshes[0].defaultMorphWeights!)).toEqual([0.25, 0.5]);
    expect(Array.from(a.nodes[0].weights!)).toEqual([1, 0]);
  });
  it('morph deltas are re-mapped consistently when vertices are unshared', async () => {
    const b = morphed();
    delete b.json.meshes[0].primitives[0].attributes.NORMAL; // forces flat normals + unindexing
    const p = (await loadGLTF(b.glb())).meshes[0].primitives[0];
    expect(p.morphTargets![0].position!.length).toBe(p.mesh.vertices.length / F * 3);
  });
  it('rejects morph target accessors with the wrong vertex count', async () => {
    const b = morphed();
    b.json.meshes[0].primitives[0].targets[0].POSITION = b.accessor(new Float32Array(6), 'VEC3');
    await expect(loadGLTF(b.glb())).rejects.toThrow(/vertex count/);
  });
});

describe('animations', () => {
  function animated(interp: string, outputFloats: number, path = 'translation'): GLBBuilder {
    const b = new GLBBuilder();
    const n = b.node({}); b.addToScene(n);
    const input = b.accessor(new Float32Array([0, 1, 2]), 'SCALAR', { minmax: true });
    const output = b.accessor(new Float32Array(outputFloats), 'VEC3');
    b.json.accessors[output].type = path === 'rotation' ? 'VEC4' : 'VEC3';
    b.json.animations = [{ name: 'a', samplers: [{ input, output, interpolation: interp }], channels: [{ sampler: 0, target: { node: n, path } }] }];
    return b;
  }
  it('parses LINEAR/STEP/CUBICSPLINE with correct strides and duration', async () => {
    const lin = (await loadGLTF(animated('LINEAR', 9).glb())).animations[0];
    expect(lin.duration).toBe(2);
    expect(lin.channels[0]).toMatchObject({ path: 'translation', interpolation: 'LINEAR', stride: 3 });
    expect((await loadGLTF(animated('STEP', 9).glb())).animations[0].channels[0].interpolation).toBe('STEP');
    expect((await loadGLTF(animated('CUBICSPLINE', 27).glb())).animations[0].channels[0].values.length).toBe(27);
  });
  it('validates output sizes', async () => {
    await expect(loadGLTF(animated('LINEAR', 6).glb())).rejects.toThrow(/expected/);
    await expect(loadGLTF(animated('CUBICSPLINE', 9).glb())).rejects.toThrow(/expected/);
  });
  it('rejects non-monotonic times', async () => {
    const b = animated('LINEAR', 9);
    const bad = b.accessor(new Float32Array([0, 2, 1]), 'SCALAR');
    b.json.animations[0].samplers[0].input = bad;
    await expect(loadGLTF(b.glb())).rejects.toThrow(/monotonic/);
  });
  it('weights channels use the target node morph count as stride', async () => {
    const b = new GLBBuilder();
    const prim = addTriangle(b);
    prim.targets = [{ POSITION: b.accessor(new Float32Array(9), 'VEC3') }, { POSITION: b.accessor(new Float32Array(9), 'VEC3') }];
    const n = b.node({ mesh: b.mesh({ primitives: [prim] }) }); b.addToScene(n);
    const input = b.accessor(new Float32Array([0, 1]), 'SCALAR');
    const output = b.accessor(new Float32Array([0, 0, 1, 1]), 'SCALAR');
    b.json.animations = [{ samplers: [{ input, output }], channels: [{ sampler: 0, target: { node: n, path: 'weights' } }] }];
    const c = (await loadGLTF(b.glb())).animations[0].channels[0];
    expect(c.stride).toBe(2);
    expect(Array.from(c.values)).toEqual([0, 0, 1, 1]);
  });
});

it('decomposes glTF zero-scale matrices into finite values using the shared math implementation', async () => {
  const { decomposeMatrix } = await import('../src/assets/gltf/GLTFLoader');
  const result = decomposeMatrix([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1]);
  expect(result.t).toEqual([2, 3, 4]);
  expect(result.s).toEqual([0, 1, 1]);
  expect(result.r.every(Number.isFinite)).toBe(true);
});

describe('accessor matrix layout and sparse validation regressions', () => {
  it.each([
    ['MAT2', 5121, new Uint8Array([1, 2, 99, 99, 3, 4]), [1, 2, 3, 4]],
    ['MAT3', 5121, new Uint8Array([1, 2, 3, 99, 4, 5, 6, 99, 7, 8, 9]), [1, 2, 3, 4, 5, 6, 7, 8, 9]],
    ['MAT3', 5123, new Uint8Array(new Uint16Array([1, 2, 3, 99, 4, 5, 6, 99, 7, 8, 9]).buffer), [1, 2, 3, 4, 5, 6, 7, 8, 9]],
  ] as const)('decodes %s with component type %s and omitted trailing padding', (type, componentType, bytes, expected) => {
    const builder = new GLBBuilder();
    const view = builder.view(bytes);
    const accessor = builder.accessorOnView(view, 0, componentType, 1, type);
    const doc = parseGLTFSync(builder);
    expect(Array.from(readAccessorFloat(doc, accessor).data)).toEqual(expected);
  });
  it('uses matrix column padding for sparse replacement values', () => {
    const b = new GLBBuilder();
    const indices = b.view(new Uint8Array([1]));
    const values = b.view(new Uint8Array([1, 2, 99, 99, 3, 4]));
    b.json.accessors.push({ componentType: 5121, count: 2, type: 'MAT2', sparse: {
      count: 1, indices: { bufferView: indices, componentType: 5121 }, values: { bufferView: values },
    } });
    expect(Array.from(readAccessorFloat(parseGLTFSync(b), 0).data)).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
  });
  it('preserves integer sparse values when normalization is requested only in float decoding', () => {
    const b = new GLBBuilder();
    const accessor = b.accessor(new Uint8Array([10, 20]), 'SCALAR', { normalized: true });
    const indices = b.view(new Uint8Array([1]));
    const values = b.view(new Uint8Array([128]));
    b.json.accessors[accessor].sparse = { count: 1, indices: { bufferView: indices, componentType: 5121 }, values: { bufferView: values } };
    const doc = parseGLTFSync(b);
    expect(Array.from(readAccessorUint(doc, accessor).data)).toEqual([10, 128]);
    close(readAccessorFloat(doc, accessor).data, [10 / 255, 128 / 255]);
  });
  it('rejects sparse truncation, duplicate indices and negative offsets with glTF errors', () => {
    const b = new GLBBuilder();
    const accessor = b.accessor(new Uint8Array([1, 2]), 'SCALAR');
    const indices = b.view(new Uint8Array([1, 1]));
    const values = b.view(new Uint8Array([3, 4]));
    b.json.accessors[accessor].sparse = { count: 2, indices: { bufferView: indices, componentType: 5121 }, values: { bufferView: values } };
    expect(() => readAccessorFloat(parseGLTFSync(b), accessor)).toThrow(/strictly increasing/);
    b.json.bufferViews[values].byteLength = 1;
    expect(() => readAccessorFloat(parseGLTFSync(b), accessor)).toThrow(/Sparse values exceeds/);
    b.json.accessors[accessor].byteOffset = -1;
    expect(() => readAccessorFloat(parseGLTFSync(b), accessor)).toThrow(GLTFError);
  });
});
