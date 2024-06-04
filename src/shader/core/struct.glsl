// ------------- Struct ------------- 

#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_2PI 0.15915494309189535
#define PI 3.14159265359
#define FLT_MAX 3.402823e+38
#define FLT_MIN 1.175494e-38
#define K_EPSILON 1e-8

struct Sphere {
  vec4 centerRadius;
};

struct Vertex {
  vec3 position;
  vec3 normal;
  vec2 textCoord;
};

struct NormText {    
  vec4 normal;
  vec2 textCoord;
};

struct Triangle {
  uvec3 vertexIndexes;
  uint materialIndex;
};

struct Reference {
  uint materialIndex;
  uint transformIndex;
};

struct Object {
  uint firstBvhIndex;
  uint firstGeometryIndex;
  uint transformIndex;
};

struct BvhNode {
  uint leftNode;
  uint rightNode;

  uint objIndex;
  uint typeIndex;

  vec3 maximum;
  vec3 minimum;
};

struct Material {
  vec4 baseColor;
};

struct Transformation {
  mat4 pointMatrix;
  mat4 dirMatrix;
  mat4 pointInverseMatrix;
  mat4 dirInverseMatrix;
  mat4 normalMatrix;
};

struct PointLight {
  vec4 position;
  vec4 color;
};

struct SpotLight {
  vec4 position;
  vec4 color;
  vec4 direction;
  float angle;
};

struct SunLight {
  vec4 color;
  vec4 direction;
};

struct Ray {
  vec3 origin;
  vec3 direction;
};

struct HitRecord {
  float isHit;
  float t;  

  uint hitIndex;
  uint hitTypeIndex;
};

struct IndirectResult {
  float isScattered;

  vec3 radiance;
  float pdf;

  Ray nextRay;
};

struct LightResult {
  float isIlluminate;
  vec3 radiance;
};

struct DirectData {
  float isIlluminate;

  vec3 normal;
  vec3 origin;

  uint materialIndex;
};

struct DirectResult {
  float isIlluminate;

  vec3 radiance;
  float pdf;
};

struct MissResult {
  float isMiss;
  vec3 radiance;
};

struct IntegratorResult {
  vec3 totalRadiance;
  vec3 totalIndirect;

  float pdf;
  float isRayBounce;
};

struct SamplingResult {
  vec3 finalColor;
  float countSample;
};