#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 position;
layout(location = 1) in uint transformIndex;

layout(set = 0, binding = 0) uniform readonly ShadowUniform {
	mat4 transforms;
} shadowUbo;

layout(set = 0, binding = 1) buffer readonly TransformationSsbo {
  Transformation transformations[];
};

void main() {
  gl_Position = shadowUbo.transforms * transformations[transformIndex].modelMatrix * position; 
}