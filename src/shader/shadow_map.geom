#version 460

#include "core/struct.glsl"

layout(triangles, invocations = 6) in;
layout(triangle_strip, max_vertices = 3) out;

layout(location = 0) out vec4 fragPosition;

layout(set = 0, binding = 1) buffer readonly LightTransformationSsbo {
	LightTransformation lightTransformations[];
};

void main() {
  gl_Layer = gl_InvocationID;

  for (uint i = 0; i < gl_in.length(); i++) {
    fragPosition = gl_in[i].gl_Position;
    gl_Position = lightTransformations[gl_InvocationID].viewProjectionMatrix * fragPosition;
    EmitVertex();
  }

  EndPrimitive();
}