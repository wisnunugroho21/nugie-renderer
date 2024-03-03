#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 fragPosition;
layout(location = 1) in vec2 fragTextCoord;

layout(location = 0) out vec4 outColor;

layout(set = 0, binding = 1) uniform sampler2D terrainTextureLow[1];
layout(set = 0, binding = 2) uniform sampler2D terrainTextureMid[1];
layout(set = 0, binding = 3) uniform sampler2D terrainTextureHigh[1];

// -----------------------------------------------------------

void main() { 
  float gHeightLow = 32.0;
  float gHeightMid = 128.0;
  float gHeightHigh = 192.0;

  vec4 texColor = vec4(0.0f);
  float height = fragPosition.y * -1.0f;

  if (height < gHeightLow) {
    texColor = texture(terrainTextureLow[0], fragTextCoord);
  } 

  else if (height >= gHeightLow && height < gHeightMid) {
    vec4 color0 = texture(terrainTextureLow[0], fragTextCoord);
    vec4 color1 = texture(terrainTextureMid[0], fragTextCoord);
    float delta = gHeightMid - gHeightLow;
    float factor = (height - gHeightLow) / delta;
    texColor = mix(color0, color1, factor);
  } 
  
  else if (height >= gHeightMid && height < gHeightHigh) {
    vec4 color0 = texture(terrainTextureMid[0], fragTextCoord);
    vec4 color1 = texture(terrainTextureHigh[0], fragTextCoord);
    float delta = gHeightHigh - gHeightMid;
    float factor = (height - gHeightMid) / delta;
    texColor = mix(color0, color1, factor);
  } 
  
  else if (height >= gHeightHigh) {
    texColor = texture(terrainTextureHigh[0], fragTextCoord);
  }

  outColor = texColor;
}