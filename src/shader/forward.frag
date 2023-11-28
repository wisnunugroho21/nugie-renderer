#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 fragPosition;
layout(location = 1) in vec4 fragNormal;
layout(location = 2) in vec2 fragTextCoord;
layout(location = 3) in flat uint fragMaterialIndex;

layout(location = 0) out vec4 outPosition;
layout(location = 1) out vec4 outNormal;
layout(location = 2) out vec4 outColor;
layout(location = 3) out vec4 outMaterial;

layout(set = 0, binding = 2) buffer readonly MaterialModel {
  Material materials[];
};

layout(set = 0, binding = 3) uniform sampler2D colorTexture[1];

void main() {
  outPosition = fragPosition;
  outNormal = fragNormal;

	outMaterial = materials[fragMaterialIndex].params;
  uint colorTextureIndex = materials[fragMaterialIndex].colorTextureIndex;
  
  if (colorTextureIndex == 0) {
    outColor = materials[fragMaterialIndex].baseColor;
  } else {
    outColor = texture(colorTexture[colorTextureIndex - 1u], fragTextCoord);
  }
}