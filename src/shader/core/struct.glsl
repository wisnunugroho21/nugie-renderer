// ------------- Struct ------------- 

// ---------------------- buffer struct ----------------------

struct Vertex {
  vec3 position;
  vec2 textCoord;
};

struct Primitive {
  uvec3 indices;
  uint materialIndex;
};

struct Object {
  uint firstBvhIndex;
  uint firstPrimitiveIndex;
  uint transformIndex;
};

struct TriangleLight {
  uvec3 indices;
  vec3 color;
};

struct PointLight {
  vec3 position;
  vec3 color;
};

struct SunLight {
  vec3 direction;
  vec3 color;
};

struct BvhNode {
  uint leftNode;
  uint rightNode;
  uint objIndex;

  vec3 maximum;
  vec3 minimum;
};

struct Material {
  vec3 baseColor;
	float metallicness;
  float roughness;
  float fresnelReflect;

  uint colorTextureIndex;
  uint normalTextureIndex;
};

struct Transformation {
  mat4 pointMatrix;
  mat4 dirMatrix;
  mat4 pointInverseMatrix;
  mat4 dirInverseMatrix;
  mat4 normalMatrix;
};

struct Ray {
  vec3 origin;
  vec3 direction;
};

struct RayData {
  Ray ray;

  float dirMin;
  vec3 dirMax;

  uint rayBounce;
};

struct HitRecord {
  bool isHit;
  uint rayBounce;

  uint hitIndex;
  uint materialIndex;

  vec3 point;
  vec3 dir;
  vec3 normal;
  vec2 uv;
};

struct IndirectShadeRecord {
  bool isIlluminate;
  vec3 radiance;
  float pdf;

  Ray nextRay;
};

struct DirectShadeRecord {
  bool isIlluminate;
  vec3 radiance;
  float pdf;
};

struct LightShadeRecord {
  bool isIlluminate;
  vec3 radiance;
  uint rayBounce;
};

struct MissRecord {
  bool isMiss;
  vec3 radiance;
};

struct IndirectSamplerData {
  uint xCoord;
  uint yCoord;
  uint rayBounce;

  Ray nextRay;
};

struct DirectData {
  bool isIlluminate;
  uint materialIndex;
  vec3 normal;
  vec2 uv;
};

struct RenderResult {
  vec3 totalIndirect;
  vec3 totalRadiance;
  float pdf;
};

// ---------------------- internal struct ----------------------

float pi = 3.14159265359;
float FLT_MAX = 1.0e+12;
float FLT_MIN = 1.0e-12;