import type { GLTFJson } from './GLTFTypes';

export class GLTFError extends Error {}

export interface GLTFDocument {
  json: GLTFJson;
  /** Decoded binary buffers, indexed like json.buffers. */
  buffers: Uint8Array[];
}

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export interface ParsedGLB { json: GLTFJson; bin: Uint8Array | null; }

/** Parse the GLB container (header + JSON chunk + optional BIN chunk). */
export function parseGLB(data: ArrayBuffer | Uint8Array): ParsedGLB {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20) throw new GLTFError('GLB too short');
  if (dv.getUint32(0, true) !== MAGIC) throw new GLTFError('Not a GLB file (bad magic)');
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new GLTFError(`Unsupported GLB version ${version}`);
  const length = dv.getUint32(8, true);
  if (length > bytes.byteLength) throw new GLTFError('GLB length field exceeds data size');

  let offset = 12, json: GLTFJson | null = null, bin: Uint8Array | null = null;
  while (offset + 8 <= length) {
    const chunkLength = dv.getUint32(offset, true), type = dv.getUint32(offset + 4, true);
    const start = offset + 8, end = start + chunkLength;
    if (end > length) throw new GLTFError('GLB chunk exceeds container length');
    if (type === CHUNK_JSON && !json) json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, end))) as GLTFJson;
    else if (type === CHUNK_BIN && !bin) bin = bytes.subarray(start, end);
    offset = end + ((4 - (end % 4)) % 4); // chunks are 4-byte aligned
  }
  if (!json) throw new GLTFError('GLB has no JSON chunk');
  return { json, bin };
}

/** Resolves external resources (.gltf with separate .bin files / images). */
export type ResourceResolver = (uri: string) => Promise<Uint8Array>;

/** Decode a `data:` URI (base64 or percent-encoded) into bytes. */
export function decodeDataURI(uri: string): Uint8Array {
  const comma = uri.indexOf(',');
  if (!uri.startsWith('data:') || comma < 0) throw new GLTFError('Malformed data URI');
  const meta = uri.slice(5, comma), payload = uri.slice(comma + 1);
  if (meta.endsWith(';base64')) {
    const bin = atob(payload);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}

/**
 * Parse a .glb or .gltf into a GLTFDocument (JSON + resolved buffers). External buffer URIs are
 * fetched through `resolver` in parallel.
 */
export async function parseGLTF(data: ArrayBuffer | Uint8Array | string, resolver?: ResourceResolver): Promise<GLTFDocument> {
  let json: GLTFJson, glbBin: Uint8Array | null = null;
  if (typeof data === 'string') json = JSON.parse(data) as GLTFJson;
  else {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const isGLB = bytes.byteLength >= 4 && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === MAGIC;
    if (isGLB) ({ json, bin: glbBin } = parseGLB(bytes));
    else json = JSON.parse(new TextDecoder().decode(bytes)) as GLTFJson;
  }
  if (!json.asset || !/^2\./.test(json.asset.version)) throw new GLTFError(`Unsupported glTF version '${json.asset?.version}'`);
  const required = (json.extensionsRequired ?? []).filter((e) => !SUPPORTED_REQUIRED_EXTENSIONS.has(e));
  if (required.length) throw new GLTFError(`Unsupported required extensions: ${required.join(', ')}`);

  const defs = json.buffers ?? [];
  const buffers = await Promise.all(defs.map(async (b, i) => {
    let data: Uint8Array;
    if (b.uri === undefined) {
      if (i !== 0 || !glbBin) throw new GLTFError(`Buffer ${i} has no uri and no GLB BIN chunk`);
      data = glbBin;
    } else if (b.uri.startsWith('data:')) data = decodeDataURI(b.uri);
    else {
      if (!resolver) throw new GLTFError(`Buffer ${i} references '${b.uri}' but no resource resolver was provided`);
      data = await resolver(b.uri);
    }
    if (data.byteLength < b.byteLength) throw new GLTFError(`Buffer ${i} is shorter (${data.byteLength}) than declared (${b.byteLength})`);
    return data;
  }));
  return { json, buffers };
}

/** Extensions we can honor (or safely ignore) when listed as REQUIRED. */
const SUPPORTED_REQUIRED_EXTENSIONS = new Set(['KHR_materials_emissive_strength', 'KHR_texture_transform']);
