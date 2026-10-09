/**
 * Shader-variant feature bits (compile-time). Everything else is runtime data. A PBR material's mask is derived from its description
 * (see `pbrFeatureMask`): unused features cost nothing because their code is compiled out of that material's shader variant.
 */
export const MaterialFeature = {
  AlphaMask: 1 << 0,
  AlphaBlend: 1 << 1,
  NormalMap: 1 << 2,
  /** Vertex-deformation variants come from the MESH (see DeformMask), not the material. */
  Skinning: 1 << 3,
  MorphTargets: 1 << 4,
  /** Bump mapping from the height texture (normal perturbed by its screen-space gradient). */
  Bump: 1 << 5,
  /** Parallax occlusion mapping from the height texture (per-pixel uv offset). */
  Parallax: 1 << 6,
  /** Vertex displacement from the height texture (needs a subdivided mesh). */
  Displacement: 1 << 7,
  /** Separate alpha map (G channel multiplies the base-colour alpha). */
  AlphaMap: 1 << 8,
  /** Per-material environment cube map. */
  EnvMap: 1 << 9,
  /** The aux texture carries per-pixel physical factors: R clearcoat, G clearcoat roughness, B transmission, A thickness. */
  ExtMap: 1 << 10,
  Clearcoat: 1 << 11,
  Sheen: 1 << 12,
  Transmission: 1 << 13,
  Iridescence: 1 << 14,
  Anisotropy: 1 << 15,
  /** KHR_materials_ior / specular: custom index of refraction, specular colour and intensity. */
  Specular: 1 << 16,
  Volume: 1 << 17,
  Dispersion: 1 << 18,
  /** Alternative shading models (MeshBasic / Lambert / Phong / Toon / Matcap). At most one is set; none = physically based. */
  ModelUnlit: 1 << 19,
  ModelLambert: 1 << 20,
  ModelPhong: 1 << 21,
  ModelToon: 1 << 22,
  ModelMatcap: 1 << 23,
  /** Toon shading reads its light ramp from the aux texture (otherwise `toonSteps` flat bands). */
  ToonRamp: 1 << 24,
} as const;

/** Every define a PBR variant sets (always all, so shaders can use `if NAME {}` unconditionally). */
export function featureDefines(mask: number): Record<string, boolean> {
  const has = (bit: number) => (mask & bit) !== 0;
  return {
    ALPHA_MASK: has(MaterialFeature.AlphaMask),
    ALPHA_BLEND: has(MaterialFeature.AlphaBlend),
    HAS_NORMAL_MAP: has(MaterialFeature.NormalMap),
    HAS_SKINNING: has(MaterialFeature.Skinning),
    HAS_MORPH_TARGETS: has(MaterialFeature.MorphTargets),
    HAS_BUMP: has(MaterialFeature.Bump),
    HAS_PARALLAX: has(MaterialFeature.Parallax),
    HAS_DISPLACEMENT: has(MaterialFeature.Displacement),
    HAS_ALPHA_MAP: has(MaterialFeature.AlphaMap),
    HAS_ENV_MAP: has(MaterialFeature.EnvMap),
    HAS_EXT_MAP: has(MaterialFeature.ExtMap),
    HAS_CLEARCOAT: has(MaterialFeature.Clearcoat),
    HAS_SHEEN: has(MaterialFeature.Sheen),
    HAS_TRANSMISSION: has(MaterialFeature.Transmission),
    HAS_IRIDESCENCE: has(MaterialFeature.Iridescence),
    HAS_ANISOTROPY: has(MaterialFeature.Anisotropy),
    HAS_SPECULAR: has(MaterialFeature.Specular),
    HAS_VOLUME: has(MaterialFeature.Volume),
    HAS_DISPERSION: has(MaterialFeature.Dispersion),
    MODEL_UNLIT: has(MaterialFeature.ModelUnlit),
    MODEL_LAMBERT: has(MaterialFeature.ModelLambert),
    MODEL_PHONG: has(MaterialFeature.ModelPhong),
    MODEL_TOON: has(MaterialFeature.ModelToon),
    MODEL_MATCAP: has(MaterialFeature.ModelMatcap),
    TOON_RAMP: has(MaterialFeature.ToonRamp),
  };
}

/** Runtime per-material flag bits stored in MaterialRecord.flags. */
export const MaterialRecordFlags = {
  DoubleSided: 1 << 0,
  Custom: 1 << 1,
  Emissive: 1 << 2,
} as const;
