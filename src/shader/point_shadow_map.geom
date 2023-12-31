#version 460

#define LIGHT_NUM 6

#include "core/struct.glsl"

layout(triangles, invocations = LIGHT_NUM) in;
layout(triangle_strip, max_vertices = 3) out;

layout(location = 0) out vec4 fragPosition;

layout(set = 0, binding = 1) buffer readonly ShadowTransformationModel {
	ShadowTransformation shadowTransformations[];
};

layout(push_constant) uniform Push {
  uint lightIndex;
};

void main() {
  gl_Layer = gl_InvocationID;

  for (uint i = 0; i < gl_in.length(); i++) {
    fragPosition = gl_in[i].gl_Position;
    gl_Position = shadowTransformations[lightIndex * LIGHT_NUM + gl_InvocationID].viewProjectionMatrix * fragPosition;
    EmitVertex();
  }

  EndPrimitive();
}