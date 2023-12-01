#version 460

#define LIGHT_NUM 6

layout(triangles, invocations = LIGHT_NUM) in;
layout(triangle_strip, max_vertices = 3) out;

layout(set = 0, binding = 0) uniform readonly ShadowUniform {
	mat4 lightTransforms[LIGHT_NUM];
};

void main() {
  gl_Layer = gl_InvocationID;

  for (uint i = 0; i < gl_in.length(); i++) {
    gl_Position = lightTransforms[gl_InvocationID] * gl_in[i].gl_Position;
    EmitVertex();
  }

  EndPrimitive();
}