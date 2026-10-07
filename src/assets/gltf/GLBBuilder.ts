/** Programmatically author glTF/GLB documents (used by tests and runtime demos; no external assets needed). */
type TA = Float32Array | Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array;

const COMPONENT_TYPE = new Map<string, number>([
  ['Int8Array', 5120], ['Uint8Array', 5121], ['Int16Array', 5122], ['Uint16Array', 5123], ['Uint32Array', 5125], ['Float32Array', 5126],
]);

export class GLBBuilder {
  json: any = { asset: { version: '2.0', generator: 'test' }, buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [], scenes: [{ nodes: [] }], scene: 0 };
  private parts: Uint8Array[] = [];
  private length = 0;

  /** Append raw bytes as a bufferView (4-byte aligned). */
  view(bytes: Uint8Array, opts: { stride?: number; target?: number } = {}): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.parts.push(new Uint8Array(pad)); this.length += pad; }
    const offset = this.length;
    this.parts.push(bytes);
    this.length += bytes.byteLength;
    const view: Record<string, number> = { buffer: 0, byteOffset: offset, byteLength: bytes.byteLength };
    if (opts.stride) view.byteStride = opts.stride;
    if (opts.target) view.target = opts.target;
    this.json.bufferViews.push(view);
    return this.json.bufferViews.length - 1;
  }

  /** Add an accessor over its own tightly packed bufferView. */
  accessor(data: TA, type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4', opts: { normalized?: boolean; minmax?: boolean } = {}): number {
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const bv = this.view(bytes);
    const acc: Record<string, unknown> = {
      bufferView: bv, componentType: COMPONENT_TYPE.get(data.constructor.name)!, count: data.length / comps, type,
    };
    if (opts.normalized) acc.normalized = true;
    if (opts.minmax) {
      const min = new Array(comps).fill(Infinity), max = new Array(comps).fill(-Infinity);
      for (let i = 0; i < data.length; i++) { min[i % comps] = Math.min(min[i % comps], data[i]); max[i % comps] = Math.max(max[i % comps], data[i]); }
      acc.min = min; acc.max = max;
    }
    this.json.accessors.push(acc);
    return this.json.accessors.length - 1;
  }

  /** Add an accessor reading from an existing (possibly interleaved) bufferView. */
  accessorOnView(view: number, byteOffset: number, componentType: number, count: number, type: string, normalized = false): number {
    this.json.accessors.push({ bufferView: view, byteOffset, componentType, count, type, ...(normalized ? { normalized } : {}) });
    return this.json.accessors.length - 1;
  }

  /** Append a glTF node object and return its index. */
  node(n: Record<string, unknown>): number { (this.json.nodes ??= []).push(n); return this.json.nodes.length - 1; }
  /** Append a glTF mesh object and return its index. */
  mesh(m: Record<string, unknown>): number { (this.json.meshes ??= []).push(m); return this.json.meshes.length - 1; }
  /** Append a glTF material object and return its index. */
  material(m: Record<string, unknown>): number { (this.json.materials ??= []).push(m); return this.json.materials.length - 1; }
  /** Add root nodes to scene 0. */
  addToScene(...nodes: number[]): void { this.json.scenes[0].nodes.push(...nodes); }

  /** Concatenate all accumulated buffer parts into the single GLB binary chunk. */
  private binary(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.byteLength; }
    return out;
  }

  /** Serialize as .glb. */
  glb(): Uint8Array {
    const bin = this.binary();
    if (bin.length) this.json.buffers[0].byteLength = bin.byteLength; else delete this.json.buffers;
    const jsonBytes = new TextEncoder().encode(JSON.stringify(this.json));
    const jsonPad = (4 - (jsonBytes.length % 4)) % 4, binPad = (4 - (bin.length % 4)) % 4;
    const jsonLen = jsonBytes.length + jsonPad, binLen = bin.length + binPad;
    const total = 12 + 8 + jsonLen + (bin.length ? 8 + binLen : 0);
    const out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
    out.set(jsonBytes, 20); out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen);
    if (bin.length) {
      const o = 20 + jsonLen;
      dv.setUint32(o, binLen, true); dv.setUint32(o + 4, 0x004e4942, true); out.set(bin, o + 8);
    }
    return out;
  }

  /** Serialize as .gltf with the buffer embedded as a data URI. */
  gltfDataURI(): string {
    const bin = this.binary();
    let s = '';
    for (let i = 0; i < bin.length; i++) s += String.fromCharCode(bin[i]);
    const json = JSON.parse(JSON.stringify(this.json));
    json.buffers[0] = { byteLength: bin.byteLength, uri: 'data:application/octet-stream;base64,' + btoa(s) };
    return JSON.stringify(json);
  }

  /** .gltf JSON referencing an external 'model.bin' + that binary. */
  gltfExternal(): { json: string; bin: Uint8Array } {
    const bin = this.binary();
    const json = JSON.parse(JSON.stringify(this.json));
    json.buffers[0] = { byteLength: bin.byteLength, uri: 'model.bin' };
    return { json: JSON.stringify(json), bin };
  }
}

/** Standard test triangle: indexed, with normals + uvs. Returns the primitive attribute map. */
export function addTriangle(b: GLBBuilder, opts: { normals?: boolean; indices?: boolean } = {}): { attributes: Record<string, number>; indices?: number; targets?: Record<string, number>[]; mode?: number; material?: number } {
  const position = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 'VEC3', { minmax: true });
  const attributes: Record<string, number> = { POSITION: position };
  if (opts.normals !== false) attributes.NORMAL = b.accessor(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 'VEC3');
  attributes.TEXCOORD_0 = b.accessor(new Float32Array([0, 0, 1, 0, 0, 1]), 'VEC2');
  const out: { attributes: Record<string, number>; indices?: number; targets?: Record<string, number>[]; mode?: number; material?: number } = { attributes };
  if (opts.indices !== false) out.indices = b.accessor(new Uint16Array([0, 1, 2]), 'SCALAR');
  return out;
}
