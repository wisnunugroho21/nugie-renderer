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
