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
  applySparse(doc, acc, comps, acc.normalized === true, (i, c, v) => { out[i * comps + c] = v; });
  return { data: out, count: acc.count, components: comps };
}

/** Decode an integer accessor (indices, joints) to Uint32Array (unnormalized). */
export function readAccessorUint(doc: GLTFDocument, index: number): { data: Uint32Array; count: number; components: number } {
  const acc = getAccessor(doc, index);
  const comps = componentCount(acc.type);
  const out = new Uint32Array(acc.count * comps);
  forEachElement(doc, acc, comps, false, (i, c, v) => { out[i * comps + c] = v; });
  applySparse(doc, acc, comps, false, (i, c, v) => { out[i * comps + c] = v; });
  return { data: out, count: acc.count, components: comps };
}

/** Look up accessor `index` in the document or throw a GLTFError. */
export function getAccessor(doc: GLTFDocument, index: number): GLTFAccessor {
  const acc = doc.json.accessors?.[index];
  if (!acc) throw new GLTFError(`Accessor ${index} does not exist`);
  nonnegativeInteger(acc.count, 'Accessor count');
  if (!COMPONENT_BYTES[acc.componentType]) throw new GLTFError(`Unsupported componentType ${acc.componentType}`);
  return acc;
}

/** The bytes (and byte stride, 0 = tightly packed) of a bufferView, validated against its buffer. */
function viewBytes(doc: GLTFDocument, viewIndex: number): { bytes: Uint8Array; stride: number } {
  const view = doc.json.bufferViews?.[viewIndex];
  if (!view) throw new GLTFError(`bufferView ${viewIndex} does not exist`);
  const buf = doc.buffers[view.buffer];
  if (!buf) throw new GLTFError(`buffer ${view.buffer} does not exist`);
  const start = view.byteOffset ?? 0;
  nonnegativeInteger(start, 'bufferView offset');
  nonnegativeInteger(view.byteLength, 'bufferView length');
  nonnegativeInteger(view.byteStride ?? 0, 'bufferView stride');
  if (start + view.byteLength > buf.byteLength) throw new GLTFError(`bufferView ${viewIndex} exceeds its buffer`);
  return { bytes: buf.subarray(start, start + view.byteLength), stride: view.byteStride ?? 0 };
}

function nonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new GLTFError(`${label} must be a nonnegative integer`);
}

/** Matrix columns start on four-byte boundaries; the final padding bytes may be omitted. */
function elementLayout(acc: GLTFAccessor, comps: number): { offsets: number[]; stride: number; size: number } {
  const bytes = COMPONENT_BYTES[acc.componentType];
  const rows = acc.type.startsWith('MAT') ? Math.sqrt(comps) : comps;
  const columns = acc.type.startsWith('MAT') ? rows : 1;
  const columnBytes = columns > 1 ? Math.ceil(rows * bytes / 4) * 4 : rows * bytes;
  const offsets = Array.from({ length: comps }, (_, c) => Math.floor(c / rows) * columnBytes + (c % rows) * bytes);
  return { offsets, stride: columns * columnBytes, size: offsets[comps - 1] + bytes };
}

function checkRange(base: number, step: number, count: number, size: number, byteLength: number, label: string): void {
  nonnegativeInteger(base, `${label} offset`);
  if (base > byteLength || (count > 0 && base + step * (count - 1) + size > byteLength)) {
    throw new GLTFError(`${label} exceeds its bufferView`);
  }
}

/** Visit every component of every element of a dense accessor (honours byteStride / byteOffset); a missing bufferView means all zeros. */
function forEachElement(doc: GLTFDocument, acc: GLTFAccessor, comps: number, normalized: boolean, cb: (i: number, c: number, v: number) => void): void {
  if (acc.bufferView === undefined) return; // zero-initialized (valid when sparse provides values)
  const { bytes, stride } = viewBytes(doc, acc.bufferView);
  const layout = elementLayout(acc, comps);
  const step = stride || layout.stride;
  if (step < layout.stride || step % COMPONENT_BYTES[acc.componentType] !== 0) throw new GLTFError('Invalid accessor byteStride');
  const base = acc.byteOffset ?? 0;
  checkRange(base, step, acc.count, layout.size, bytes.byteLength, 'Accessor');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * step;
    for (let c = 0; c < comps; c++) cb(i, c, readComponent(dv, o + layout.offsets[c], acc.componentType, normalized));
  }
}

/** Overwrite the accessor values listed by its `sparse` substitution (indices + replacement values) through `set`. */
function applySparse(doc: GLTFDocument, acc: GLTFAccessor, comps: number, normalized: boolean, set: (i: number, c: number, v: number) => void): void {
  const sp = acc.sparse;
  if (!sp) return;
  nonnegativeInteger(sp.count, 'Sparse count');
  if (sp.count > acc.count) throw new GLTFError('Sparse count exceeds accessor count');
  if (![ComponentType.Uint8, ComponentType.Uint16, ComponentType.Uint32].includes(sp.indices.componentType)) {
    throw new GLTFError('Sparse indices must use an unsigned integer componentType');
  }
  const idxView = viewBytes(doc, sp.indices.bufferView), valView = viewBytes(doc, sp.values.bufferView);
  const idxDV = new DataView(idxView.bytes.buffer, idxView.bytes.byteOffset, idxView.bytes.byteLength);
  const valDV = new DataView(valView.bytes.buffer, valView.bytes.byteOffset, valView.bytes.byteLength);
  const ib = COMPONENT_BYTES[sp.indices.componentType], layout = elementLayout(acc, comps);
  const indexBase = sp.indices.byteOffset ?? 0, valueBase = sp.values.byteOffset ?? 0;
  checkRange(indexBase, ib, sp.count, ib, idxView.bytes.byteLength, 'Sparse indices');
  checkRange(valueBase, layout.stride, sp.count, layout.size, valView.bytes.byteLength, 'Sparse values');
  let previous = -1;
  for (let k = 0; k < sp.count; k++) {
    const target = readComponent(idxDV, indexBase + k * ib, sp.indices.componentType, false);
    if (target >= acc.count) throw new GLTFError('Sparse index out of range');
    if (target <= previous) throw new GLTFError('Sparse indices must be strictly increasing');
    previous = target;
    for (let c = 0; c < comps; c++) set(target, c, readComponent(valDV, valueBase + k * layout.stride + layout.offsets[c], acc.componentType, normalized));
  }
}
