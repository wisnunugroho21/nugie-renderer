import { MaterialFeature } from './MaterialFlags';
import type { PBRMaterialDesc } from './Material';

/** Number of vec4s of extension parameters a PBR material owns when it uses any extension (read in pbr.wgsl through `paramVec4(m.paramBase + k)`). */
export const EXT_VEC4 = 10;

/** vec4 index of each parameter group (mirrors the `EXT_*` constants in pbr.wgsl). */
export const Ext = {
  /** shininess, toon steps, environment intensity, - */
  Style: 0,
  /** clearcoat, clearcoat roughness, transmission, thickness */
  Coat: 1,
  /** sheen colour rgb, sheen roughness */
  Sheen: 2,
  /** iridescence, film ior, film thickness min, film thickness max (nm) */
  Irid: 3,
  /** anisotropy, anisotropy rotation, ior, dispersion */
  Aniso: 4,
  /** specular colour rgb, specular intensity */
  Spec: 5,
  /** attenuation colour rgb, attenuation distance (0 = none) */
  Atten: 6,
  /** bump scale, parallax scale, displacement scale, displacement bias */
  Height: 7,
  /** phong specular colour rgb, - */
  Phong: 8,
} as const;

/** Which optional textures a material has (they select shader variants). */
export interface TexPresence { normal: boolean; height: boolean; alpha: boolean; aux: boolean; }

const any3 = (c: ArrayLike<number> | undefined): boolean => !!c && (c[0] > 0 || c[1] > 0 || c[2] > 0);

/**
 * The compile-time shader features a PBR description needs. Features that a shading model cannot use are dropped (an unlit material
 * never pays for clearcoat), so equal-looking materials share a pipeline.
 */
export function pbrFeatureMask(d: PBRMaterialDesc, tex: TexPresence, hasEnvironment: boolean): number {
  const shading = d.shading ?? 'pbr';
  const alphaMode = d.alphaMode ?? (tex.alpha ? 'BLEND' : 'OPAQUE');
  let f = 0;
  if (alphaMode === 'MASK') f |= MaterialFeature.AlphaMask;
  if (alphaMode === 'BLEND') f |= MaterialFeature.AlphaBlend;
  if (tex.normal) f |= MaterialFeature.NormalMap;
  if (tex.alpha) f |= MaterialFeature.AlphaMap;
  if (tex.height) {
    if ((d.bumpScale ?? 0) !== 0) f |= MaterialFeature.Bump;
    if ((d.parallaxScale ?? 0) > 0) f |= MaterialFeature.Parallax;
    if ((d.displacementScale ?? 0) !== 0 || (d.displacementBias ?? 0) !== 0) f |= MaterialFeature.Displacement;
  }
  switch (shading) {
    case 'basic': f |= MaterialFeature.ModelUnlit; break;
    case 'lambert': f |= MaterialFeature.ModelLambert; break;
    case 'phong': f |= MaterialFeature.ModelPhong; break;
    case 'toon': f |= MaterialFeature.ModelToon | (tex.aux ? MaterialFeature.ToonRamp : 0); break;
    case 'matcap': f |= MaterialFeature.ModelMatcap; break;
    default: break;
  }
  if (hasEnvironment && shading !== 'basic' && shading !== 'matcap') f |= MaterialFeature.EnvMap;
  if (shading === 'pbr') {
    const transmission = (d.transmission ?? 0) > 0;
    if ((d.clearcoat ?? 0) > 0) f |= MaterialFeature.Clearcoat;
    if (any3(d.sheenColor)) f |= MaterialFeature.Sheen;
    if (transmission) f |= MaterialFeature.Transmission;
    if (transmission && ((d.thickness ?? 0) > 0)) f |= MaterialFeature.Volume;
    if (transmission && (d.dispersion ?? 0) > 0) f |= MaterialFeature.Dispersion;
    if ((d.iridescence ?? 0) > 0) f |= MaterialFeature.Iridescence;
    if ((d.anisotropy ?? 0) !== 0) f |= MaterialFeature.Anisotropy;
    const c = d.specularColor;
    if ((d.ior !== undefined && d.ior !== 1.5) || (d.specularIntensity !== undefined && d.specularIntensity !== 1) || (c && (c[0] !== 1 || c[1] !== 1 || c[2] !== 1))) f |= MaterialFeature.Specular;
    if (tex.aux && (f & (MaterialFeature.Clearcoat | MaterialFeature.Transmission | MaterialFeature.Volume))) f |= MaterialFeature.ExtMap;
  }
  return f;
}

/** True when `mask` needs the extension parameter block (anything beyond plain metallic-roughness PBR with maps). */
export function needsExtParams(mask: number, d: PBRMaterialDesc): boolean {
  const ext = MaterialFeature.Bump | MaterialFeature.Parallax | MaterialFeature.Displacement | MaterialFeature.EnvMap | MaterialFeature.ExtMap
    | MaterialFeature.Clearcoat | MaterialFeature.Sheen | MaterialFeature.Transmission | MaterialFeature.Iridescence | MaterialFeature.Anisotropy
    | MaterialFeature.Specular | MaterialFeature.Volume | MaterialFeature.Dispersion | MaterialFeature.ModelPhong | MaterialFeature.ModelToon;
  return (mask & ext) !== 0 || (d.shading ?? 'pbr') !== 'pbr';
}

/** Write the extension parameters of `d` into `out` at float offset `base * 4` (EXT_VEC4 vec4s). */
export function packPBRExt(d: PBRMaterialDesc, out: Float32Array, base: number): void {
  const set = (k: number, a: number, b: number, c: number, e: number) => {
    const o = (base + k) * 4;
    out[o] = a; out[o + 1] = b; out[o + 2] = c; out[o + 3] = e;
  };
  const sheen = d.sheenColor ?? [0, 0, 0], att = d.attenuationColor ?? [1, 1, 1], sc = d.specularColor ?? [1, 1, 1], ps = d.specular ?? [0.2, 0.2, 0.2];
  const film = d.iridescenceThickness ?? [100, 400];
  const attDist = d.attenuationDistance !== undefined && Number.isFinite(d.attenuationDistance) ? d.attenuationDistance : 0;
  set(Ext.Style, d.shininess ?? 30, Math.max(1, d.toonSteps ?? 3), d.envIntensity ?? 1, 0);
  set(Ext.Coat, d.clearcoat ?? 0, d.clearcoatRoughness ?? 0.03, d.transmission ?? 0, d.thickness ?? 0);
  set(Ext.Sheen, sheen[0], sheen[1], sheen[2], d.sheenRoughness ?? 0.5);
  set(Ext.Irid, d.iridescence ?? 0, d.iridescenceIor ?? 1.3, film[0], film[1]);
  set(Ext.Aniso, d.anisotropy ?? 0, d.anisotropyRotation ?? 0, d.ior ?? 1.5, d.dispersion ?? 0);
  set(Ext.Spec, sc[0], sc[1], sc[2], d.specularIntensity ?? 1);
  set(Ext.Atten, att[0], att[1], att[2], attDist);
  set(Ext.Height, d.bumpScale ?? 0, d.parallaxScale ?? 0, d.displacementScale ?? 0, d.displacementBias ?? 0);
  set(Ext.Phong, ps[0], ps[1], ps[2], 0);
  set(9, 0, 0, 0, 0);
}
