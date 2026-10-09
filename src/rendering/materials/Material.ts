import type { Environment } from '../lighting/IBL';
export type AlphaMode = 'OPAQUE' | 'MASK' | 'BLEND';
export type RenderQueue = 'opaque' | 'alphaMask' | 'transparent';

/** A texture owned by the TextureManager; materials only reference it (ownership stays with the engine). */
export interface TextureRef { id: string; view: GPUTextureView; }

/** Slot order matches bindings 3..7 in the material bind group. */
export const TextureSlot = { BaseColor: 0, MetalRough: 1, Normal: 2, Occlusion: 3, Emissive: 4, Height: 5, Alpha: 6, Aux: 7 } as const;
/** Number of 2D texture slots (the per-material environment cube is bound separately, see `Material.environment`). */
export const TEXTURE_SLOT_COUNT = 8;
export type TextureSlots = (TextureRef | null)[];

export type ParamType = 'f32' | 'vec2' | 'vec3' | 'vec4';
export interface ParamSchemaEntry { name: string; type: ParamType; }
export type ParamValues = Record<string, number | number[]>;

export interface PBRMaterialDesc {
  name?: string;
  baseColor?: [number, number, number, number];
  metallic?: number;
  roughness?: number;
  emissive?: [number, number, number];
  /** HDR multiplier; values > 1 feed bloom. Emissive surfaces are NOT light sources. */
  emissiveStrength?: number;
  normalScale?: number;
  occlusionStrength?: number;
  alphaMode?: AlphaMode;
  alphaCutoff?: number;
  doubleSided?: boolean;
  textures?: {
    baseColor?: TextureRef; metalRough?: TextureRef; normal?: TextureRef; occlusion?: TextureRef; emissive?: TextureRef;
    /** Height map (R channel, white = high) for bump, parallax and displacement. */
    height?: TextureRef;
    /** Alpha map (G channel) multiplied into the base colour's alpha (set `alphaMode` to 'MASK' / 'BLEND' - 'BLEND' is chosen for you if you leave it out). */
    alpha?: TextureRef;
    /** Matcap image (`shading: 'matcap'`, sRGB) or the light ramp of toon shading (`shading: 'toon'`, left = dark, right = lit); with `shading: 'pbr'` the packed physical factors: R clearcoat, G clearcoat roughness, B transmission, A thickness. */
    aux?: TextureRef;
  };
  sampler?: GPUSamplerDescriptor;

  // ---- shading model ------------------------------------------------------------------------------------------------------------
  /**
   * 'pbr' (default): metallic-roughness physically based shading with every extension below.
   * 'basic': unlit (base colour + emissive; three.js MeshBasicMaterial). 'lambert': diffuse only. 'phong': Blinn-Phong with `shininess` and
   * `specular`. 'toon': banded diffuse (`toonSteps` flat bands, or a ramp texture in `textures.aux`). 'matcap': colour read from `textures.aux`
   * by the view-space normal, no lights. The non-PBR models still use base colour / normal / alpha / emissive maps, fog, shadows and (lambert, phong, toon) image-based diffuse.
   */
  shading?: 'pbr' | 'basic' | 'lambert' | 'phong' | 'toon' | 'matcap';
  /** Phong: specular exponent (default 30) and colour (default 0.2 grey); toon: number of bands (default 3). */
  shininess?: number;
  specular?: [number, number, number];
  toonSteps?: number;

  // ---- height-based surface detail -----------------------------------------------------------------------------------------------
  /** Bump mapping strength from `textures.height` (> 0 enables it; ~1 is a good start). */
  bumpScale?: number;
  /** Parallax occlusion mapping depth in uv units (> 0 enables it; typical 0.02 - 0.08). Needs tangents or uv derivatives; cheaper steps at grazing angles are not used. */
  parallaxScale?: number;
  /** Vertex displacement along the normal: height * scale + bias in object units (needs a subdivided mesh, e.g. createPlaneGrid / createUVSphere). Pad the object's bounds (`world.bounds.padding`) by the scale. */
  displacementScale?: number;
  displacementBias?: number;

  // ---- environment ---------------------------------------------------------------------------------------------------------------
  /** Light this material with its own baked environment (reflection probe) instead of the scene's. See `engine.captureEnvironment` / `renderer.ibl`. */
  environment?: Environment;
  /** Multiplier of the per-material environment (default 1). */
  envIntensity?: number;

  // ---- physical extensions (glTF KHR_materials_*) -------------------------------------------------------------------------------
  /** Clear lacquer layer: strength 0..1 and its own roughness (default 0.03). */
  clearcoat?: number;
  clearcoatRoughness?: number;
  /** Fabric rim: colour (0 = off) and roughness (default 0.5). */
  sheenColor?: [number, number, number];
  sheenRoughness?: number;
  /** See-through surfaces: 0..1 fraction of light transmitted (refracted environment, tinted by base colour). Alpha stays 1; do not combine with BLEND. */
  transmission?: number;
  /** Thickness of the medium in object units (volume absorption and refraction offset) and its absorption colour / distance. */
  thickness?: number;
  attenuationColor?: [number, number, number];
  attenuationDistance?: number;
  /** Index of refraction (default 1.5; also sets the dielectric specular reflectance). */
  ior?: number;
  /** Colour fringing of refraction (KHR_materials_dispersion; 0 = none, ~5 = strong glass). */
  dispersion?: number;
  /** Thin-film interference: strength 0..1, film index (default 1.3) and thickness range in nm (default 100..400; a map-free material uses the max). */
  iridescence?: number;
  iridescenceIor?: number;
  iridescenceThickness?: [number, number];
  /** Stretched highlights (brushed metal): strength -1..1 and the direction as an angle in radians around the normal (needs tangents or uv derivatives). */
  anisotropy?: number;
  anisotropyRotation?: number;
  /** KHR_materials_specular: scales / tints the dielectric specular reflection. */
  specularIntensity?: number;
  specularColor?: [number, number, number];
}

export interface CustomMaterialDesc {
  name: string;
  /** WGSL appended after the engine prelude (common + brdf + generated param accessors). */
  wgsl: string;
  vertexEntry?: string;
  fragmentEntry?: string;
  /** Optional depth-only vertex entry used by depth/shadow passes (required if `passes.depth/shadow` and the VS deforms). */
  depthEntry?: string;
  params?: ParamSchemaEntry[];
  values?: ParamValues;
  /** Up to 5 generic textures (slots 0..4 = texBaseColor..texEmissive in WGSL). */
  textures?: Partial<Record<number, TextureRef>>;
  sampler?: GPUSamplerDescriptor;
  blend?: GPUBlendState | null;
  depthWrite?: boolean;
  depthCompare?: GPUCompareFunction;
  cullMode?: GPUCullMode;
  queue?: RenderQueue;
  /** Which passes may render this material (default: main only). Depth/shadow follow this policy. */
  passes?: { depth?: boolean; shadow?: boolean };
}

export interface PipelineState {
  cullMode: GPUCullMode;
  blend: GPUBlendState | null;
  depthWrite: boolean;
  depthCompare: GPUCompareFunction;
}

export interface Material {
  id: number;
  name: string;
  kind: 'pbr' | 'custom' | 'error';
  queue: RenderQueue;
  alphaMode: AlphaMode;
  doubleSided: boolean;
  /** Shader variant mask (PBR) – part of the shader/pipeline identity. */
  features: number;
  /** Shader identity (variant-independent): 'pbr', 'custom:<hash>' or 'error'. */
  shaderId: string;
  vertexEntry: string;
  fragmentEntry: string;
  depthEntry: string | null;
  state: PipelineState;
  passes: { main: boolean; depth: boolean; shadow: boolean };
  textures: TextureSlots;
  /** Per-material environment (reflection probe), or null to use the scene's. */
  environment: Environment | null;
  /** The last PBR description applied (kept so partial updates merge); null for custom / error materials. */
  pbr: PBRMaterialDesc | null;
  samplerDesc: GPUSamplerDescriptor;
  /** Offset (vec4 units) of this material's params in the shared custom-param buffer; paramCount in vec4s. */
  paramBase: number;
  paramCount: number;
  paramSchema: ParamSchemaEntry[];
  /** Bumped when textures/sampler change (invalidates the cached bind group). */
  version: number;
  /** Set if the custom shader failed validation/compilation; renders with the error material instead. */
  failed: boolean;
  /** Small integer identifying (shader, variant, pipeline state) for sorting; equal id => same pipeline. */
  pipelineSortId: number;
}
