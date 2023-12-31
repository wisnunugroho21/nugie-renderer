#version 460

#include "core/struct.glsl"

vec2 positions[6] = vec2[](
  vec2(-1.0f, -1.0f),
  vec2(1.0f, -1.0f),
  vec2(1.0f, 1.0f),

  vec2(1.0f, 1.0f),
  vec2(-1.0f, 1.0f),
  vec2(-1.0f, -1.0f)
);

void main() {
  gl_Position = vec4(positions[gl_VertexIndex], 0.0, 1.0);
}