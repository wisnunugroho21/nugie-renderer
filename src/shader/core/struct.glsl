// ------------- Struct ------------- 

#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_2PI 0.15915494309189535
#define PI 3.14159265359
#define FLT_MAX 1.0e+30
#define FLT_MIN 1.0e-30
#define K_EPSILON 1e-8

struct Sphere {
    vec4 centerRadius;
};

struct Vertex {
    vec3 position;
    vec3 normal;
};

struct Triangle {
    uvec4 vertexMaterialIndexes;
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
    mat4 worldToObjectMatrix;
    mat4 objectToWorldMatrix;
};

struct Ray {
    precise vec3 origin;
    precise vec3 direction;
};

struct HitRecord {
    precise float t;
    precise vec2 uv;

    uint hitGeometryIndex;
    uint hitGeometryTypeIndex;
    uint hitTransformIndex;
};

struct DirectData {
    precise vec4 normalIsIlluminate;
    precise vec3 origin;
    uint materialIndex;
};

struct DirectResult {
    precise vec4 radiancePdf;
};

struct IndirectResult {
    precise vec4 radiancePdf;
};

struct LightResult {
    precise vec4 radianceIsIlluminate;
};

struct MissResult {
    precise vec4 radianceIsMiss;
};

struct IntegratorResult {
    precise vec4 totalRadianceIsRayBounce;
    precise vec4 totalIndirectPdf;
};

struct SamplingResult {
    precise vec4 finalColorCountSample;
};