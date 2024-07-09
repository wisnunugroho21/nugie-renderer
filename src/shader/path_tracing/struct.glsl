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

// -----------------------------------------------

struct DirectNormalMaterialIndex {
    precise vec3 normal;
    uint materialIndex;
};