import type { PipelineKey } from '../gpu/PipelineCache';

/** Standard static vertex: position(3) normal(3) uv(2) tangent(4) = 12 floats = 48 bytes. */
export const STANDARD_VERTEX_FLOATS = 12;
export const STANDARD_VERTEX_STRIDE = STANDARD_VERTEX_FLOATS * 4;

export const STANDARD_VERTEX_LAYOUT: PipelineKey['vertexLayout'] = [{
  stride: STANDARD_VERTEX_STRIDE,
  attributes: [
    { location: 0, offset: 0, format: 'float32x3' },  // position
    { location: 1, offset: 12, format: 'float32x3' }, // normal
    { location: 2, offset: 24, format: 'float32x2' }, // uv
    { location: 3, offset: 32, format: 'float32x4' }, // tangent (w = handedness; 0 = none)
  ],
}];

/** Convert a pipeline key's vertex layout into WebGPU vertex buffer layouts. */
export function toGPUVertexBuffers(layout: PipelineKey['vertexLayout']): GPUVertexBufferLayout[] {
  return layout.map((l) => ({
    arrayStride: l.stride,
    stepMode: l.stepMode ?? 'vertex',
    attributes: l.attributes.map((a) => ({ shaderLocation: a.location, offset: a.offset, format: a.format })),
  }));
}

/** Retained rigid instances: model matrix, cofactor normal matrix, material index. */
export const RETAINED_INSTANCE_WORDS = 26;
export const RETAINED_INSTANCE_STRIDE = RETAINED_INSTANCE_WORDS * 4;
export const RETAINED_VERTEX_LAYOUT: PipelineKey['vertexLayout'] = [{ stride: 24, attributes: [
  { location: 0, offset: 0, format: 'float32x3' },
  { location: 1, offset: 12, format: 'float32x3' },
] }, {
  stride: RETAINED_INSTANCE_STRIDE, stepMode: 'instance',
  attributes: [
    ...Array.from({ length: 4 }, (_, i) => ({ location: 4 + i, offset: i * 16, format: 'float32x4' as const })),
    ...Array.from({ length: 3 }, (_, i) => ({ location: 8 + i, offset: 64 + i * 12, format: 'float32x3' as const })),
    { location: 11, offset: 100, format: 'uint32' },
  ],
}];

/** Directional-lighting path without a packed instance stream: position and normal only (instances come from storage buffers). */
export const DIRECTIONAL_VERTEX_LAYOUT: PipelineKey['vertexLayout'] = RETAINED_VERTEX_LAYOUT.slice(0, 1);
