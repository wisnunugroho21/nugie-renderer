// ------------- Struct ------------- 

#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_2PI 0.15915494309189535
#define PI 3.14159265359
#define FLT_MAX 3.402823e+38
#define FLT_MIN 1.175494e-38

struct Position {
  vec4 position;
};

struct Primitive {
  uvec4 indicesMaterialIndex; // x,y,z -> indices; w -> materialIndex
};

struct Object {
  uvec4 bvhPrimitiveTransformIndex; // x -> bvhIndex, y -> primitiveIndex, z -> transformIndex
};

struct BvhNode {
  uvec4 nodeObjectIndex; // x -> leftNode, y -> rightNode, z -> leftObjIndex, w -> rightObjIndex
  vec4 maximum;
  vec4 minimum;
};

struct Normal {
  vec4 normal;
};

struct Reference {
  uint materialIndex;
  uint transformIndex;
};

struct Material {
  vec4 baseColor;
  vec4 params;
  uint colorTextureIndex;
};

struct Transformation {
  mat4 modelMatrix;
  mat4 normalMatrix;
  mat4 pointMatrix;
  mat4 pointInverseMatrix;
  mat4 dirInverseMatrix;
};

struct ShadowTransformation {
  mat4 viewProjectionMatrix;
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

// ---------------------- internal struct ----------------------

struct Ray {
  vec3 origin;
  vec3 direction;
};

struct FaceNormal {
  bool frontFace;
  vec3 normal;
};

struct HitRecord {
  bool isHit;
  uint hitIndex;

  float t;
  vec3 point;
  vec3 normal;
  vec2 uv;
};

struct ShadeRecord {
  vec3 radiance;  
  Ray nextRay;
  float pdf;
};