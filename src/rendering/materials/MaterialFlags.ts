/** Shader-variant feature bits (compile-time) – keep this set SMALL. Everything else is runtime data. */
export const MaterialFeature = {
  AlphaMask: 1 << 0,
  AlphaBlend: 1 << 1,
  NormalMap: 1 << 2,
  /** Vertex-deformation variants come from the MESH (see DeformMask), not the material. */
  Skinning: 1 << 3,
  MorphTargets: 1 << 4,
} as const;

/** Every define a PBR variant sets (always all, so shaders can use `if NAME {}` unconditionally). */
export function featureDefines(mask: number): Record<string, boolean> {
  return {
    ALPHA_MASK: (mask & MaterialFeature.AlphaMask) !== 0,
    ALPHA_BLEND: (mask & MaterialFeature.AlphaBlend) !== 0,
    HAS_NORMAL_MAP: (mask & MaterialFeature.NormalMap) !== 0,
    HAS_SKINNING: (mask & MaterialFeature.Skinning) !== 0,
    HAS_MORPH_TARGETS: (mask & MaterialFeature.MorphTargets) !== 0,
  };
}

/** Runtime per-material flag bits stored in MaterialRecord.flags. */
export const MaterialRecordFlags = {
  DoubleSided: 1 << 0,
  Custom: 1 << 1,
  Emissive: 1 << 2,
} as const;
