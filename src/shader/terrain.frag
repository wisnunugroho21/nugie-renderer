#version 460

#include "core/struct.glsl"

layout(location = 0) in float inHeight;
layout(location = 1) in vec2 inTextCoord;

layout(location = 0) out vec4 outColor;

layout(set = 0, binding = 4) uniform readonly FragmentData {
	vec4 origin;
  uvec4 numLights;
  SunLight sunLight;
} ubo;

layout(set = 0, binding = 5) uniform sampler2D terrainTextureLow[1];
layout(set = 0, binding = 6) uniform sampler2D terrainTextureMid[1];
layout(set = 0, binding = 7) uniform sampler2D terrainTextureHigh[1];

// -----------------------------------------------------------

void main() { 
  float gHeightLow = 32.0;
  float gHeightMid = 128.0;
  float gHeightHigh = 192.0;

  vec4 surfaceColor = vec4(0.0f);

  if (inHeight < gHeightLow) {
    surfaceColor = texture(terrainTextureLow[0], inTextCoord);
  } 

  else if (inHeight >= gHeightLow && inHeight < gHeightMid) {
    vec4 color0 = texture(terrainTextureLow[0], inTextCoord);
    vec4 color1 = texture(terrainTextureMid[0], inTextCoord);

    float delta = gHeightMid - gHeightLow;
    float factor = (inHeight - gHeightLow) / delta;

    surfaceColor = mix(color0, color1, factor);
  } 
  
  else if (inHeight >= gHeightMid && inHeight < gHeightHigh) {
    vec4 color0 = texture(terrainTextureMid[0], inTextCoord);
    vec4 color1 = texture(terrainTextureHigh[0], inTextCoord);

    float delta = gHeightHigh - gHeightMid;
    float factor = (inHeight - gHeightMid) / delta;
    
    surfaceColor = mix(color0, color1, factor);
  } 
  
  else if (inHeight >= gHeightHigh) {
    surfaceColor = texture(terrainTextureHigh[0], inTextCoord);
  }

  // float NoL = max(dot(fragNormal, ubo.sunLight.direction * -1.0f), 0.3f);
  // vec4 totalRadiance = NoL * surfaceColor * ubo.sunLight.color;

  outColor = surfaceColor; //clamp(totalRadiance, 0.0f, 1.0f);
}