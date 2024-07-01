// ------------- Struct ------------- 

#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_2PI 0.15915494309189535
#define PI 3.14159265359
#define FLT_MAX 1.0e+31
#define FLT_MIN 1.0e-31
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
    uint dummyIndex;
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

// -----------------------------------------------

struct RayOrigin {
    precise vec3 value;
};

struct RayDirection {
    precise vec3 value;
};

struct HitLength {
    precise float value;
};

struct HitUV {
    precise vec2 value;
};

struct HitGeometryIndex {
    precise uint value;
};

struct HitGeometryTypeIndex {
    precise uint value;
};

struct HitTransformIndex {
    precise uint value;
};

struct DirectOriginIsIlluminate {
    precise vec4 value;
};

struct DirectNormalMaterialIndex {
    precise vec3 normal;
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

struct IntegratorTotalRadianceIsRayBounce {
    precise vec4 value;
};

struct IntegratorTotalIndirectPdf {
    precise vec4 value;
};

struct SamplingResult {
    precise vec4 finalColorCountSample;
};