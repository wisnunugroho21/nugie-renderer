// ------------- Struct ------------- 

#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_2PI 0.15915494309189535
#define PI 3.14159265359
#define FLT_MAX 3.402823e+38
#define FLT_MIN 1.175494e-38

struct Vertex {
  vec4 position;
};

struct NormText {    
  vec4 normal;
  vec2 textCoord;
};

struct Reference {
  uint materialIndex;
  uint transformIndex;
};

struct Patch {
  vec4 position;
  vec2 textCoord;
};

struct Material {
  vec4 baseColor;
  vec4 params;
  uint colorTextureIndex;
};

struct Transformation {
  mat4 modelMatrix;
  mat4 normalMatrix;
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

struct SunLight {
  vec4 color;
  vec4 direction;
};

struct VkDrawIndexedIndirectCommand {
  uint indexCount;
  uint instanceCount;
  uint firstIndex;
  int vertexOffset;
  uint firstInstance;
};