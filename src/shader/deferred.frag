#version 460

#define KEPSILON 0.00001
#define LIGHT_NUM 6

#include "core/struct.glsl"

layout(location = 0) out vec4 outColor;

layout (input_attachment_index = 0, set = 0, binding = 0) uniform subpassInputMS inputPosition;
layout (input_attachment_index = 1, set = 0, binding = 1) uniform subpassInputMS inputNormal;
layout (input_attachment_index = 2, set = 0, binding = 2) uniform subpassInputMS inputColor;
layout (input_attachment_index = 3, set = 0, binding = 3) uniform subpassInputMS inputMaterial;

layout(set = 1, binding = 0) uniform readonly DeferredUniform {
  vec4 originNumLights;
} ubo;

layout(set = 1, binding = 1) buffer readonly ShadowTransformationSsbo {
	ShadowTransformation shadowTransformations[];
};

layout(set = 1, binding = 2) buffer readonly PointLightSsbo {
  PointLight lights[];
};

layout(set = 1, binding = 3) uniform sampler2DArray shadowMapTexture[1];

// ---------------------------------------------------------------------------

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

vec4 microfacetBRDF(vec4 lightDirection, vec4 viewDirection, vec4 surfaceNormal, 
  vec4 baseColor, float metallicness, float fresnelReflect, float roughness) 
{
  vec4 H = normalize(viewDirection + lightDirection); // half vector

  // all required dot products
  float NoV = clamp(dot(surfaceNormal, viewDirection), 0.0, 1.0);
  float NoL = clamp(dot(surfaceNormal, lightDirection), 0.0, 1.0);
  float NoH = clamp(dot(surfaceNormal, H), 0.0, 1.0);
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

vec4 computeTotalRadianceAfterShadow(vec4 surfacePosition, vec4 totalRadiance) {
  for (uint i = 0u; i < uint(ubo.originNumLights.w); i++) {
    for (uint j = 0u; j < 6u; j++) {
      vec4 shadowCoord = shadowTransformations[j].viewProjectionMatrix * surfacePosition;

      shadowCoord = shadowCoord / shadowCoord.w;
      shadowCoord.xy = shadowCoord.xy * 0.5 + 0.5;

      float dist = texture(shadowMapTexture[i], vec3(shadowCoord.xy, j)).x;

      bool isShadow = shadowCoord.w > 0.0f
        && abs(shadowCoord.z) < 1.0f
        && dist < shadowCoord.z;

      totalRadiance *= isShadow ? 0.25f : 1.0f;
    }
  }

  return totalRadiance;
}

void main() {
  vec4 surfacePosition = subpassLoad(inputPosition, gl_SampleID);
  vec4 surfaceNormal = subpassLoad(inputNormal, gl_SampleID);
  vec4 surfaceColor = subpassLoad(inputColor, gl_SampleID);
  vec4 surfaceMaterialParams = subpassLoad(inputMaterial, gl_SampleID);

  vec4 totalRadiance = vec4(0.0f);

  for (uint i = 0; i < uint(ubo.originNumLights.w); i++) {
    vec4 lightDirection = lights[i].position - surfacePosition;
    
    vec4 unitLightDirection = normalize(lightDirection);
    vec4 unitViewDirection = normalize(vec4(ubo.originNumLights.xyz, 1.0f) - surfacePosition);

    vec4 brdf = microfacetBRDF(unitLightDirection, unitViewDirection, surfaceNormal, 
      surfaceColor, surfaceMaterialParams.x, surfaceMaterialParams.z, surfaceMaterialParams.y);

    float NoL = clamp(dot(surfaceNormal, unitLightDirection), 0.0, 1.0);
    vec4 irradiance = lights[i].color / (4 * PI * dot(lightDirection, lightDirection)) * NoL;
    
    totalRadiance += brdf * irradiance;

    /* float DoL = dot(lights[i].direction, -1.0f * unitLightDirection);

    if (DoL > cos(lights[i].angle)) {
      vec4 unitViewDirection = normalize(vec4(ubo.originNumLights.xyz, 1.0f) - surfacePosition);

      vec4 brdf = microfacetBRDF(unitLightDirection, unitViewDirection, surfaceNormal, 
        surfaceColor, surfaceMaterialParams.x, surfaceMaterialParams.z, surfaceMaterialParams.y);

      float NoL = clamp(dot(surfaceNormal, unitLightDirection), 0.0, 1.0);
      vec4 irradiance = lights[i].color / (PI * dot(lightDirection, lightDirection)) * NoL * clamp(DoL, 0.0f, 1.0f);
      
      totalRadiance += brdf * irradiance * shadowFactor;
    } */
  }

  outColor = computeTotalRadianceAfterShadow(surfacePosition, totalRadiance);
}