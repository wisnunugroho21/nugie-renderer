// ------------- Struct ------------- 

struct Sphere {
    vec4 centerRadius;
};

struct Vertex {
    vec3 position;
};

struct Triangle {
    uvec4 vertexMaterialIndexes;
};

struct Object {
    uvec4 firstBvhGeometryTransformIndex;
};

struct BvhNode {
    uvec4 leftRightNodeObjTypeIndex;
    vec3 maximum;
    vec3 minimum;
};

// -----------------------------------------------

struct DirectNormalMaterialIndex {
    precise vec3 normal;
    uint materialIndex;
};