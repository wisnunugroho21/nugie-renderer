#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 fragPosition;

layout(set = 0, binding = 2) buffer readonly PointLightSsbo {
  PointLight lights[];
};

layout(push_constant) uniform Push {
  float farPlane;
};

void main() {
  float lightDistance = length(fragPosition - lights[0].position);
  lightDistance = lightDistance / farPlane;
  gl_FragDepth = lightDistance;
}