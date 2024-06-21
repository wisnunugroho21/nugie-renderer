// ------------- Struct ------------- 

#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_2PI 0.15915494309189535
#define PI 3.14159265359
#define FLT_MAX 3.402823e+38
#define FLT_MIN 1.175494e-38

struct Vertex {
	vec4 position;
};

struct TextCood {
	vec2 uv;
};

struct Primitive {
	uvec4 indices;
};

struct Material {
	vec4 baseColor;
	vec4 params;
};

struct Transformation {
	mat4 modelMatrix;
	mat4 normalMatrix;
};

struct Meshlet {
	uint primitiveCount;
	uint primitiveOffset;
	uint vertexCount;
	uint vertexOffset;
};

struct CameraTransformation {
	mat4 view;
	mat4 projection;
};

// -----------------------------------------------------

struct NormText {    
	vec4 normal;
	vec2 textCoord;
};

struct Reference {
	uint materialIndex;
	uint transformIndex;
};

struct Aabb {
	vec4 point0;
	vec4 point1;
	vec4 point2;
	vec4 point3;
	vec4 point4;
	vec4 point5;
	vec4 point6;
	vec4 point7;

	uint firstIndex;
	uint indicesCount;
};

struct ShadowTransformation {
	mat4 view;
	mat4 projection;
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