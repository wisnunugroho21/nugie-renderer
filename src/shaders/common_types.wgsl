// ============================================================================
// ENGINE BINDING CONTRACT (included in every engine and custom shader)
//
//   group(0) Frame   : camera / time
//   group(1) Scene   : global lighting state: lights, clusters, shadows, environment (IBL), LTC tables
//   group(2) Material: shared material records, custom params, sampler, 5 textures
//   group(3) Object  : transform matrices + per-draw instance records + deformation data
//
// Custom shaders MUST NOT declare @group/@binding resources: the engine owns all
// GPU resources. Custom parameters are read with generated accessors (see MaterialManager).
// ============================================================================

struct Frame {
  viewProjection: mat4x4<f32>,
  view: mat4x4<f32>,
  projection: mat4x4<f32>,
  cameraPosition: vec4<f32>,   // xyz position, w = time (seconds)
  viewport: vec4<f32>,         // width, height, near, far
};

// Light types (Light.directionType.w)
const LIGHT_DIRECTIONAL: u32 = 0u;
const LIGHT_POINT: u32 = 1u;
const LIGHT_SPOT: u32 = 2u;
const LIGHT_AREA: u32 = 4u;

struct Light {                  // 96 bytes (6 x vec4)
  positionRange: vec4<f32>,     // xyz = world position, w = range in meters (0 = unlimited)
  colorIntensity: vec4<f32>,    // rgb = color, w = intensity
  directionType: vec4<f32>,     // xyz = direction the light POINTS (travels) / area normal, w = type
  spot: vec4<f32>,              // x = cos(outer cone), y = 1 / max(cos(inner) - cos(outer), 1e-4), z = shadow slot (-1 none), w = flags (bit0: two-sided area)
  right: vec4<f32>,             // area lights: xyz = unit right axis, w = half width
  up: vec4<f32>,                // area lights: xyz = unit up axis, w = half height
};

struct Scene {
  counts: vec4<u32>,            // x = number of lights in the Light buffer
  clusterGrid: vec4<u32>,       // xyz = cluster dimensions, w = 1 when clustered shading is active (0 = loop over all lights)
  clusterDepth: vec4<f32>,      // x = near, y = far, z = slices / ln(far / near), w = (unused)
  env: vec4<f32>,               // x = intensity, y = rotation about +Y (radians), z = specular mip count, w = 1 when an environment is bound
  shadow: vec4<f32>,            // x = cascade count, y = PCF radius (texels), z = shadow normal bias, w = 1 when shadows are enabled
  cascadeSplits: vec4<f32>,     // view-space far distance of each cascade (up to 4)
  ambientSky: vec4<f32>,        // summed hemisphere ambient (rgb), used when no environment is bound
  ambientGround: vec4<f32>,
  shadowParams: vec4<f32>,      // x = shadow map size (texels), y = receiver depth bias (NDC), z = fog volume tile size (pixels)
  fogParams: vec4<f32>,         // x = density, y = height falloff, z = phase anisotropy g, w = fog volume far distance
  fogColor: vec4<f32>,          // rgb = ambient in-scatter colour, w = 1 when the fog volume is active
};

struct MaterialRecord {
  baseColor: vec4<f32>,
  emissive: vec4<f32>,         // rgb color, w = strength (HDR multiplier)
  metallic: f32,
  roughness: f32,
  normalScale: f32,
  occlusionStrength: f32,
  alphaCutoff: f32,
  flags: u32,
  paramBase: u32,              // offset (in vec4s) into customParams
  _pad: u32,
};

struct Instance {
  transformIndex: u32,
  materialIndex: u32,
  jointOffset: u32,       // first joint matrix in jointMatrices
  jointCount: u32,        // 0 = not skinned
  morphWeightOffset: u32, // first u32 of this state's (targetIndex, weightBits) pairs in morphWeights
  morphTargetCount: u32,  // number of ACTIVE targets (pairs)
  objectId: u32,
  vertexBase: u32,        // mesh baseVertex: vertex_index - vertexBase = mesh-local vertex
  vertexCount: u32,
  skinBase: u32,          // element offset of this mesh's skin data
  morphBase: u32,         // element offset of this mesh's morph deltas (target-major)
  flags: u32,
};

struct VertexInput {
  @builtin(instance_index) instance: u32,
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) tangent: vec4<f32>,
};
