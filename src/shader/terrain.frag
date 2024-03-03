#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 fragPosition;
layout(location = 1) in vec2 fragTextCoord;

layout(location = 0) out vec4 outColor;

layout(set = 0, binding = 1) uniform sampler2D terrainTexture[1];

// -----------------------------------------------------------

void main() {  
  outColor = texture(terrainTexture[0], fragTextCoord);
}