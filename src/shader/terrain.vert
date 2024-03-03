#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 position;
layout(location = 1) in vec4 normal;
layout(location = 2) in vec2 textCoord;

layout(location = 0) out vec4 fragPosition;
layout(location = 1) out vec4 fragNormal;
layout(location = 2) out vec2 fragTextCoord;

layout(set = 0, binding = 0) uniform readonly VertexData {
	mat4 cameraTransforms;
} ubo;

void main() {
	fragPosition = position;
	fragTextCoord = textCoord;
	
	gl_Position = ubo.cameraTransforms * fragPosition;
}