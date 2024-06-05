// ------------- Struct ------------- 

#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_2PI 0.15915494309189535
#define PI 3.14159265359
#define FLT_MAX 3.0e+38
#define FLT_MIN 1.0-38
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
  float t;
  uint hitIndex;
  uint hitTypeIndex;
};

struct DirectData {
  vec4 normalIsIlluminate;
  vec3 origin;
  uint materialIndex;
};

struct DirectResult {
  vec4 radiancePdf;
};

struct IndirectResult {
  vec4 radiancePdf;
  Ray nextRay;
};

struct LightResult {
  vec4 radianceIsIlluminate;
};

struct MissResult {
  vec4 radianceIsMiss;
};

struct IntegratorResult {
  vec4 totalRadianceIsRayBounce;
  vec4 totalIndirectPdf;
};

struct SamplingResult {
  vec4 finalColorCountSample;
};