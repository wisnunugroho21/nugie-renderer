#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 position;

layout(location = 0) out vec4 fragPosition;

layout(set = 0, binding = 0) uniform readonly VertexUniform {
	mat4 cameraTransforms;
} ubo;

void main() {
	fragPosition = position;
	gl_Position = ubo.cameraTransforms * fragPosition;
}