#version 460

#include "core/struct.glsl"

layout(location = 0) in vec3 inTextCoord;

layout(location = 0) out vec4 outColor;

layout(set = 0, binding = 1) uniform samplerCube skyBoxTexture;

// -----------------------------------------------------------

void main() {
  outColor = texture(skyBoxTexture, inTextCoord);
}