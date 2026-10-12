import { evaluateGlue, getCodecConfig, onCodecConfigChange, readWasm } from './CodecSources';

/** The parts of the Emscripten Draco module that the decoder uses. */
interface DracoModule {
  Decoder: new () => DracoDecoderHandle;
  Mesh: new () => DracoGeometry;
  PointCloud: new () => DracoGeometry;
  TRIANGULAR_MESH: number;
  POINT_CLOUD: number;
  DT_INT8: number; DT_UINT8: number; DT_INT16: number; DT_UINT16: number; DT_UINT32: number; DT_FLOAT32: number;
  HEAPF32: Float32Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  destroy(handle: unknown): void;
}
interface DracoGeometry { ptr: number; num_points(): number; num_faces(): number; }
interface DracoStatus { ok(): boolean; error_msg(): string; }
interface DracoAttribute { num_components(): number; }
interface DracoDecoderHandle {
  GetEncodedGeometryType(data: Int8Array): number;
  DecodeArrayToMesh(data: Int8Array, byteLength: number, mesh: DracoGeometry): DracoStatus;
  GetAttributeByUniqueId(geometry: DracoGeometry, id: number): DracoAttribute;
  GetAttributeDataArrayForAllPoints(geometry: DracoGeometry, attribute: DracoAttribute, dataType: number, byteLength: number, ptr: number): boolean;
  GetTrianglesUInt32Array(mesh: DracoGeometry, byteLength: number, ptr: number): boolean;
}

export type DracoArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array | Float32Array;

/** One attribute to extract: the Draco unique id and the glTF component type the output must have. */
export interface DracoAttributeRequest { uniqueId: number; componentType: number; }

export interface DracoMeshData {
  vertexCount: number;
  /** Triangle list, 3 indices per face. */
  indices: Uint32Array;
  /** Decoded attribute data (tightly packed, `components` values per vertex), keyed like the request. */
  attributes: Record<string, { data: DracoArray; components: number }>;
}

const ARRAYS: Record<number, { ctor: new (buffer: ArrayBufferLike, offset: number, length: number) => DracoArray; type: keyof Pick<DracoModule, 'DT_INT8' | 'DT_UINT8' | 'DT_INT16' | 'DT_UINT16' | 'DT_UINT32' | 'DT_FLOAT32'>; bytes: number }> = {
  5120: { ctor: Int8Array, type: 'DT_INT8', bytes: 1 }, 5121: { ctor: Uint8Array, type: 'DT_UINT8', bytes: 1 },
  5122: { ctor: Int16Array, type: 'DT_INT16', bytes: 2 }, 5123: { ctor: Uint16Array, type: 'DT_UINT16', bytes: 2 },
  5125: { ctor: Uint32Array, type: 'DT_UINT32', bytes: 4 }, 5126: { ctor: Float32Array, type: 'DT_FLOAT32', bytes: 4 },
};

/** Decodes Draco-compressed triangle meshes (`KHR_draco_mesh_compression`) with the vendored WebAssembly decoder. */
export class DracoDecoder {
  private static cached: Promise<DracoDecoder> | null = null;

  private constructor(private draco: DracoModule) {}

  /** The shared decoder; the WebAssembly module is fetched and compiled on first use. */
  static load(): Promise<DracoDecoder> {
    if (!DracoDecoder.cached) {
      DracoDecoder.cached = DracoDecoder.create().catch((error: unknown) => { DracoDecoder.cached = null; throw error; });
      onCodecConfigChange(() => { DracoDecoder.cached = null; });
    }
    return DracoDecoder.cached;
  }

  /** Create a decoder instance (the glue script is evaluated and the wasm binary instantiated). */
  private static async create(): Promise<DracoDecoder> {
    const [glue, wasm] = await Promise.all([
      import('../vendor/draco_decoder_glue.js?raw').then((m) => m.default),
      readWasm(getCodecConfig().draco ?? {}, async () => (await import('../vendor/draco_decoder.wasm?url')).default),
    ]);
    const factory = evaluateGlue<(config: object) => unknown>(glue);
    const draco = await new Promise<DracoModule>((resolve) => {
      // the module object is promise-like; resolving it directly would recurse, so it is handed over through the callback
      factory({ wasmBinary: wasm, onModuleLoaded: (module: DracoModule) => resolve(module) });
    });
    return new DracoDecoder(draco);
  }

  /** Decode one Draco triangle mesh. `wanted` maps a name (e.g. a glTF semantic) to the attribute's unique id and output type. */
  decodeMesh(data: Uint8Array, wanted: Record<string, DracoAttributeRequest>): DracoMeshData {
    const { draco } = this;
    const decoder = new draco.Decoder();
    const mesh = new draco.Mesh();
    try {
      const bytes = new Int8Array(data.buffer, data.byteOffset, data.byteLength);
      if (decoder.GetEncodedGeometryType(bytes) !== draco.TRIANGULAR_MESH) throw new Error('Draco stream is not a triangle mesh');
      const status = decoder.DecodeArrayToMesh(bytes, bytes.byteLength, mesh);
      if (!status.ok() || mesh.ptr === 0) throw new Error(`Draco decoding failed: ${status.error_msg()}`);

      const vertexCount = mesh.num_points();
      const attributes: DracoMeshData['attributes'] = {};
      for (const [name, request] of Object.entries(wanted)) {
        const layout = ARRAYS[request.componentType];
        if (!layout) throw new Error(`Draco attribute '${name}' has unsupported component type ${request.componentType}`);
        const attribute = decoder.GetAttributeByUniqueId(mesh, request.uniqueId);
        if (!attribute || (attribute as unknown as { ptr?: number }).ptr === 0) throw new Error(`Draco stream has no attribute with id ${request.uniqueId} ('${name}')`);
        const components = attribute.num_components();
        attributes[name] = { data: this.readAttribute(decoder, mesh, attribute, layout, vertexCount * components), components };
      }

      const indexCount = mesh.num_faces() * 3;
      const ptr = draco._malloc(indexCount * 4);
      try {
        decoder.GetTrianglesUInt32Array(mesh, indexCount * 4, ptr);
        const indices = new Uint32Array(draco.HEAPF32.buffer, ptr, indexCount).slice();   // copied out before the heap can move
        return { vertexCount, indices, attributes };
      } finally { draco._free(ptr); }
    } finally {
      draco.destroy(mesh);
      draco.destroy(decoder);
    }
  }

  /** Copy one attribute for all points out of the wasm heap as `layout`'s element type. */
  private readAttribute(decoder: DracoDecoderHandle, mesh: DracoGeometry, attribute: DracoAttribute, layout: (typeof ARRAYS)[number], length: number): DracoArray {
    const { draco } = this;
    const byteLength = length * layout.bytes, ptr = draco._malloc(byteLength);
    try {
      if (!decoder.GetAttributeDataArrayForAllPoints(mesh, attribute, draco[layout.type], byteLength, ptr)) throw new Error('Draco attribute decoding failed');
      return new layout.ctor(draco.HEAPF32.buffer, ptr, length).slice() as DracoArray;
    } finally { draco._free(ptr); }
  }
}
