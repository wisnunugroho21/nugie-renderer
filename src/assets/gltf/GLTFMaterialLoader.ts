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

export function loadMaterials(doc: GLTFDocument, textures: TextureUseRegistry, warn: (m: string) => void): MaterialAsset[] {
  return (doc.json.materials ?? []).map((m, i) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    const name = m.name ?? `material${i}`;
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
