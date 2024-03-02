#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 position;
layout(location = 1) in vec4 normal;
layout(location = 2) in vec2 textCoord;
layout(location = 3) in uint materialIndex;
layout(location = 4) in uint transformIndex;

layout(location = 0) out vec4 fragPosition;
layout(location = 1) out vec4 fragNormal;
layout(location = 2) out vec2 fragTextCoord;
layout(location = 3) out flat uint fragMaterialIndex;

layout(set = 0, binding = 0) uniform readonly VertexData {
	mat4 cameraTransforms;
} ubo;

layout(set = 0, binding = 1) buffer readonly TransformationBuffer {
  Transformation transformations[];
};

void main() {
	fragPosition = transformations[transformIndex].modelMatrix * position;
	gl_Position = ubo.cameraTransforms * fragPosition;
	
	fragNormal = normalize(transformations[transformIndex].normalMatrix * normal);
	fragTextCoord = textCoord;
	fragMaterialIndex = materialIndex;
}