import { describe, expect, it } from 'vitest';
import { makeFakeGPU } from './helpers/fakeGPU';
import { GLBBuilder } from './helpers/glbBuilder';
import { loadGLTF } from '../src/assets/gltf/GLTFLoader';
import { MaterialFeature, featureDefines } from '../src/rendering/materials/MaterialFlags';
import { EXT_VEC4, Ext, needsExtParams, packPBRExt, pbrFeatureMask } from '../src/rendering/materials/PBRExtension';
import { TextureSlot, type PBRMaterialDesc, type TextureRef } from '../src/rendering/materials/Material';
import type { Environment } from '../src/rendering/lighting/IBL';

const tex = (id: string): TextureRef => ({ id, view: { id } as unknown as GPUTextureView });
const none = { normal: false, height: false, alpha: false, aux: false };
const F = MaterialFeature;
const has = (mask: number, ...bits: number[]) => bits.every((b) => (mask & b) !== 0);

describe('pbrFeatureMask', () => {
  it('plain PBR has no extension features', () => {
    expect(pbrFeatureMask({}, none, false)).toBe(0);
    expect(pbrFeatureMask({ baseColor: [1, 0, 0, 1], metallic: 0.5, roughness: 0.2 }, none, false)).toBe(0);
    expect(needsExtParams(0, {})).toBe(false);
  });

  it('maps every extension to its feature bit, and only when its value is active', () => {
    const m = (d: PBRMaterialDesc, t = none, env = false) => pbrFeatureMask(d, t, env);
    expect(has(m({ clearcoat: 0.5 }), F.Clearcoat)).toBe(true);
    expect(m({ clearcoat: 0 })).toBe(0);
    expect(has(m({ sheenColor: [0.5, 0, 0] }), F.Sheen)).toBe(true);
    expect(m({ sheenColor: [0, 0, 0] })).toBe(0);
    expect(has(m({ transmission: 0.7 }), F.Transmission)).toBe(true);
    expect(has(m({ transmission: 1, thickness: 0.5 }), F.Transmission, F.Volume)).toBe(true);
    expect(m({ thickness: 0.5 }) & F.Volume).toBe(0);                       // thickness alone (no transmission) means nothing
    expect(has(m({ transmission: 1, dispersion: 5 }), F.Dispersion)).toBe(true);
    expect(m({ dispersion: 5 }) & F.Dispersion).toBe(0);
    expect(has(m({ iridescence: 1 }), F.Iridescence)).toBe(true);
    expect(has(m({ anisotropy: -0.4 }), F.Anisotropy)).toBe(true);
    expect(m({ anisotropy: 0 })).toBe(0);
    expect(has(m({ ior: 1.8 }), F.Specular)).toBe(true);
    expect(m({ ior: 1.5 }) & F.Specular).toBe(0);
    expect(has(m({ specularIntensity: 0.5 }), F.Specular)).toBe(true);
    expect(has(m({ specularColor: [1, 0.5, 1] }), F.Specular)).toBe(true);
    expect(m({ specularColor: [1, 1, 1], specularIntensity: 1 })).toBe(0);
  });

  it('height-map features need the height texture', () => {
    const t = { ...none, height: true };
    expect(pbrFeatureMask({ bumpScale: 1 }, none, false)).toBe(0);
    expect(has(pbrFeatureMask({ bumpScale: 1 }, t, false), F.Bump)).toBe(true);
    expect(has(pbrFeatureMask({ parallaxScale: 0.05 }, t, false), F.Parallax)).toBe(true);
    expect(has(pbrFeatureMask({ displacementScale: 0.3 }, t, false), F.Displacement)).toBe(true);
    expect(has(pbrFeatureMask({ displacementBias: -0.1 }, t, false), F.Displacement)).toBe(true);
    expect(pbrFeatureMask({}, t, false)).toBe(0);                            // a height map alone does nothing
  });

  it('shading models are exclusive, drop physical extensions they cannot use, keep texture features', () => {
    const all: PBRMaterialDesc = { clearcoat: 1, sheenColor: [1, 1, 1], transmission: 1, iridescence: 1, anisotropy: 1, ior: 2 };
    const phys = F.Clearcoat | F.Sheen | F.Transmission | F.Iridescence | F.Anisotropy | F.Specular;
    expect(has(pbrFeatureMask(all, none, false), phys)).toBe(true);
    for (const [shading, bit] of [['basic', F.ModelUnlit], ['lambert', F.ModelLambert], ['phong', F.ModelPhong], ['toon', F.ModelToon], ['matcap', F.ModelMatcap]] as const) {
      const f = pbrFeatureMask({ ...all, shading }, none, false);
      expect(f & bit).toBe(bit);
      expect(f & phys).toBe(0);
      const models = F.ModelUnlit | F.ModelLambert | F.ModelPhong | F.ModelToon | F.ModelMatcap;
      expect(f & models).toBe(bit);
    }
    expect(has(pbrFeatureMask({ shading: 'toon' }, { ...none, aux: true }, false), F.ModelToon, F.ToonRamp)).toBe(true);
    expect(pbrFeatureMask({ shading: 'toon' }, none, false) & F.ToonRamp).toBe(0);
    expect(has(pbrFeatureMask({ shading: 'lambert' }, { ...none, normal: true, alpha: true }, false), F.NormalMap, F.AlphaMap)).toBe(true);
  });

  it('environment applies to lit models only; the aux map is the packed factors only for physical extensions', () => {
    expect(has(pbrFeatureMask({}, none, true), F.EnvMap)).toBe(true);
    expect(has(pbrFeatureMask({ shading: 'phong' }, none, true), F.EnvMap)).toBe(true);
    expect(pbrFeatureMask({ shading: 'basic' }, none, true) & F.EnvMap).toBe(0);
    expect(pbrFeatureMask({ shading: 'matcap' }, none, true) & F.EnvMap).toBe(0);
    const aux = { ...none, aux: true };
    expect(has(pbrFeatureMask({ clearcoat: 1 }, aux, false), F.ExtMap)).toBe(true);
    expect(pbrFeatureMask({}, aux, false) & F.ExtMap).toBe(0);
    expect(pbrFeatureMask({ metallic: 1 }, aux, false)).toBe(0);
  });

  it('alpha mode bits, and an alpha map implies blending unless stated', () => {
    expect(pbrFeatureMask({ alphaMode: 'MASK' }, none, false)).toBe(F.AlphaMask);
    expect(pbrFeatureMask({ alphaMode: 'BLEND' }, none, false)).toBe(F.AlphaBlend);
    expect(has(pbrFeatureMask({}, { ...none, alpha: true }, false), F.AlphaBlend, F.AlphaMap)).toBe(true);
    expect(has(pbrFeatureMask({ alphaMode: 'MASK' }, { ...none, alpha: true }, false), F.AlphaMask, F.AlphaMap)).toBe(true);
  });

  it('featureDefines names every feature exactly once', () => {
    const d = featureDefines(F.Clearcoat | F.ModelToon);
    expect(d.HAS_CLEARCOAT).toBe(true); expect(d.MODEL_TOON).toBe(true); expect(d.HAS_SHEEN).toBe(false);
    expect(Object.keys(d).length).toBe(25);
    expect(Object.keys(featureDefines(0)).every((k) => featureDefines(0)[k] === false)).toBe(true);
    const bits = Object.values(F);
    expect(new Set(bits).size).toBe(bits.length);                           // no two features share a bit
  });
});

describe('packPBRExt', () => {
  it('writes the documented layout with defaults', () => {
    const out = new Float32Array(EXT_VEC4 * 4);
    packPBRExt({}, out, 0);
    const v = (k: number) => Array.from(out.slice(k * 4, k * 4 + 4));
    expect(v(Ext.Style)).toEqual([30, 3, 1, 0]);                             // shininess, toon steps, env intensity
    expect(v(Ext.Coat)).toEqual([0, expect.closeTo(0.03, 5), 0, 0]);
    expect(v(Ext.Irid)).toEqual([0, expect.closeTo(1.3, 5), 100, 400]);
    expect(v(Ext.Aniso)).toEqual([0, 0, 1.5, 0]);                            // ior default 1.5
    expect(v(Ext.Spec)).toEqual([1, 1, 1, 1]);
    expect(v(Ext.Atten)).toEqual([1, 1, 1, 0]);                              // distance 0 = no absorption
    expect(v(Ext.Phong).slice(0, 3)).toEqual([expect.closeTo(0.2, 5), expect.closeTo(0.2, 5), expect.closeTo(0.2, 5)]);
  });

  it('writes given values at an offset and treats an infinite attenuation distance as none', () => {
    const out = new Float32Array((EXT_VEC4 + 3) * 4);
    packPBRExt({
      clearcoat: 0.8, clearcoatRoughness: 0.2, transmission: 0.9, thickness: 2, sheenColor: [0.1, 0.2, 0.3], sheenRoughness: 0.6,
      iridescence: 1, iridescenceThickness: [200, 500], anisotropy: 0.5, anisotropyRotation: 1, ior: 1.33, dispersion: 4,
      attenuationColor: [0.5, 0.6, 0.7], attenuationDistance: Infinity, bumpScale: 2, parallaxScale: 0.05, displacementScale: 0.4, displacementBias: -0.2,
      shininess: 80, toonSteps: 5, envIntensity: 2, specular: [1, 0, 0],
    }, out, 3);
    const v = (k: number) => Array.from(out.slice((3 + k) * 4, (3 + k) * 4 + 4)).map((x) => +x.toFixed(4));
    expect(v(Ext.Style)).toEqual([80, 5, 2, 0]);
    expect(v(Ext.Coat)).toEqual([0.8, 0.2, 0.9, 2]);
    expect(v(Ext.Sheen)).toEqual([0.1, 0.2, 0.3, 0.6]);
    expect(v(Ext.Irid)).toEqual([1, 1.3, 200, 500]);
    expect(v(Ext.Aniso)).toEqual([0.5, 1, 1.33, 4]);
    expect(v(Ext.Atten)).toEqual([0.5, 0.6, 0.7, 0]);
    expect(v(Ext.Height)).toEqual([2, 0.05, 0.4, -0.2]);
    expect(v(Ext.Phong)).toEqual([1, 0, 0, 0]);
    expect(Array.from(out.slice(0, 12)).every((x) => x === 0)).toBe(true);   // nothing before the offset
  });
});

describe('MaterialManager with the extended PBR model', () => {
  function setup() {
    const g = makeFakeGPU();
    const bindGroups: GPUBindGroupDescriptor[] = [];
    const dev = g.device as unknown as { createBindGroup: (d: GPUBindGroupDescriptor) => unknown };
    dev.createBindGroup = (d) => { bindGroups.push(d); return {}; };
    return { mm: g.materials, bindGroups };
  }

  it('plain PBR owns no extension block; extended PBR does, and the record points at it', () => {
    const { mm } = setup();
    const plain = mm.createPBR({ baseColor: [1, 0, 0, 1] });
    expect(mm.get(plain).paramCount).toBe(0);
    const coat = mm.createPBR({ clearcoat: 1, sheenColor: [1, 1, 1] });
    expect(mm.get(coat).paramCount).toBe(EXT_VEC4);
    expect(has(mm.get(coat).features, F.Clearcoat, F.Sheen)).toBe(true);
    expect(mm.get(plain).features).toBe(0);
    expect(mm.get(coat).kind).toBe('pbr');
    const toon = mm.createPBR({ shading: 'toon' });
    expect(mm.get(toon).paramCount).toBe(EXT_VEC4);                          // style parameters live in the block
    expect(mm.get(toon).paramBase).toBe(mm.get(coat).paramBase + EXT_VEC4);
  });

  it('equal descriptions share a pipeline sort id, different features do not', () => {
    const { mm } = setup();
    const a = mm.createPBR({ clearcoat: 1 }), b = mm.createPBR({ clearcoat: 0.3, baseColor: [0, 1, 0, 1] }), c = mm.createPBR({ sheenColor: [1, 1, 1] });
    expect(mm.get(a).pipelineSortId).toBe(mm.get(b).pipelineSortId);
    expect(mm.get(a).pipelineSortId).not.toBe(mm.get(c).pipelineSortId);
  });

  it('setPBR merges, switches variants when an extension toggles, keeps the block', () => {
    const { mm } = setup();
    const id = mm.createPBR({ baseColor: [1, 1, 1, 1], roughness: 0.5 });
    const base = mm.get(id).pipelineSortId;
    mm.setPBR(id, { clearcoat: 1 });
    expect(has(mm.get(id).features, F.Clearcoat)).toBe(true);
    expect(mm.get(id).pipelineSortId).not.toBe(base);
    expect(mm.get(id).pbr).toMatchObject({ roughness: 0.5, clearcoat: 1 });  // earlier values survive a partial update
    const baseBlock = mm.get(id).paramBase;
    mm.setPBR(id, { clearcoat: 0 });
    expect(mm.get(id).features & F.Clearcoat).toBe(0);
    expect(mm.get(id).pipelineSortId).toBe(base);
    expect(mm.get(id).paramBase).toBe(baseBlock);
    mm.setPBR(id, { transmission: 1, thickness: 1 });
    expect(has(mm.get(id).features, F.Transmission, F.Volume)).toBe(true);
    mm.setPBR(id, { alphaMode: 'BLEND' });
    expect(mm.get(id).queue).toBe('transparent');
    expect(has(mm.get(id).features, F.AlphaBlend, F.Transmission)).toBe(true);
    expect(() => mm.setPBR(mm.errorMaterial, { clearcoat: 1 })).toThrow();
  });

  it('textures select variants: height features follow the scale, alpha map defaults to blending', () => {
    const { mm } = setup();
    const id = mm.createPBR({ bumpScale: 1, parallaxScale: 0.04, displacementScale: 0.2 });
    expect(mm.get(id).features & (F.Bump | F.Parallax | F.Displacement)).toBe(0);   // no height map yet
    mm.setTexture(id, TextureSlot.Height, tex('h'));
    expect(has(mm.get(id).features, F.Bump, F.Parallax, F.Displacement)).toBe(true);
    mm.setTexture(id, TextureSlot.Height, null);
    expect(mm.get(id).features & (F.Bump | F.Parallax | F.Displacement)).toBe(0);

    const a = mm.createPBR({ textures: { alpha: tex('a') } });
    expect(mm.get(a).alphaMode).toBe('BLEND');
    expect(mm.get(a).queue).toBe('transparent');
    expect(has(mm.get(a).features, F.AlphaMap, F.AlphaBlend)).toBe(true);
    const masked = mm.createPBR({ alphaMode: 'MASK', textures: { alpha: tex('a2') } });
    expect(mm.get(masked).alphaMode).toBe('MASK');
    const late = mm.createPBR({});
    mm.setTexture(late, TextureSlot.Alpha, tex('a3'));
    expect(mm.get(late).alphaMode).toBe('BLEND');
  });

  it('binds nine textures + the environment cube, with defaults for the empty slots', () => {
    const { mm, bindGroups } = setup();
    const env = { specularView: { cube: true } } as unknown as Environment;
    const id = mm.createPBR({ environment: env, textures: { height: tex('h'), aux: tex('x') } });
    mm.getBindGroup(id);
    const d = bindGroups[bindGroups.length - 1];
    const entries = Array.from(d.entries as Iterable<GPUBindGroupEntry>);
    expect(entries.map((e) => e.binding)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const view = (b: number) => (entries[b].resource as { id?: string; cube?: boolean });
    expect(view(7).id).toBe('h');                                            // height -> binding 7
    expect(view(9).id).toBe('x');                                            // aux -> binding 9
    expect(view(10).cube).toBe(true);                                        // environment -> binding 10
    const noEnv = mm.createPBR({});
    mm.getBindGroup(noEnv);
    const e2 = Array.from(bindGroups[bindGroups.length - 1].entries as Iterable<GPUBindGroupEntry>);
    expect((e2[10].resource as { cube?: boolean }).cube).toBeUndefined();   // the shared black cube instead
  });

  it('keeps extension parameters valid when the shared buffers grow', () => {
    const { mm } = setup();
    const first = mm.createPBR({ clearcoat: 1 });
    const gen = mm.generation;
    for (let i = 0; i < 80; i++) mm.createPBR({ clearcoat: 1, sheenColor: [0.5, 0.5, 0.5] });   // > 64 records and > 256 vec4 of parameters
    expect(mm.generation).toBeGreaterThan(gen);
    expect(mm.get(first).paramBase).toBe(0);
    expect(mm.get(first + 80).paramBase).toBe(80 * EXT_VEC4);
    mm.flush();                                                              // uploads without throwing
  });
});

describe('glTF material extensions', () => {
  async function load(ext: Record<string, unknown>, required = false) {
    const b = new GLBBuilder();
    b.material({ name: 'x', extensions: ext });
    b.addToScene(b.node({}));
    if (required) (b as unknown as { json: { extensionsRequired?: string[] } }).json.extensionsRequired = Object.keys(ext);
    return loadGLTF(b.glb());
  }

  it('maps clearcoat, sheen, transmission, volume, ior, specular, iridescence, anisotropy and dispersion factors', async () => {
    const a = await load({
      KHR_materials_clearcoat: { clearcoatFactor: 0.9, clearcoatRoughnessFactor: 0.1 },
      KHR_materials_sheen: { sheenColorFactor: [0.2, 0.3, 0.4], sheenRoughnessFactor: 0.7 },
      KHR_materials_transmission: { transmissionFactor: 0.8 },
      KHR_materials_volume: { thicknessFactor: 1.5, attenuationColor: [0.9, 0.5, 0.1], attenuationDistance: 2 },
      KHR_materials_ior: { ior: 1.33 },
      KHR_materials_specular: { specularFactor: 0.6, specularColorFactor: [1, 0.9, 0.8] },
      KHR_materials_iridescence: { iridescenceFactor: 1, iridescenceIor: 1.6, iridescenceThicknessMinimum: 150, iridescenceThicknessMaximum: 450 },
      KHR_materials_anisotropy: { anisotropyStrength: 0.6, anisotropyRotation: 0.5 },
      KHR_materials_dispersion: { dispersion: 3 },
    });
    expect(a.materials[0].desc).toMatchObject({
      clearcoat: 0.9, clearcoatRoughness: 0.1, sheenColor: [0.2, 0.3, 0.4], sheenRoughness: 0.7, transmission: 0.8, thickness: 1.5,
      attenuationColor: [0.9, 0.5, 0.1], attenuationDistance: 2, ior: 1.33, specularIntensity: 0.6, specularColor: [1, 0.9, 0.8],
      iridescence: 1, iridescenceIor: 1.6, iridescenceThickness: [150, 450], anisotropy: 0.6, anisotropyRotation: 0.5, dispersion: 3,
    });
    expect(a.warnings).toEqual([]);
  });

  it('applies the extension defaults, ignores an infinite attenuation distance, and maps unlit to the basic model', async () => {
    const a = await load({ KHR_materials_clearcoat: {}, KHR_materials_volume: {}, KHR_materials_unlit: {} });
    expect(a.materials[0].desc).toMatchObject({ clearcoat: 0, clearcoatRoughness: 0, thickness: 0, shading: 'basic' });
    expect(a.materials[0].desc.attenuationDistance).toBeUndefined();
    const plain = await load({});
    expect(plain.materials[0].desc.clearcoat).toBeUndefined();               // no extension, no field
    expect(plain.materials[0].desc.shading).toBeUndefined();
  });

  it('warns that the extensions\' own textures are not supported and accepts the extensions as required', async () => {
    const a = await load({ KHR_materials_transmission: { transmissionFactor: 1, transmissionTexture: { index: 0 } }, KHR_materials_volume: { thicknessTexture: { index: 0 } } }, true);
    expect(a.warnings.join()).toMatch(/transmissionTexture[\s\S]*not supported/);
    expect(a.warnings.join()).toMatch(/thicknessTexture/);
    expect(a.materials[0].desc.transmission).toBe(1);
  });
});
