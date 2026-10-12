import type { Material } from './Material';

/**
 * Which specialised draw path a pipeline serves. The default (standard) path reads instance records and transforms from storage buffers
 * and supports every material. The specialised paths only apply to undeformed, map-free base PBR materials:
 *  - `retained`: per-instance matrix, cofactor normal matrix and material index come from a packed vertex stream (no storage reads);
 *  - `directional`: the cheap fragment stage used while only directional lights and the hemisphere ambient are active;
 *  - `uniformNormals`: (directional, non-retained only) normals can use the model matrix directly because it is a rotation times a uniform scale.
 */
export interface DrawVariant {
  /** Dense id in [0, DRAW_VARIANT_COUNT): usable as a cache-slot component. */
  readonly index: number;
  readonly retained: boolean;
  readonly directional: boolean;
  readonly uniformNormals: boolean;
}

export interface DrawVariantOptions { retained?: boolean; directional?: boolean; uniformNormals?: boolean; }

export const DRAW_VARIANT_COUNT = 8;

const VARIANTS: readonly DrawVariant[] = Array.from({ length: DRAW_VARIANT_COUNT }, (_, index) => Object.freeze({
  index, retained: (index & 1) !== 0, directional: (index & 2) !== 0, uniformNormals: (index & 4) !== 0,
}));

/** The ordinary storage-buffer draw path. */
export const STANDARD_VARIANT: DrawVariant = VARIANTS[0];

/** Shared (allocation-free) variant for the given flags. `uniformNormals` only has meaning for the directional, non-retained path and is dropped elsewhere. */
export function drawVariant(o: DrawVariantOptions = {}): DrawVariant {
  const retained = !!o.retained, directional = !!o.directional;
  const uniformNormals = directional && !retained && !!o.uniformNormals;
  return VARIANTS[(retained ? 1 : 0) | (directional ? 2 : 0) | (uniformNormals ? 4 : 0)];
}

/** True for every variant except the standard path. */
export function isSpecialized(v: DrawVariant): boolean { return v.retained || v.directional; }

/** Vertex entry point of a draw path (`standardEntry` is the material's own for the standard path). */
export function variantVertexEntry(v: DrawVariant, standardEntry: string): string {
  if (v.retained) return 'vs_retained';
  if (v.directional) return v.uniformNormals ? 'vs_directional_uniform' : 'vs_directional_storage';
  return standardEntry;
}

/** Name of the pipeline layout of a draw path: part of the pipeline cache key. */
export function variantLayoutName(v: DrawVariant): string {
  if (v.directional) return v.retained ? 'engine-retained-directional' : 'engine-directional';
  return v.retained ? 'engine-retained-v1' : 'engine-v1';
}

/** True for materials the specialised (retained / directional) draw paths can render: base PBR with the standard entries, no maps or extensions. */
export function supportsSpecializedDraw(m: Material): boolean {
  return m.kind === 'pbr' && m.shaderId === 'pbr' && m.vertexEntry === 'vs_main' && m.fragmentEntry === 'fs_main' && m.features === 0 && !m.failed;
}
