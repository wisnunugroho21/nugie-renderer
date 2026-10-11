import { GLTFError } from './GLTFError';
import type { GLTFAccessor, GLTFBufferView, GLTFJson } from './GLTFTypes';
import { ComponentType, PrimitiveMode } from './GLTFTypes';
import { DracoDecoder, type DracoArray, type DracoAttributeRequest } from '../codecs/DracoDecoder';
import { loadMeshoptDecoder } from '../codecs/MeshoptCodec';

/**
 * Appends decoded data to one new binary buffer. Buffer views and accessors created by the decoders point into it, so the rest of the
 * loader sees ordinary uncompressed glTF.
 */
class DecodedBuffer {
  private chunks: Uint8Array[] = [];
  private length = 0;
  /** `index` is the position the finished buffer takes in `json.buffers` / the document's buffer list. */
  constructor(readonly index: number) {}

  /** Append bytes (4-byte aligned) and return their byte offset. */
  add(bytes: Uint8Array): number {
    const offset = (this.length + 3) & ~3;
    if (offset > this.length) this.chunks.push(new Uint8Array(offset - this.length));
    this.chunks.push(bytes);
    this.length = offset + bytes.byteLength;
    return offset;
  }

  /** Concatenate everything added so far. */
  finish(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) { out.set(chunk, at); at += chunk.byteLength; }
    return out;
  }
}

/** The bytes a buffer view covers. */
function viewData(json: GLTFJson, buffers: Uint8Array[], viewIndex: number): Uint8Array {
  const view = json.bufferViews?.[viewIndex];
  if (!view) throw new GLTFError(`bufferView ${viewIndex} does not exist`);
  return sliceBuffer(buffers, view.buffer, view.byteOffset ?? 0, view.byteLength, `bufferView ${viewIndex}`);
}

/** `length` bytes of buffer `index` from `offset`, validated. */
function sliceBuffer(buffers: Uint8Array[], index: number, offset: number, length: number, label: string): Uint8Array {
  const buffer = buffers[index];
  if (!buffer) throw new GLTFError(`${label}: buffer ${index} does not exist`);
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > buffer.byteLength) {
    throw new GLTFError(`${label} exceeds its buffer`);
  }
  return buffer.subarray(offset, offset + length);
}

/**
 * Turn a document that uses `EXT_meshopt_compression` and / or `KHR_draco_mesh_compression` into plain glTF, in place: compressed
 * buffer views are decoded into a new buffer and re-pointed at it, Draco primitives get ordinary accessors, and the extension objects
 * are removed. Meshopt runs first (a Draco stream may itself live in a meshopt-compressed view). Does nothing, and loads no decoder,
 * when the document uses neither extension.
 */
export async function decompressGLTF(json: GLTFJson, buffers: Uint8Array[]): Promise<void> {
  const meshoptViews = (json.bufferViews ?? []).filter((v) => v.extensions?.EXT_meshopt_compression);
  const dracoPrimitives = (json.meshes ?? []).flatMap((m) => m.primitives).filter((p) => p.extensions?.KHR_draco_mesh_compression);
  if (!meshoptViews.length && !dracoPrimitives.length) return;

  json.buffers ??= [];
  const decoded = new DecodedBuffer(buffers.length);
  json.buffers.push({ byteLength: 0 });
  buffers.push(new Uint8Array(0));

  if (meshoptViews.length) await decodeMeshoptViews(buffers, meshoptViews, decoded);
  if (dracoPrimitives.length) await decodeDracoPrimitives(json, buffers, decoded);

  const data = decoded.finish();
  buffers[decoded.index] = data;
  json.buffers[decoded.index] = { byteLength: data.byteLength };
}

/** Decode every `EXT_meshopt_compression` buffer view into `decoded` and point the view at the result. */
async function decodeMeshoptViews(buffers: Uint8Array[], views: GLTFBufferView[], decoded: DecodedBuffer): Promise<void> {
  const decoder = await loadMeshoptDecoder();
  for (const view of views) {
    const ext = view.extensions!.EXT_meshopt_compression!;
    const source = sliceBuffer(buffers, ext.buffer, ext.byteOffset ?? 0, ext.byteLength, 'EXT_meshopt_compression');
    if (!Number.isSafeInteger(ext.count) || !Number.isSafeInteger(ext.byteStride) || ext.count < 0 || ext.byteStride <= 0) {
      throw new GLTFError('EXT_meshopt_compression: invalid count or byteStride');
    }
    const target = new Uint8Array(ext.count * ext.byteStride);
    try { decoder.decodeGltfBuffer(target, ext.count, ext.byteStride, source, ext.mode, ext.filter ?? 'NONE'); }
    catch (error) { throw new GLTFError(`EXT_meshopt_compression: ${(error as Error).message}`); }
    view.buffer = decoded.index;
    view.byteOffset = decoded.add(target);
    view.byteLength = target.byteLength;
    if (ext.mode === 'ATTRIBUTES') view.byteStride = ext.byteStride; else delete view.byteStride;
    delete view.extensions!.EXT_meshopt_compression;
    if (!Object.keys(view.extensions!).length) delete view.extensions;
  }
}

/** Wrap Draco's decoded triangle indices in the integer type the accessor declares. */
function indicesAs(indices: Uint32Array, componentType: number): Uint8Array | Uint16Array | Uint32Array {
  if (componentType === ComponentType.Uint32) return indices;
  const out = componentType === ComponentType.Uint16 ? new Uint16Array(indices.length) : new Uint8Array(indices.length);
  const limit = componentType === ComponentType.Uint16 ? 0xffff : 0xff;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] > limit) throw new GLTFError('KHR_draco_mesh_compression: index does not fit the accessor component type');
    out[i] = indices[i];
  }
  return out;
}

/** Decode every `KHR_draco_mesh_compression` primitive into `decoded`, giving it fresh accessors for its indices and attributes. */
async function decodeDracoPrimitives(json: GLTFJson, buffers: Uint8Array[], decoded: DecodedBuffer): Promise<void> {
  const decoder = await DracoDecoder.load();
  json.accessors ??= [];
  json.bufferViews ??= [];
  /** Add a bufferView over `data` and an accessor (a copy of `template`) reading it; returns the accessor index. */
  const addAccessor = (template: GLTFAccessor, data: DracoArray | Uint8Array | Uint16Array | Uint32Array, count: number): number => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    json.bufferViews!.push({ buffer: decoded.index, byteOffset: decoded.add(bytes), byteLength: bytes.byteLength });
    json.accessors!.push({ ...template, bufferView: json.bufferViews!.length - 1, byteOffset: 0, count, sparse: undefined });
    return json.accessors!.length - 1;
  };

  for (const [meshIndex, mesh] of (json.meshes ?? []).entries()) {
    for (const [primIndex, prim] of mesh.primitives.entries()) {
      const ext = prim.extensions?.KHR_draco_mesh_compression;
      if (!ext) continue;
      const label = `mesh ${meshIndex}/primitive ${primIndex}`;
      if (prim.indices === undefined) throw new GLTFError(`${label}: a Draco primitive needs an indices accessor`);
      const wanted: Record<string, DracoAttributeRequest> = {};
      for (const [semantic, uniqueId] of Object.entries(ext.attributes)) {
        const accessor = prim.attributes[semantic] !== undefined ? json.accessors[prim.attributes[semantic]] : undefined;
        if (!accessor) throw new GLTFError(`${label}: Draco attribute ${semantic} has no accessor`);
        wanted[semantic] = { uniqueId, componentType: accessor.componentType };
      }
      let mat: ReturnType<DracoDecoder['decodeMesh']>;
      try { mat = decoder.decodeMesh(viewData(json, buffers, ext.bufferView), wanted); }
      catch (error) { throw error instanceof GLTFError ? error : new GLTFError(`${label}: ${(error as Error).message}`); }

      for (const [semantic, attribute] of Object.entries(mat.attributes)) {
        const template = json.accessors[prim.attributes[semantic]];
        if (template.count !== mat.vertexCount) throw new GLTFError(`${label}: ${semantic} has ${template.count} elements in the accessor but ${mat.vertexCount} in the Draco stream`);
        prim.attributes[semantic] = addAccessor(template, attribute.data, mat.vertexCount);
      }
      const indexTemplate = json.accessors[prim.indices];
      prim.indices = addAccessor(indexTemplate, indicesAs(mat.indices, indexTemplate.componentType), mat.indices.length);
      prim.mode = PrimitiveMode.Triangles;   // Draco always yields a triangle list
      delete prim.extensions!.KHR_draco_mesh_compression;
      if (!Object.keys(prim.extensions!).length) delete prim.extensions;
    }
  }
}
