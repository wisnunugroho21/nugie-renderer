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

struct BvhNodeIndex {
    uvec4 leftRightNodeObjTypeIndex;
};

struct BvhNodeMaximum {
    vec3 maximum;
};

struct BvhNodeMinimum {
    vec3 minimum;
};

// -----------------------------------------------

struct DirectNormalMaterialIndex {
    vec3 normal;
    uint materialIndex;
};