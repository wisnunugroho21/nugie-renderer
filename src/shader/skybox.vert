#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 inPosition;

layout(location = 0) out vec3 outTextCoord;

layout(set = 0, binding = 0) uniform readonly CameraTransformationBuffer {
	mat4 view;
	mat4 projection;
};

void main() {
  outTextCoord = inPosition.xyz;

  mat4 viewMat = mat4(mat3(view));
  gl_Position = projection * viewMat * vec4(inPosition.xyz, 1.0f);
}