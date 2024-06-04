// ------------- Struct ------------- 

#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_2PI 0.15915494309189535
#define PI 3.14159265359
#define FLT_MAX 3.402823e+38
#define FLT_MIN 1.175494e-38
#define K_EPSILON 1e-8

struct Vertex {
  vec4 position;
  vec4 normal;
};

struct Triangle {
  uvec4 vertexMaterialIndexes;
};

struct Object {
  uvec4 firstBvhGeometryTransformIndex;
};

struct BvhNode {
  uvec4 leftRightNodeObjTypeIndex;
  vec4 maximum;
  vec4 minimum;
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

struct Ray {
  vec4 origin;
  vec4 direction;
};