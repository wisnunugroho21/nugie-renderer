#version 460

#include "core/struct.glsl"

layout(location = 0) in vec4 fragPosition;
layout(location = 1) in vec4 fragNormal;
layout(location = 2) in vec2 fragTextCoord;
layout(location = 3) in flat uint fragMaterialIndex;

layout(location = 0) out vec4 outColor;

layout(set = 0, binding = 2) uniform readonly FragmentUniform {
	vec4 origin;
  uvec4 numLights;
} ubo;

layout(set = 0, binding = 3) buffer readonly MaterialModel {
  Material materials[];
};

layout(set = 0, binding = 4) buffer readonly SpotLightModel {
  SpotLight spotLights[];
};

layout(set = 0, binding = 5) buffer readonly ShadowTransformationModel {
	ShadowTransformation shadowTransformations[];
};

layout(set = 0, binding = 6) uniform sampler2D colorTexture[1];
layout(set = 0, binding = 7) uniform sampler2DShadow shadowMapTexture[1];

vec4 fresnelSchlick(float cosTheta, vec4 F0) {
  return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
} 

float D_GGX(float NoH, float roughness) {
  float alpha = roughness * roughness;
  float alpha2 = alpha * alpha;
  float NoH2 = NoH * NoH;
  float b = (NoH2 * (alpha2 - 1.0) + 1.0);

  return alpha2 / (PI * b * b);
}

float G1_GGX_Schlick(float NoV, float roughness) {
  //float r = roughness; // original
  float r = 0.5 + 0.5 * roughness; // Disney remapping
  float k = (r * r) / 2.0;
  float denom = NoV * (1.0 - k) + k;

  return max(NoV, 0.001) / denom;
}

float G_Smith(float NoV, float NoL, float roughness) {
  float g1_l = G1_GGX_Schlick(NoL, roughness);
  float g1_v = G1_GGX_Schlick(NoV, roughness);
  return g1_l * g1_v;
}

vec4 microfacetBRDF(vec4 lightDirection, vec4 viewDirection, vec4 fragNormal, 
  vec4 baseColor, float metallicness, float fresnelReflect, float roughness) 
{
  vec4 H = normalize(viewDirection + lightDirection); // half vector

  // all required dot products
  float NoV = clamp(dot(fragNormal, viewDirection), 0.0, 1.0);
  float NoL = clamp(dot(fragNormal, lightDirection), 0.0, 1.0);
  float NoH = clamp(dot(fragNormal, H), 0.0, 1.0);
  float VoH = clamp(dot(viewDirection, H), 0.0, 1.0);     
  
  // F0 for dielectics in range [0.0, 0.16] 
  // default FO is (0.16 * 0.5^2) = 0.04
  vec4 f0 = vec4(0.16 * (fresnelReflect * fresnelReflect)); 
  // in case of metals, baseColor contains F0
  f0 = mix(f0, baseColor, metallicness);

  // specular microfacet (cook-torrance) BRDF
  vec4 F = fresnelSchlick(VoH, f0);
  float D = D_GGX(NoH, roughness);
  float G = G_Smith(NoV, NoL, roughness);
  vec4 spec = (F * D * G) / (4.0 * max(NoV, 0.001) * max(NoL, 0.001));
  
  // diffuse
  vec4 rhoD = baseColor;
  rhoD *= vec4(1.0) - F; // if not specular, use as diffuse (optional)
  rhoD *= (1.0 - metallicness); // no diffuse for metals
  vec4 diff = rhoD * RECIPROCAL_PI;
  
  return diff + spec;
}

float computeShadowFactor(uint lightIndex, vec4 shadowCoord) {
  shadowCoord.xyz = shadowCoord.xyz / shadowCoord.w;
  shadowCoord.xy = shadowCoord.xy * 0.5 + 0.5;

  vec3 uvc = vec3(shadowCoord.xy, shadowCoord.z);
  float dist = texture(shadowMapTexture[lightIndex], uvc).x;

  return (shadowCoord.z <= 1.0f && shadowCoord.w > 0.0f) ? dist : 0.0f;
}

void main() {
  vec4 surfaceMaterialParams = materials[fragMaterialIndex].params;
  uint colorTextureIndex = materials[fragMaterialIndex].colorTextureIndex;
  
  vec4 surfaceColor = colorTextureIndex == 0 
    ? materials[fragMaterialIndex].baseColor
    : texture(colorTexture[0], fragTextCoord);

  vec4 totalRadiance = vec4(0.0f);

  for (uint i = 0; i < ubo.numLights.x; i++) {
    vec4 lightDirection = spotLights[i].position - fragPosition;
    
    vec4 unitLightDirection = normalize(lightDirection);
    vec4 unitViewDirection = normalize(ubo.origin - fragPosition);

    float DoL = dot(spotLights[i].direction, -1.0f * unitLightDirection);

    if (DoL > cos(spotLights[i].angle)) {
      vec4 unitViewDirection = normalize(ubo.origin - fragPosition);

      vec4 brdf = microfacetBRDF(unitLightDirection, unitViewDirection, fragNormal, 
        surfaceColor, surfaceMaterialParams.x, surfaceMaterialParams.z, surfaceMaterialParams.y);

      float NoL = clamp(dot(fragNormal, unitLightDirection), 0.0, 1.0);
      vec4 irradiance = spotLights[i].color / (PI * dot(lightDirection, lightDirection)) * NoL * clamp(DoL, 0.0f, 1.0f);
      
      vec4 shadowCoord = shadowTransformations[i].viewProjectionMatrix * fragPosition;
      totalRadiance += brdf * irradiance * computeShadowFactor(i, shadowCoord);
    }
  }

  outColor = totalRadiance;
}