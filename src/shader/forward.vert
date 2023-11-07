#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 position;
layout(location = 1) in vec4 normal;
layout(location = 2) in uint materialIndex;
layout(location = 3) in uint transformIndex;

layout(location = 0) out vec4 fragPosition;
layout(location = 1) out vec4 fragNormal;
layout(location = 2) out flat uint fragMaterialIndex;

layout(set = 0, binding = 0) uniform readonly RasterUniform {
	mat4 transforms;
} ubo;

layout(set = 0, binding = 1) buffer readonly TransformationSsbo {
  Transformation transformations[];
};

void main() {
  vec4 positionWorld = transformations[transformIndex].pointMatrix * position;
	gl_Position = ubo.transforms * positionWorld;
  
  fragPosition = positionWorld;
	fragNormal = normalize(transformations[transformIndex].normalMatrix * normal);
	fragMaterialIndex = materialIndex;
}