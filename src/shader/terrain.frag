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

layout(set = 0, binding = 6) uniform sampler2D terrainTextureLow[1];
layout(set = 0, binding = 7) uniform sampler2D terrainTextureMid[1];
layout(set = 0, binding = 8) uniform sampler2D terrainTextureHigh[1];

layout(set = 0, binding = 9) uniform sampler2DShadow shadowMapTexture[1];

// -----------------------------------------------------------

void main() { 
  float gHeightLow = 32.0;
  float gHeightMid = 128.0;
  float gHeightHigh = 192.0;

  vec4 surfaceColor = vec4(0.0f);

  if (inPosition.y < gHeightLow) {
    surfaceColor = texture(terrainTextureLow[0], inTextCoord);
  } 

  else if (inPosition.y >= gHeightLow && inPosition.y < gHeightMid) {
    vec4 color0 = texture(terrainTextureLow[0], inTextCoord);
    vec4 color1 = texture(terrainTextureMid[0], inTextCoord);

    float delta = gHeightMid - gHeightLow;
    float factor = (inPosition.y - gHeightLow) / delta;

    surfaceColor = mix(color0, color1, factor);
  } 
  
  else if (inPosition.y >= gHeightMid && inPosition.y < gHeightHigh) {
    vec4 color0 = texture(terrainTextureMid[0], inTextCoord);
    vec4 color1 = texture(terrainTextureHigh[0], inTextCoord);

    float delta = gHeightHigh - gHeightMid;
    float factor = (inPosition.y - gHeightMid) / delta;
    
    surfaceColor = mix(color0, color1, factor);
  } 
  
  else if (inPosition.y >= gHeightHigh) {
    surfaceColor = texture(terrainTextureHigh[0], inTextCoord);
  }

  vec4 shadowCoord = shadowTransformations[0].projection * shadowTransformations[0].view * inPosition;
  shadowCoord.xyz = shadowCoord.xyz / shadowCoord.w;
  shadowCoord.xy = shadowCoord.xy * 0.5 + 0.5;

  float shadowFactor = texture(shadowMapTexture[0], shadowCoord.xyz).x;
  shadowFactor = shadowCoord.w <= 0.0f ? 1.0f : shadowFactor;

  // float NoL = max(dot(fragNormal, ubo.sunLight.direction * -1.0f), 0.3f);
  // vec4 totalRadiance = NoL * surfaceColor * ubo.sunLight.color;

  outColor = clamp(shadowFactor * surfaceColor, 0.0f, 1.0f); //clamp(totalRadiance, 0.0f, 1.0f);
}