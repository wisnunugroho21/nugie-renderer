/** Subset of the glTF 2.0 JSON schema that the loader understands. */
export interface GLTFJson {
  asset: { version: string; generator?: string };
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  scene?: number;
  scenes?: { name?: string; nodes?: number[] }[];
  nodes?: GLTFNode[];
  meshes?: GLTFMesh[];
  materials?: GLTFMaterial[];
  textures?: { source?: number; sampler?: number; name?: string; extensions?: { KHR_texture_basisu?: { source?: number } } & Record<string, unknown> }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string; name?: string }[];
  samplers?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }[];
  accessors?: GLTFAccessor[];
  bufferViews?: GLTFBufferView[];
  buffers?: { uri?: string; byteLength: number; extensions?: { EXT_meshopt_compression?: { fallback?: boolean } } & Record<string, unknown> }[];
  cameras?: GLTFCamera[];
  animations?: GLTFAnimation[];
  skins?: GLTFSkin[];
}

export interface GLTFNode {
  name?: string;
  children?: number[];
  mesh?: number;
  skin?: number;
  camera?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  weights?: number[];
}

export interface GLTFMesh {
  name?: string;
  primitives: GLTFPrimitive[];
  weights?: number[];
}

export interface GLTFPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
  targets?: Record<string, number>[];
  extensions?: { KHR_draco_mesh_compression?: GLTFDracoExtension } & Record<string, unknown>;
}

/** `KHR_draco_mesh_compression`: the Draco stream's bufferView and the Draco unique id of each glTF attribute. */
export interface GLTFDracoExtension { bufferView: number; attributes: Record<string, number>; }

/** `EXT_meshopt_compression`: where the compressed stream of a bufferView lives and how to decode it. */
export interface GLTFMeshoptExtension {
  buffer: number; byteOffset?: number; byteLength: number; byteStride: number; count: number;
  mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES'; filter?: 'NONE' | 'OCTAHEDRAL' | 'QUATERNION' | 'EXPONENTIAL';
}

export interface GLTFTextureInfo { index: number; texCoord?: number; scale?: number; strength?: number; extensions?: Record<string, unknown>; }

export interface GLTFMaterial {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    baseColorTexture?: GLTFTextureInfo;
    metallicFactor?: number;
    roughnessFactor?: number;
    metallicRoughnessTexture?: GLTFTextureInfo;
  };
  normalTexture?: GLTFTextureInfo;
  occlusionTexture?: GLTFTextureInfo;
  emissiveTexture?: GLTFTextureInfo;
  emissiveFactor?: number[];
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff?: number;
  doubleSided?: boolean;
  extensions?: { KHR_materials_emissive_strength?: { emissiveStrength?: number } } & Record<string, unknown>;
}

export interface GLTFAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4';
  min?: number[];
  max?: number[];
  sparse?: {
    count: number;
    indices: { bufferView: number; byteOffset?: number; componentType: number };
    values: { bufferView: number; byteOffset?: number };
  };
}

export interface GLTFBufferView {
  buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; target?: number;
  extensions?: { EXT_meshopt_compression?: GLTFMeshoptExtension } & Record<string, unknown>;
}

export interface GLTFCamera {
  name?: string;
  type: 'perspective' | 'orthographic';
  perspective?: { yfov: number; znear: number; zfar?: number; aspectRatio?: number };
  orthographic?: { xmag: number; ymag: number; znear: number; zfar: number };
}

export interface GLTFAnimation {
  name?: string;
  channels: { sampler: number; target: { node?: number; path: 'translation' | 'rotation' | 'scale' | 'weights' } }[];
  samplers: { input: number; output: number; interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE' }[];
}

export interface GLTFSkin { name?: string; inverseBindMatrices?: number; skeleton?: number; joints: number[]; }

export enum ComponentType { Int8 = 5120, Uint8 = 5121, Int16 = 5122, Uint16 = 5123, Uint32 = 5125, Float32 = 5126 }
export enum PrimitiveMode { Points = 0, Lines = 1, LineLoop = 2, LineStrip = 3, Triangles = 4, TriangleStrip = 5, TriangleFan = 6 }
