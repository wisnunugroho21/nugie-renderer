/** Build glTF documents that use EXT_meshopt_compression / KHR_draco_mesh_compression, using the real encoders (dev dependencies). */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { GLBBuilder } from './glbBuilder';
import { configureCodecs } from '../../src/assets/codecs/CodecSources';
import { createUVSphere } from '../../src/rendering/primitives';
import { STANDARD_VERTEX_FLOATS as F } from '../../src/rendering/VertexLayouts';

const require = createRequire(import.meta.url);

/** Point the decoders at the vendored wasm files on disk (Node cannot `fetch` a bundler URL). */
export function useVendoredDecoders(): void {
  const read = (name: string) => new Uint8Array(readFileSync(new URL(`../../src/assets/vendor/${name}`, import.meta.url)));
  configureCodecs({ draco: { bytes: read('draco_decoder.wasm') }, basis: { bytes: read('basis_transcoder.wasm') } });
}

/** A small indexed mesh (the engine's 8 x 6 UV sphere) split into separate attribute arrays. */
export function sphereArrays() {
  const mesh = createUVSphere(8, 6), n = mesh.vertices.length / F;
  const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) { positions[i * 3 + k] = mesh.vertices[i * F + k]; normals[i * 3 + k] = mesh.vertices[i * F + 3 + k]; }
    uvs[i * 2] = mesh.vertices[i * F + 6]; uvs[i * 2 + 1] = mesh.vertices[i * F + 7];
  }
  return { positions, normals, uvs, indices: mesh.indices, vertexCount: n };
}

const view = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** Give the document one material whose base colour is the KTX2 image (KHR_texture_basisu, no fallback image); returns the material index. */
function addBasisuMaterial(b: GLBBuilder, ktx2: Uint8Array): number {
  b.json.images = [{ bufferView: b.view(ktx2), mimeType: 'image/ktx2' }];
  b.json.textures = [{ extensions: { KHR_texture_basisu: { source: 0 } } }];
  b.json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
  b.json.textures[0].sampler = 0;
  b.json.extensionsUsed = [...(b.json.extensionsUsed ?? []), 'KHR_texture_basisu'];
  b.json.extensionsRequired = [...(b.json.extensionsRequired ?? []), 'KHR_texture_basisu'];
  return b.material({ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.6 } });
}

/**
 * The sphere with every buffer view meshopt-compressed: positions and uvs unfiltered, normals octahedral (8 bit, VEC3 BYTE normalized in a
 * 4-byte stride, like gltfpack output), indices as TRIANGLES. The uncompressed bytes only exist as a fallback buffer without data.
 */
export async function buildMeshoptGLB(ktx2?: Uint8Array): Promise<{ glb: Uint8Array; source: ReturnType<typeof sphereArrays> }> {
  await MeshoptEncoder.ready;
  const s = sphereArrays();
  const b = new GLBBuilder();
  b.json.buffers.push({ byteLength: 0, extensions: { EXT_meshopt_compression: { fallback: true } } });
  b.json.extensionsUsed = ['EXT_meshopt_compression']; b.json.extensionsRequired = ['EXT_meshopt_compression'];

  /** A compressed bufferView (fallback buffer 1 stands for the decoded bytes) plus an accessor reading it. */
  const compressed = (raw: Uint8Array, count: number, stride: number, mode: 'ATTRIBUTES' | 'TRIANGLES', filter: string, accessor: Record<string, unknown>) => {
    const stream = MeshoptEncoder.encodeGltfBuffer(raw, count, stride, mode);
    const source = b.view(stream);
    const fallbackLength = count * stride;
    b.json.bufferViews.push({
      buffer: 1, byteLength: fallbackLength, ...(mode === 'ATTRIBUTES' ? { byteStride: stride } : {}),
      extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: b.json.bufferViews[source].byteOffset, byteLength: stream.byteLength, byteStride: stride, count, mode, filter } },
    });
    b.json.buffers[1].byteLength += fallbackLength;
    b.json.accessors.push({ bufferView: b.json.bufferViews.length - 1, count: accessor.count, componentType: accessor.componentType, type: accessor.type, ...(accessor.normalized ? { normalized: true } : {}) });
    return b.json.accessors.length - 1;
  };

  const n = s.vertexCount;
  const position = compressed(view(s.positions), n, 12, 'ATTRIBUTES', 'NONE', { count: n, componentType: 5126, type: 'VEC3' });
  const normal4 = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) normal4.set(s.normals.subarray(i * 3, i * 3 + 3), i * 4);
  const normal = compressed(MeshoptEncoder.encodeFilterOct(normal4, n, 4, 8), n, 4, 'ATTRIBUTES', 'OCTAHEDRAL', { count: n, componentType: 5120, type: 'VEC3', normalized: true });
  const uv = compressed(view(s.uvs), n, 8, 'ATTRIBUTES', 'NONE', { count: n, componentType: 5126, type: 'VEC2' });
  const index16 = Uint16Array.from(s.indices);
  const indices = compressed(view(index16), index16.length, 2, 'TRIANGLES', 'NONE', { count: index16.length, componentType: 5123, type: 'SCALAR' });
  const material = ktx2 ? addBasisuMaterial(b, ktx2) : undefined;
  b.addToScene(b.node({ mesh: b.mesh({ primitives: [{ attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv }, indices, ...(material !== undefined ? { material } : {}) }] }) }));
  return { glb: b.glb(), source: s };
}

/** The sphere as a Draco-compressed primitive (accessors without bufferViews, as the extension requires). */
export async function buildDracoGLB(quantization = { position: 14, normal: 10, uv: 12 }, ktx2?: Uint8Array): Promise<{ glb: Uint8Array; source: ReturnType<typeof sphereArrays>; stream: { vertexCount: number; faceCount: number } }> {
  const draco3d = require('draco3d');
  const encoderModule = await draco3d.createEncoderModule({});
  const s = sphereArrays();
  const mesh = new encoderModule.Mesh(), builder = new encoderModule.MeshBuilder(), encoder = new encoderModule.Encoder();
  builder.AddFacesToMesh(mesh, s.indices.length / 3, s.indices);
  const ids = {
    POSITION: builder.AddFloatAttributeToMesh(mesh, encoderModule.POSITION, s.vertexCount, 3, s.positions),
    NORMAL: builder.AddFloatAttributeToMesh(mesh, encoderModule.NORMAL, s.vertexCount, 3, s.normals),
    TEXCOORD_0: builder.AddFloatAttributeToMesh(mesh, encoderModule.TEX_COORD, s.vertexCount, 2, s.uvs),
  };
  encoder.SetSpeedOptions(5, 5);
  encoder.SetAttributeQuantization(encoderModule.POSITION, quantization.position);
  encoder.SetAttributeQuantization(encoderModule.NORMAL, quantization.normal);
  encoder.SetAttributeQuantization(encoderModule.TEX_COORD, quantization.uv);
  encoder.SetEncodingMethod(encoderModule.MESH_EDGEBREAKER_ENCODING);
  const out = new encoderModule.DracoInt8Array();
  const length = encoder.EncodeMeshToDracoBuffer(mesh, out);
  if (length <= 0) throw new Error('Draco encoding failed');
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = out.GetValue(i) & 0xff;
  encoderModule.destroy(out); encoderModule.destroy(mesh); encoderModule.destroy(builder); encoderModule.destroy(encoder);

  // Draco merges vertices with identical attributes, so the glTF accessors must carry the stream's own vertex count (as real exporters write it)
  const decoderModule = await draco3d.createDecoderModule({});
  const probe = new decoderModule.Decoder(), probeMesh = new decoderModule.Mesh();
  probe.DecodeArrayToMesh(new Int8Array(bytes.buffer), bytes.byteLength, probeMesh);
  const vertexCount: number = probeMesh.num_points(), faceCount: number = probeMesh.num_faces();
  decoderModule.destroy(probeMesh); decoderModule.destroy(probe);

  const b = new GLBBuilder();
  b.json.extensionsUsed = ['KHR_draco_mesh_compression']; b.json.extensionsRequired = ['KHR_draco_mesh_compression'];
  const bufferView = b.view(bytes);
  const accessor = (componentType: number, count: number, type: string, extra: Record<string, unknown> = {}) => {
    b.json.accessors.push({ componentType, count, type, ...extra }); return b.json.accessors.length - 1;
  };
  const xs = Array.from({ length: 3 }, (_, k) => Array.from({ length: s.vertexCount }, (_, i) => s.positions[i * 3 + k]));
  const attributes = {
    POSITION: accessor(5126, vertexCount, 'VEC3', { min: xs.map((a) => Math.min(...a)), max: xs.map((a) => Math.max(...a)) }),
    NORMAL: accessor(5126, vertexCount, 'VEC3'),
    TEXCOORD_0: accessor(5126, vertexCount, 'VEC2'),
  };
  const indices = accessor(5123, faceCount * 3, 'SCALAR');
  const material = ktx2 ? addBasisuMaterial(b, ktx2) : undefined;
  b.addToScene(b.node({ mesh: b.mesh({ primitives: [{ attributes, indices, ...(material !== undefined ? { material } : {}), extensions: { KHR_draco_mesh_compression: { bufferView, attributes: ids } } }] }) }));
  return { glb: b.glb(), source: s, stream: { vertexCount, faceCount } };
}
