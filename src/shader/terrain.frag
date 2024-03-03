#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 fragPosition;
layout(location = 1) in vec4 fragNormal;
layout(location = 2) in vec2 fragTextCoord;

layout(location = 0) out vec4 outColor;

layout(set = 0, binding = 1) uniform readonly FragmentData {
	vec4 origin;
  uvec4 numLights;
  SunLight sunLight;
} ubo;

layout(set = 0, binding = 2) buffer readonly SpotLightBuffer {
  SpotLight spotLights[];
};

layout(set = 0, binding = 3) uniform sampler2D terrainTextureLow[1];
layout(set = 0, binding = 4) uniform sampler2D terrainTextureMid[1];
layout(set = 0, binding = 5) uniform sampler2D terrainTextureHigh[1];

// -----------------------------------------------------------

void main() { 
  float gHeightLow = 32.0;
  float gHeightMid = 128.0;
  float gHeightHigh = 192.0;

  vec4 surfaceColor = vec4(0.0f);
  float height = fragPosition.y * -1.0f;

  if (height < gHeightLow) {
    surfaceColor = texture(terrainTextureLow[0], fragTextCoord);
  } 

  else if (height >= gHeightLow && height < gHeightMid) {
    vec4 color0 = texture(terrainTextureLow[0], fragTextCoord);
    vec4 color1 = texture(terrainTextureMid[0], fragTextCoord);

    float delta = gHeightMid - gHeightLow;
    float factor = (height - gHeightLow) / delta;

    surfaceColor = mix(color0, color1, factor);
  } 
  
  else if (height >= gHeightMid && height < gHeightHigh) {
    vec4 color0 = texture(terrainTextureMid[0], fragTextCoord);
    vec4 color1 = texture(terrainTextureHigh[0], fragTextCoord);

    float delta = gHeightHigh - gHeightMid;
    float factor = (height - gHeightMid) / delta;
    
    surfaceColor = mix(color0, color1, factor);
  } 
  
  else if (height >= gHeightHigh) {
    surfaceColor = texture(terrainTextureHigh[0], fragTextCoord);
  }

  float NoL = max(dot(fragNormal, ubo.sunLight.direction * -1.0f), 0.3f);    
  vec4 totalRadiance = NoL * surfaceColor * ubo.sunLight.color;

  outColor = clamp(totalRadiance, 0.0f, 1.0f);
}