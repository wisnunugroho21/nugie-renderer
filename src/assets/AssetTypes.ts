import type { MeshData } from '../rendering/primitives';
import type { PBRMaterialDesc } from '../rendering/materials/Material';

/** CPU-side engine assets produced by importers (glTF today). Never the source JSON. */

export interface MorphTargetData {
  /** Per-vertex deltas (3 floats each); undefined when the target does not displace that attribute. */
  position?: Float32Array;
  normal?: Float32Array;
  tangent?: Float32Array;
}

export interface PrimitiveAsset {
  /** Standard-layout geometry ready for MeshManager. */
  mesh: MeshData;
  /** Index into GLTFAsset.materials, -1 = glTF default material. */
  materialIndex: number;
  hasTangents: boolean;
  /** 4 joint indices / 4 normalized weights per vertex (JOINTS_0 / WEIGHTS_0). */
  joints0?: Uint16Array;
  weights0?: Float32Array;
  /** Optional second influence set (JOINTS_1/WEIGHTS_1) – parsed so the data model is ready. */
  joints1?: Uint16Array;
  weights1?: Float32Array;
  morphTargets?: MorphTargetData[];
}

export interface MeshAsset {
  name: string;
  primitives: PrimitiveAsset[];
  /** mesh.weights (default morph weights), if any. */
  defaultMorphWeights: Float32Array | null;
}

export interface TextureUse {
  /** Index into GLTFAsset.images. */
  image: number;
  sampler: GPUSamplerDescriptor;
  /** Colour data (base color, emissive) is sRGB; data textures are linear. */
  srgb: boolean;
}

export interface MaterialTextureRefs {
  baseColor?: number; metalRough?: number; normal?: number; occlusion?: number; emissive?: number;
}

export interface MaterialAsset {
  name: string;
  /** Scalar/state parameters (no textures). */
  desc: PBRMaterialDesc;
  /** Indices into GLTFAsset.textures. */
  textures: MaterialTextureRefs;
}

export interface ImageAsset {
  name: string;
  mimeType: string;
  /** Encoded image bytes (PNG/JPEG) when embedded; otherwise `uri` must be resolved by the caller. */
  data?: Uint8Array;
  uri?: string;
}

export interface NodeAsset {
  name: string;
  parent: number;
  children: number[];
  translation: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  mesh: number;
  skin: number;
  camera: number;
  /** node.weights override for morph targets. */
  weights: Float32Array | null;
}

export interface SkinAsset {
  name: string;
  /** Node indices of the joints, in joint order. */
  joints: number[];
  /** 16 floats per joint (column-major), identity if absent. */
  inverseBindMatrices: Float32Array;
  /** Optional skeleton root node (-1 if unspecified). */
  skeleton: number;
}

export interface CameraAsset {
  name: string;
  type: 'perspective' | 'orthographic';
  yfov: number; znear: number; zfar: number; aspectRatio: number;
  xmag: number; ymag: number;
}

export type InterpolationMode = 'STEP' | 'LINEAR' | 'CUBICSPLINE';
export type AnimationPath = 'translation' | 'rotation' | 'scale' | 'weights';

export interface AnimationChannelData {
  /** Target node index in the GLTFAsset. */
  node: number;
  path: AnimationPath;
  interpolation: InterpolationMode;
  times: Float32Array;
  /** Output values; for CUBICSPLINE 3 values (in-tangent, value, out-tangent) per key. */
  values: Float32Array;
  /** Floats per output element (3 translation/scale, 4 rotation, targetCount for weights). */
  stride: number;
}

export interface AnimationClipData {
  name: string;
  duration: number;
  channels: AnimationChannelData[];
}

export interface GLTFAsset {
  scenes: { name: string; nodes: number[] }[];
  defaultScene: number;
  nodes: NodeAsset[];
  meshes: MeshAsset[];
  materials: MaterialAsset[];
  textures: TextureUse[];
  images: ImageAsset[];
  cameras: CameraAsset[];
  skins: SkinAsset[];
  animations: AnimationClipData[];
  /** Non-fatal problems (unsupported primitive modes, ignored texCoord sets, ...). */
  warnings: string[];
}
