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

  vec4 pos = (projection * mat4(mat3(view))) * inPosition;
  gl_Position = pos.xyww;
}