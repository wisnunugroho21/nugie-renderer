#version 460

#include "core/struct.glsl"

// ------------- layout ------------- 

layout(origin_upper_left) in vec4 gl_FragCoord;
layout(location = 0) out vec4 outColor;

layout(set = 0, binding = 0, rgba8) uniform readonly image2D inputImage;
layout(set = 0, binding = 1, rgba8) uniform image2D accumulateImage;

layout(set = 0, binding = 2) uniform readonly GlobalUniform {
  vec3 origin;
  vec3 horizontal;
  vec3 vertical;
  vec3 lowerLeftCorner;
  uvec2 imgSize;
  SunLight sunLight;
  vec3 skyColor;
  uvec2 numLightsRandomSeed;
} ubo;

void main() {
  vec4 accColor = imageLoad(accumulateImage, ivec2(gl_FragCoord.xy));
  vec4 totalColor = (clamp(imageLoad(inputImage, ivec2(gl_FragCoord.xy)), 0.0f, 1.0f) + accColor * ubo.numLightsRandomSeed.y) / (ubo.numLightsRandomSeed.y + 1.0f);

  imageStore(accumulateImage, ivec2(gl_FragCoord.xy), totalColor);
  outColor = totalColor; //imageLoad(inputImage, ivec2(gl_FragCoord.xy));
}