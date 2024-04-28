#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 fragPosition;
layout(location = 1) in vec4 fragNormal;
layout(location = 2) in vec2 fragTextCoord;
layout(location = 3) in flat uint fragMaterialIndex;

layout(location = 0) out vec4 outColor;

layout(set = 0, binding = 2) uniform readonly FragmentData {
	vec4 origin;
  uvec4 numLights;
} ubo;

layout(set = 0, binding = 3) buffer readonly MaterialBuffer {
  Material materials[];
};

layout(set = 0, binding = 4) buffer readonly SpotLightBuffer {
  SpotLight spotLights[];
};

layout(set = 0, binding = 5) buffer readonly ShadowTransformationBuffer {
	ShadowTransformation shadowTransformations[];
};

layout(set = 0, binding = 6) uniform sampler2D colorTexture[1];
layout(set = 0, binding = 7) uniform sampler2D shadowMapTexture[1];

// -----------------------------------------------------------

void main() {
  Material material = materials[fragMaterialIndex];  
  
  vec4 surfaceColor = material.colorTextureIndex == 0 
    ? material.baseColor
    : texture(colorTexture[0], fragTextCoord);

  vec4 totalRadiance = vec4(0.0f);
  uint activeLight = 0u;

  for (uint i = 0; i < ubo.numLights.x; i++) {
    SpotLight spotLight = spotLights[i];

    vec4 lightDirection = spotLight.position - fragPosition;    
    vec4 unitLightDirection = normalize(lightDirection);

    float DoL = dot(spotLight.direction, -1.0f * unitLightDirection);

    if (DoL > cos(spotLight.angle)) {
      float NoL = clamp(dot(fragNormal, unitLightDirection), 0.0f, 1.0f);
      
      vec4 irradiance = NoL * clamp(DoL, 0.0f, 1.0f) * RECIPROCAL_PI / dot(lightDirection, lightDirection) * spotLight.color;      
      vec4 brdf = surfaceColor * RECIPROCAL_PI;

      vec4 lightCoord = shadowTransformations[i].projection * shadowTransformations[i].view * fragPosition;
      lightCoord.xyz = lightCoord.xyz / lightCoord.w;
      lightCoord.xy = lightCoord.xy * 0.5 + 0.5;

      float shadowFactor = texture(shadowMapTexture[i], lightCoord.xy).x < lightCoord.z && lightCoord.w > 0.0f 
        ? 0.1f 
        : 1.0f;

      totalRadiance += clamp(shadowFactor * brdf * irradiance, 0.0f, 1.0f);
      activeLight++;      
    }
  }

  outColor = totalRadiance / activeLight;
}