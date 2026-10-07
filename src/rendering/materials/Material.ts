export type AlphaMode = 'OPAQUE' | 'MASK' | 'BLEND';
export type RenderQueue = 'opaque' | 'alphaMask' | 'transparent';

/** A texture owned by the TextureManager; materials only reference it (ownership stays with the engine). */
export interface TextureRef { id: string; view: GPUTextureView; }

/** Slot order matches bindings 3..7 in the material bind group. */
export const TextureSlot = { BaseColor: 0, MetalRough: 1, Normal: 2, Occlusion: 3, Emissive: 4 } as const;
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
  textures?: { baseColor?: TextureRef; metalRough?: TextureRef; normal?: TextureRef; occlusion?: TextureRef; emissive?: TextureRef };
  sampler?: GPUSamplerDescriptor;
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
