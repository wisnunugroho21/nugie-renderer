#version 460

layout(location = 0) in vec4 fragPosition;

layout(location = 0) out vec4 outColor;

void main() {
  outColor = fragPosition / 200.0f;
}