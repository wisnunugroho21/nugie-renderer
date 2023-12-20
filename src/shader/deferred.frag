#version 460
#extension GL_EXT_nonuniform_qualifier : enable

#define KEPSILON 0.00001
#define POINT_SHADOW_MAP_NUM 6u

#include "core/struct.glsl"
#define EPSILON 0.00001

layout(location = 0) out vec4 outColor;

layout (input_attachment_index = 0, set = 0, binding = 0) uniform subpassInputMS inputPosition;
layout (input_attachment_index = 1, set = 0, binding = 1) uniform subpassInputMS inputNormal;
layout (input_attachment_index = 2, set = 0, binding = 2) uniform subpassInputMS inputTextCoord;
layout (input_attachment_index = 3, set = 0, binding = 3) uniform usubpassInputMS inputMaterialIndex;

layout(set = 1, binding = 0) uniform readonly DeferredUniform {
  vec4 origin;
  uvec4 numLights;
} ubo;

layout(set = 1, binding = 1) buffer readonly MaterialModel {
  Material materials[];
};

layout(set = 1, binding = 2) buffer readonly ShadowTransformationModel {
	ShadowTransformation shadowTransformations[];
};

layout(set = 1, binding = 3) buffer readonly PointLightModel {
  PointLight pointLights[];
};

layout(set = 1, binding = 4) buffer readonly SpotLightModel {
  SpotLight spotLights[];
};

layout(set = 1, binding = 5) uniform sampler2DArrayShadow pointShadowMapTexture[];
layout(set = 1, binding = 6) uniform sampler2DShadow spotShadowMapTexture[];

layout(set = 1, binding = 7) uniform sampler2D colorTexture[];

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

bool isHitShadowPointLight(uint lightIndex, vec4 shadowCoord, float layer, vec2 offset) {
  shadowCoord.xyz = shadowCoord.xyz / shadowCoord.w;
  shadowCoord.xy = shadowCoord.xy * 0.5 + 0.5;

  vec4 uvc = vec4(shadowCoord.xy + offset, layer, shadowCoord.z);
  float dist = texture(pointShadowMapTexture[nonuniformEXT(lightIndex)], uvc).x;

  return dist == 1.0f && shadowCoord.z <= 1.0f && shadowCoord.w > 0.0f
    && shadowCoord.x >= 0.0f && shadowCoord.x <= 1.0f
    && shadowCoord.y >= 0.0f && shadowCoord.y <= 1.0f;
}

bool isHitShadowSpotLight(uint lightIndex, vec4 shadowCoord, vec2 offset) {
  shadowCoord.xyz = shadowCoord.xyz / shadowCoord.w;
  shadowCoord.xy = shadowCoord.xy * 0.5 + 0.5;

  vec3 uvc = vec3(shadowCoord.xy + offset, shadowCoord.z);
  float dist = texture(spotShadowMapTexture[nonuniformEXT(lightIndex)], uvc).x;

  return dist == 1.0f && shadowCoord.z <= 1.0f && shadowCoord.w > 0.0f
    && shadowCoord.x >= 0.0f && shadowCoord.x <= 1.0f
    && shadowCoord.y >= 0.0f && shadowCoord.y <= 1.0f;
}

float computePointShadowPCF(uint lightIndex, vec4 shadowCoord, float layer) {
  ivec2 texDim = textureSize(pointShadowMapTexture[nonuniformEXT(lightIndex)], 0).xy;

  vec2 dOffset = 1.0f / vec2(texDim);
	float shadowFactor = 0.0;

  for (int x = -1; x <= 1; x++) {
		for (int y = -1; y <= 1; y++) {
      shadowFactor += isHitShadowPointLight(lightIndex, shadowCoord, layer, dOffset * vec2(x, y))
        ? 0.1f
        : 1.0f;
		}
	}

	return shadowFactor / 9.0f;
}

float computeSpotShadowPCF(uint lightIndex, vec4 shadowCoord) {
  ivec2 texDim = textureSize(spotShadowMapTexture[nonuniformEXT(lightIndex)], 0).xy;

	vec2 dOffset = 1.0f / vec2(texDim);
	float shadowFactor = 0.0;

  for (int x = -1; x <= 1; x++) {
		for (int y = -1; y <= 1; y++) {
			shadowFactor += isHitShadowSpotLight(lightIndex, shadowCoord, dOffset * vec2(x, y))
        ? 0.1f
        : 1.0f;
		}
	}
  
	return shadowFactor / 9.0f;
}

/* vec4 computeRadianceShadow(vec4 surfacePosition, vec4 totalRadiance) {
  for (uint lightIndex = 0u; lightIndex < ubo.numLights.x; lightIndex++) {
    for (uint layer = 0u; layer < POINT_SHADOW_MAP_NUM; layer++) {
      vec4 shadowCoord = shadowTransformations[lightIndex * POINT_SHADOW_MAP_NUM + layer].viewProjectionMatrix * surfacePosition;
      bool isShadow = isHitShadowPointLight(lightIndex, shadowCoord, layer, vec2(0.0f, 0.0f));

      if (isShadow) {
        totalRadiance *= 0.25f;
        break;
      }
    }
  }

  uint initialIndex = ubo.numLights.x * 6;

  for (uint lightIndex = 0u; lightIndex < ubo.numLights.y; lightIndex++) {
    vec4 shadowCoord = shadowTransformations[initialIndex + lightIndex].viewProjectionMatrix * surfacePosition;
    totalRadiance *= isHitShadowSpotLight(lightIndex, shadowCoord, vec2(0.0f, 0.0f)) 
      ? 0.25f 
      : 1.0f;
  }

  return totalRadiance;
} */

vec4 computeRadianceShadowPCF(vec4 surfacePosition, vec4 totalRadiance) {
  for (uint lightIndex = 0u; lightIndex < ubo.numLights.x; lightIndex++) {
    for (uint layer = 0u; layer < POINT_SHADOW_MAP_NUM; layer++) {
      vec4 shadowCoord = shadowTransformations[lightIndex * POINT_SHADOW_MAP_NUM + layer].viewProjectionMatrix * surfacePosition;

      float shadowFactor = computePointShadowPCF(lightIndex, shadowCoord, layer);
      totalRadiance *= shadowFactor;
    }
  }

  uint initialIndex = ubo.numLights.x * 6;

  for (uint lightIndex = 0u; lightIndex < ubo.numLights.y; lightIndex++) {
    vec4 shadowCoord = shadowTransformations[initialIndex + lightIndex].viewProjectionMatrix * surfacePosition;
    float shadowFactor = computeSpotShadowPCF(lightIndex, shadowCoord);
    totalRadiance *= shadowFactor;
  }

  return totalRadiance;
}

void main() {
  vec4 surfacePosition = subpassLoad(inputPosition, gl_SampleID);
  vec4 surfaceNormal = subpassLoad(inputNormal, gl_SampleID);
  vec2 surfaceTextCoord = subpassLoad(inputTextCoord, gl_SampleID).xy;
  uint surfaceMaterialIndex = subpassLoad(inputMaterialIndex, gl_SampleID).x;

  vec4 surfaceMaterialParams = materials[surfaceMaterialIndex].params;
  uint colorTextureIndex = materials[surfaceMaterialIndex].colorTextureIndex;
  
  vec4 surfaceColor = colorTextureIndex == 0 
    ? materials[surfaceMaterialIndex].baseColor 
    : texture(colorTexture[nonuniformEXT(colorTextureIndex - 1u)], surfaceTextCoord);

  vec4 totalRadiance = vec4(0.0f);

  for (uint i = 0; i < ubo.numLights.x; i++) {
    vec4 lightDirection = pointLights[i].position - surfacePosition;
    
    vec4 unitLightDirection = normalize(lightDirection);
    vec4 unitViewDirection = normalize(ubo.origin - surfacePosition);

    vec4 brdf = microfacetBRDF(unitLightDirection, unitViewDirection, surfaceNormal, 
      surfaceColor, surfaceMaterialParams.x, surfaceMaterialParams.z, surfaceMaterialParams.y);

    float NoL = clamp(dot(surfaceNormal, unitLightDirection), 0.0, 1.0);
    vec4 irradiance = pointLights[i].color / (4 * PI * dot(lightDirection, lightDirection)) * NoL;
    
    totalRadiance += brdf * irradiance;
  }

  for (uint i = 0; i < ubo.numLights.y; i++) {
    vec4 lightDirection = spotLights[i].position - surfacePosition;
    
    vec4 unitLightDirection = normalize(lightDirection);
    vec4 unitViewDirection = normalize(ubo.origin - surfacePosition);

    float DoL = dot(spotLights[i].direction, -1.0f * unitLightDirection);

    if (DoL > cos(spotLights[i].angle)) {
      vec4 unitViewDirection = normalize(ubo.origin - surfacePosition);

      vec4 brdf = microfacetBRDF(unitLightDirection, unitViewDirection, surfaceNormal, 
        surfaceColor, surfaceMaterialParams.x, surfaceMaterialParams.z, surfaceMaterialParams.y);

      float NoL = clamp(dot(surfaceNormal, unitLightDirection), 0.0, 1.0);
      vec4 irradiance = spotLights[i].color / (PI * dot(lightDirection, lightDirection)) * NoL * clamp(DoL, 0.0f, 1.0f);
      
      totalRadiance += brdf * irradiance;
    }
  }

  outColor = computeRadianceShadowPCF(surfacePosition, totalRadiance);
}