#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 position;
layout(location = 1) in uint transformIndex;

layout(set = 0, binding = 0) buffer readonly TransformationBuffer {
  Transformation transformations[];
};

layout(set = 0, binding = 1) buffer readonly ShadowTransformationBuffer {
	ShadowTransformation shadowTransformations[];
};

layout(push_constant) uniform Push {
  uint shadowIndex;
};

void main() {
  gl_Position = (shadowTransformations[shadowIndex].projection * shadowTransformations[shadowIndex].view * transformations[transformIndex].modelMatrix) * position;
}