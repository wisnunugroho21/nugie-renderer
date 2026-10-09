import { GLTFError, type GLTFDocument } from './GLTFParser';
import { ComponentType, type GLTFAccessor } from './GLTFTypes';

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const COMPONENT_BYTES: Record<number, number> = {
  [ComponentType.Int8]: 1, [ComponentType.Uint8]: 1, [ComponentType.Int16]: 2, [ComponentType.Uint16]: 2, [ComponentType.Uint32]: 4, [ComponentType.Float32]: 4,
};

/** Number of components of an accessor type string (SCALAR = 1, VEC3 = 3, MAT4 = 16 ...). */
export function componentCount(type: string): number {
  const n = COMPONENTS[type];
  if (!n) throw new GLTFError(`Unknown accessor type '${type}'`);
  return n;
}

/** Read one little-endian component of glTF `componentType`, applying the normalised-integer mapping when `normalized`. */
function readComponent(dv: DataView, offset: number, componentType: number, normalized: boolean): number {
  switch (componentType) {
    case ComponentType.Float32: return dv.getFloat32(offset, true);
    case ComponentType.Uint32: return dv.getUint32(offset, true);
    case ComponentType.Uint16: { const v = dv.getUint16(offset, true); return normalized ? v / 65535 : v; }
    case ComponentType.Int16: { const v = dv.getInt16(offset, true); return normalized ? Math.max(v / 32767, -1) : v; }
    case ComponentType.Uint8: { const v = dv.getUint8(offset); return normalized ? v / 255 : v; }
    case ComponentType.Int8: { const v = dv.getInt8(offset); return normalized ? Math.max(v / 127, -1) : v; }
    default: throw new GLTFError(`Unsupported componentType ${componentType}`);
  }
}

/**
 * Decode an accessor to a tightly packed Float32Array (normalized ints become [0,1]/[-1,1]).
 * Handles byteStride, missing bufferView (zeros) and sparse substitution.
 */
export function readAccessorFloat(doc: GLTFDocument, index: number): { data: Float32Array; count: number; components: number } {
  const acc = getAccessor(doc, index);
  const comps = componentCount(acc.type);
  const out = new Float32Array(acc.count * comps);
  forEachElement(doc, acc, comps, acc.normalized === true, (i, c, v) => { out[i * comps + c] = v; });
  applySparse(doc, acc, comps, (i, c, v) => { out[i * comps + c] = v; });
  return { data: out, count: acc.count, components: comps };
}

/** Decode an integer accessor (indices, joints) to Uint32Array (unnormalized). */
export function readAccessorUint(doc: GLTFDocument, index: number): { data: Uint32Array; count: number; components: number } {
  const acc = getAccessor(doc, index);
  const comps = componentCount(acc.type);
  const out = new Uint32Array(acc.count * comps);
  forEachElement(doc, acc, comps, false, (i, c, v) => { out[i * comps + c] = v; });
  applySparse(doc, acc, comps, (i, c, v) => { out[i * comps + c] = v; });
  return { data: out, count: acc.count, components: comps };
}

/** Look up accessor `index` in the document or throw a GLTFError. */
export function getAccessor(doc: GLTFDocument, index: number): GLTFAccessor {
  const acc = doc.json.accessors?.[index];
  if (!acc) throw new GLTFError(`Accessor ${index} does not exist`);
  return acc;
}

/** The bytes (and byte stride, 0 = tightly packed) of a bufferView, validated against its buffer. */
function viewBytes(doc: GLTFDocument, viewIndex: number): { bytes: Uint8Array; stride: number } {
  const view = doc.json.bufferViews?.[viewIndex];
  if (!view) throw new GLTFError(`bufferView ${viewIndex} does not exist`);
  const buf = doc.buffers[view.buffer];
  if (!buf) throw new GLTFError(`buffer ${view.buffer} does not exist`);
  const start = view.byteOffset ?? 0;
  if (start + view.byteLength > buf.byteLength) throw new GLTFError(`bufferView ${viewIndex} exceeds its buffer`);
  return { bytes: buf.subarray(start, start + view.byteLength), stride: view.byteStride ?? 0 };
}

/** Visit every component of every element of a dense accessor (honours byteStride / byteOffset); a missing bufferView means all zeros. */
function forEachElement(doc: GLTFDocument, acc: GLTFAccessor, comps: number, normalized: boolean, cb: (i: number, c: number, v: number) => void): void {
  if (acc.bufferView === undefined) return; // zero-initialized (valid when sparse provides values)
  const { bytes, stride } = viewBytes(doc, acc.bufferView);
  const cb_ = COMPONENT_BYTES[acc.componentType];
  if (!cb_) throw new GLTFError(`Unsupported componentType ${acc.componentType}`);
  const elementSize = cb_ * comps;
  const step = stride || elementSize;
  const base = acc.byteOffset ?? 0;
  if (acc.count > 0 && base + step * (acc.count - 1) + elementSize > bytes.byteLength) throw new GLTFError('Accessor exceeds its bufferView');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * step;
    for (let c = 0; c < comps; c++) cb(i, c, readComponent(dv, o + c * cb_, acc.componentType, normalized));
  }
}

/** Overwrite the accessor values listed by its `sparse` substitution (indices + replacement values) through `set`. */
function applySparse(doc: GLTFDocument, acc: GLTFAccessor, comps: number, set: (i: number, c: number, v: number) => void): void {
  const sp = acc.sparse;
  if (!sp) return;
  const idxView = viewBytes(doc, sp.indices.bufferView), valView = viewBytes(doc, sp.values.bufferView);
  const idxDV = new DataView(idxView.bytes.buffer, idxView.bytes.byteOffset, idxView.bytes.byteLength);
  const valDV = new DataView(valView.bytes.buffer, valView.bytes.byteOffset, valView.bytes.byteLength);
  const ib = COMPONENT_BYTES[sp.indices.componentType], vb = COMPONENT_BYTES[acc.componentType];
  const norm = acc.normalized === true;
  for (let k = 0; k < sp.count; k++) {
    const target = readComponent(idxDV, (sp.indices.byteOffset ?? 0) + k * ib, sp.indices.componentType, false);
    if (target >= acc.count) throw new GLTFError('Sparse index out of range');
    for (let c = 0; c < comps; c++) set(target, c, readComponent(valDV, (sp.values.byteOffset ?? 0) + (k * comps + c) * vb, acc.componentType, norm));
  }
}
