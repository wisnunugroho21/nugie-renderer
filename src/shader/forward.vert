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

layout(set = 0, binding = 0) uniform readonly ForwardUniform {
	mat4 cameraTransforms;
} forwardUbo;

layout(set = 0, binding = 1) buffer readonly TransformationModel {
  Transformation transformations[];
};

void main() {
  vec4 positionWorld = transformations[transformIndex].modelMatrix * position;
	gl_Position = forwardUbo.cameraTransforms * positionWorld;
  
  fragPosition = positionWorld;
	fragNormal = normalize(transformations[transformIndex].normalMatrix * normal);
	fragTextCoord = textCoord;
	fragMaterialIndex = materialIndex;
}