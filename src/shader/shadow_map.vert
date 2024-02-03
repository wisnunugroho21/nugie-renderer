#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 position;
layout(location = 1) in uint transformIndex;

layout(set = 0, binding = 0) buffer readonly TransformationModel {
  Transformation transformations[];
};

layout(set = 0, binding = 1) buffer readonly ShadowTransformationModel {
	ShadowTransformation shadowTransformations[];
};

layout(push_constant) uniform Push {
  uint lightIndex;
};

void main() {
  mat4 totalTransf = shadowTransformations[lightIndex].viewProjectionMatrix * transformations[transformIndex].modelMatrix;
  gl_Position = totalTransf * position;
}