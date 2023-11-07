#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 fragPosition;
layout(location = 1) in vec4 fragNormal;
layout(location = 2) in flat uint fragMaterialIndex;

layout(location = 0) out vec4 outPosition;
layout(location = 1) out vec4 outNormal;
layout(location = 2) out vec4 outColor;
layout(location = 3) out vec4 outMaterial;

layout(set = 0, binding = 2) buffer readonly MaterialModel {
  Material materials[];
};

void main() {
  outPosition = fragPosition;
  outNormal = fragNormal;
	outMaterial = vec4(materials[fragMaterialIndex].metallicness, materials[fragMaterialIndex].roughness, materials[fragMaterialIndex].fresnelReflect, 1.0f);
  outColor = vec4(materials[fragMaterialIndex].baseColor, 1.0f);
}