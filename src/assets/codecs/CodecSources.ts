/**
 * Where the WebAssembly decoders come from. The defaults are the vendored builds in `src/assets/vendor` (resolved by the bundler); call
 * {@link configureCodecs} before the first compressed asset is loaded to host them elsewhere (a CDN, a different path) or to hand over the
 * bytes directly (Node, tests). The decoders are loaded lazily and only once.
 */

/** A WebAssembly binary: either bytes you already have or a URL to fetch them from. */
export interface WasmSource { bytes?: ArrayBuffer | Uint8Array; url?: string; }

export interface CodecConfig {
  /** `draco_decoder.wasm` for `KHR_draco_mesh_compression`. */
  draco?: WasmSource;
  /** `basis_transcoder.wasm` for KTX2 / `KHR_texture_basisu`. */
  basis?: WasmSource;
}

let config: CodecConfig = {};
const listeners = new Set<() => void>();

/** Override the decoder binaries. Decoders already created keep working; new ones use the new sources. */
export function configureCodecs(next: CodecConfig): void {
  config = { ...config, ...next };
  for (const l of listeners) l();
}

/** The current overrides. */
export function getCodecConfig(): Readonly<CodecConfig> { return config; }

/** Run `fn` whenever {@link configureCodecs} is called (decoder caches use it to drop stale instances). Returns an unsubscribe function. */
export function onCodecConfigChange(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

/** Bytes of a wasm source, fetching the URL if needed. */
export async function readWasm(source: WasmSource, fallbackUrl: () => Promise<string>): Promise<ArrayBuffer | Uint8Array> {
  if (source.bytes) return source.bytes;
  const url = source.url ?? await fallbackUrl();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load decoder '${url}' (HTTP ${response.status})`);
  return response.arrayBuffer();
}

/**
 * Evaluate an Emscripten glue script that ends in `module.exports = <factory>` (the vendored Draco and Basis builds do) and return the
 * factory. Evaluating text needs a Content-Security-Policy that allows `unsafe-eval` for scripts (WebAssembly needs `wasm-unsafe-eval`).
 */
export function evaluateGlue<T>(source: string): T {
  const module: { exports: unknown } = { exports: {} };
  new Function('module', 'exports', 'require', '__dirname', '__filename', source)(module, module.exports, nodeRequire, '', '');
  return module.exports as T;
}

/** What the glue's Node code path asks for (`require('fs')` ...) when it runs under Node (tests, tooling); the browser path never calls it. */
function nodeRequire(name: string): unknown {
  const builtin = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule?.(name.replace(/^node:/, ''));
  if (!builtin) throw new Error(`Decoder glue needs '${name}', which is not available here`);
  return builtin;
}
