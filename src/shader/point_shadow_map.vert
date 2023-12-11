#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 position;
layout(location = 1) in uint transformIndex;

layout(set = 0, binding = 0) buffer readonly TransformationModel {
  Transformation transformations[];
};

void main() {
  gl_Position = transformations[transformIndex].modelMatrix * position; 
}