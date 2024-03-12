#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 inPosition;
layout(location = 1) in vec2 inTextCoord;

layout(location = 0) out vec4 outColor;

layout(set = 0, binding = 4) uniform readonly FragmentData {
	vec4 origin;
  uvec4 numLights;
  SunLight sunLight;
} ubo;

layout(set = 0, binding = 5) buffer readonly ShadowTransformationBuffer {
	ShadowTransformation shadowTransformations[];
};

layout(set = 0, binding = 6) uniform sampler2D terrainTexture[1];
layout(set = 0, binding = 7) uniform sampler2DShadow shadowMapTexture[1];

// -----------------------------------------------------------

void main() {
  vec4 surfaceColor = texture(terrainTexture[0], inTextCoord);

  vec4 shadowCoord = shadowTransformations[0].projection * shadowTransformations[0].view * inPosition;
  shadowCoord.xyz = shadowCoord.xyz / shadowCoord.w;
  shadowCoord.xy = shadowCoord.xy * 0.5 + 0.5;

  float shadowFactor = texture(shadowMapTexture[0], shadowCoord.xyz).x;
  shadowFactor = shadowCoord.w <= 0.0f ? 1.0f : shadowFactor;

  // float NoL = max(dot(fragNormal, ubo.sunLight.direction * -1.0f), 0.3f);
  // vec4 totalRadiance = NoL * surfaceColor * ubo.sunLight.color;

  outColor = clamp(shadowFactor * surfaceColor, 0.0f, 1.0f); //clamp(totalRadiance, 0.0f, 1.0f);
}