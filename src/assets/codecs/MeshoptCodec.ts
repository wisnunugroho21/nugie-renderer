/** The meshoptimizer decoder (`EXT_meshopt_compression`), loaded on first use. */
export interface MeshoptDecoderApi {
  decodeGltfBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array, mode: string, filter?: string): void;
}

let cached: Promise<MeshoptDecoderApi> | null = null;

/** The shared meshopt decoder; its (embedded) WebAssembly module is compiled on first use. */
export function loadMeshoptDecoder(): Promise<MeshoptDecoderApi> {
  cached ??= import('../vendor/meshopt_decoder.js').then(async ({ MeshoptDecoder }) => {
    await MeshoptDecoder.ready;
    if (!MeshoptDecoder.supported) throw new Error('WebAssembly is not available: cannot decode EXT_meshopt_compression');
    return MeshoptDecoder;
  }).catch((error: unknown) => { cached = null; throw error; });
  return cached;
}
