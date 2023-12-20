#version 460

layout(location = 0) in vec4 position;

layout(location = 0) out vec4 fragPosition;

layout(set = 0, binding = 0) uniform readonly ForwardUniform {
	mat4 cameraTransforms;
} forwardUbo;

void main() {
  fragPosition = position;
	gl_Position = forwardUbo.cameraTransforms * position;
}