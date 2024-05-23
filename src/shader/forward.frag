#version 460

layout(location = 0) in vec4 fragPosition;
layout(location = 1) in vec4 fragNormal;
layout(location = 2) in flat uint fragMaterialIndex;

layout(location = 0) out vec4 outPosition;
layout(location = 1) out vec4 outNormal;
layout(location = 2) out uint outMaterialIndex;

// -----------------------------------------------------------

void main() {
  outPosition = fragPosition;
  outNormal = fragNormal;
  outMaterialIndex = fragMaterialIndex;
}