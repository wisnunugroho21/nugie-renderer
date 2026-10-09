import type { GLTFDocument } from './GLTFParser';
import type { MaterialAsset } from '../AssetTypes';
import type { GLTFTextureInfo } from './GLTFTypes';
import type { TextureUseRegistry } from './GLTFTextureLoader';

/** glTF default material (used when a primitive has no material): white, metallic 1, roughness 1. */
export const GLTF_DEFAULT_MATERIAL: MaterialAsset = {
  name: 'gltf-default',
  desc: { name: 'gltf-default', baseColor: [1, 1, 1, 1], metallic: 1, roughness: 1, emissive: [0, 0, 0], emissiveStrength: 1, alphaMode: 'OPAQUE', doubleSided: false },
  textures: {},
};

type Ext = Record<string, unknown>;
interface MapInfo { index?: number }

/**
 * Physical-material extensions as engine description fields. Factors map directly; the extensions' textures (clearcoat, transmission,
 * thickness, specular, iridescence, anisotropy ... maps) are not supported and are reported through `warn`.
 */
function extensionDesc(name: string, ext: Ext | undefined, warn: (m: string) => void): Partial<MaterialAsset['desc']> {
  if (!ext) return {};
  const out: Partial<MaterialAsset['desc']> = {};
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  const vec3 = (v: unknown): [number, number, number] | undefined => (Array.isArray(v) && v.length >= 3 ? [v[0], v[1], v[2]] : undefined);
  const ignored = (e: Ext, ...keys: string[]) => { for (const k of keys) if ((e[k] as MapInfo | undefined)?.index !== undefined) warn(`${name}: ${k} (a map of a KHR_materials extension) is not supported; its factor is used`); };
  const cc = ext.KHR_materials_clearcoat as Ext | undefined;
  if (cc) { out.clearcoat = num(cc.clearcoatFactor) ?? 0; out.clearcoatRoughness = num(cc.clearcoatRoughnessFactor) ?? 0; ignored(cc, 'clearcoatTexture', 'clearcoatRoughnessTexture', 'clearcoatNormalTexture'); }
  const sh = ext.KHR_materials_sheen as Ext | undefined;
  if (sh) { out.sheenColor = vec3(sh.sheenColorFactor) ?? [0, 0, 0]; out.sheenRoughness = num(sh.sheenRoughnessFactor) ?? 0; ignored(sh, 'sheenColorTexture', 'sheenRoughnessTexture'); }
  const tr = ext.KHR_materials_transmission as Ext | undefined;
  if (tr) { out.transmission = num(tr.transmissionFactor) ?? 0; ignored(tr, 'transmissionTexture'); }
  const vol = ext.KHR_materials_volume as Ext | undefined;
  if (vol) {
    out.thickness = num(vol.thicknessFactor) ?? 0;
    out.attenuationColor = vec3(vol.attenuationColor) ?? [1, 1, 1];
    const d = num(vol.attenuationDistance);
    if (d !== undefined && Number.isFinite(d)) out.attenuationDistance = d;
    ignored(vol, 'thicknessTexture');
  }
  const ior = ext.KHR_materials_ior as Ext | undefined;
  if (ior) out.ior = num(ior.ior) ?? 1.5;
  const sp = ext.KHR_materials_specular as Ext | undefined;
  if (sp) { out.specularIntensity = num(sp.specularFactor) ?? 1; out.specularColor = vec3(sp.specularColorFactor) ?? [1, 1, 1]; ignored(sp, 'specularTexture', 'specularColorTexture'); }
  const ir = ext.KHR_materials_iridescence as Ext | undefined;
  if (ir) {
    out.iridescence = num(ir.iridescenceFactor) ?? 0;
    out.iridescenceIor = num(ir.iridescenceIor) ?? 1.3;
    out.iridescenceThickness = [num(ir.iridescenceThicknessMinimum) ?? 100, num(ir.iridescenceThicknessMaximum) ?? 400];
    ignored(ir, 'iridescenceTexture', 'iridescenceThicknessTexture');
  }
  const an = ext.KHR_materials_anisotropy as Ext | undefined;
  if (an) { out.anisotropy = num(an.anisotropyStrength) ?? 0; out.anisotropyRotation = num(an.anisotropyRotation) ?? 0; ignored(an, 'anisotropyTexture'); }
  const dp = ext.KHR_materials_dispersion as Ext | undefined;
  if (dp) out.dispersion = num(dp.dispersion) ?? 0;
  if (ext.KHR_materials_unlit) out.shading = 'basic';
  return out;
}

/** Convert glTF materials to engine PBR descriptions plus the texture-use slots they reference (warns on unsupported TEXCOORD sets). */
export function loadMaterials(doc: GLTFDocument, textures: TextureUseRegistry, warn: (m: string) => void): MaterialAsset[] {
  return (doc.json.materials ?? []).map((m, i) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    const name = m.name ?? `material${i}`;
    /** Resolve a texture reference (warning about unsupported UV sets) into a texture-use id. */
    const tex = (info: GLTFTextureInfo | undefined, srgb: boolean, what: string): number | undefined => {
      if (!info) return undefined;
      if ((info.texCoord ?? 0) !== 0) warn(`${name}: ${what} uses TEXCOORD_${info.texCoord}; only TEXCOORD_0 is supported`);
      return textures.resolve(info.index, srgb);
    };
    const bc = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const em = m.emissiveFactor ?? [0, 0, 0];
    return {
      name,
      desc: {
        name,
        baseColor: [bc[0], bc[1], bc[2], bc[3]],
        metallic: pbr.metallicFactor ?? 1,
        roughness: pbr.roughnessFactor ?? 1,
        emissive: [em[0], em[1], em[2]],
        emissiveStrength: m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1,
        normalScale: m.normalTexture?.scale ?? 1,
        occlusionStrength: m.occlusionTexture?.strength ?? 1,
        alphaMode: m.alphaMode ?? 'OPAQUE',
        alphaCutoff: m.alphaCutoff ?? 0.5,
        doubleSided: m.doubleSided ?? false,
        ...extensionDesc(name, m.extensions as Ext | undefined, warn),
      },
      textures: {
        baseColor: tex(pbr.baseColorTexture, true, 'baseColorTexture'),
        metalRough: tex(pbr.metallicRoughnessTexture, false, 'metallicRoughnessTexture'),
        normal: tex(m.normalTexture, false, 'normalTexture'),
        occlusion: tex(m.occlusionTexture, false, 'occlusionTexture'),
        emissive: tex(m.emissiveTexture, true, 'emissiveTexture'),
      },
    };
  });
}
