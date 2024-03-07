#version 460

layout(location = 0) in float inHeight;

layout(location = 0) out vec4 outColor;

// -----------------------------------------------------------

void main() { 
  float h = inHeight / 300.0f;
  outColor = vec4(h, h, h, 1.0f);
}