#version 460

#include "core/struct.glsl"

layout(origin_upper_left) in vec4 gl_FragCoord;
layout(location = 0) out vec4 outColor;

layout(set = 0, binding = 0) uniform sampler2D inputColor;

void main() {
  ivec2 textSize = textureSize(inputColor, 0);

  vec2 inCoord = vec2(gl_FragCoord.xy) / vec2(textSize);
  vec4 surfaceColor = texture(inputColor, inCoord);

  outColor = surfaceColor;
}