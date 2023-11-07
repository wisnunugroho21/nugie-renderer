#version 460

#define KEPSILON 0.00001

#include "core/struct.glsl"

layout(origin_upper_left) in vec4 gl_FragCoord;
layout(location = 0) out vec4 outColor;

layout (input_attachment_index = 0, set = 0, binding = 0) uniform subpassInputMS inputPosition;
layout (input_attachment_index = 1, set = 0, binding = 1) uniform subpassInputMS inputNormal;
layout (input_attachment_index = 2, set = 0, binding = 2) uniform subpassInputMS inputColor;
layout (input_attachment_index = 3, set = 0, binding = 3) uniform subpassInputMS inputMaterial;

layout(set = 1, binding = 0) uniform readonly RayTraceUbo {
  vec3 origin;
  vec3 background;
  uint numLights;
  vec2 screenSize;
} ubo;

layout(set = 1, binding = 1) buffer readonly ObjectSsbo {
  Object objects[];
};

layout(set = 1, binding = 2) buffer readonly ObjectBvhSsbo {
  BvhNode objectBvhNodes[];
};

layout(set = 1, binding = 3) buffer readonly PrimitiveSsbo {
  Primitive primitives[];
};

layout(set = 1, binding = 4) buffer readonly PrimitiveBvhSsbo {
  BvhNode primitiveBvhNodes[];
};

layout(set = 1, binding = 5) buffer readonly PositionSsbo {
  vec4 positions[];
};

layout(set = 1, binding = 6) buffer readonly LightSsbo {
  TriangleLight lights[];
};

layout(set = 1, binding = 7) buffer readonly LightBvhSsbo {
  BvhNode lightBvhNodes[];
};

layout(set = 1, binding = 8) buffer readonly MaterialSsbo {
  Material materials[];
};

layout(set = 1, binding = 9) buffer readonly TransformationSsbo {
  Transformation transformations[];
};

layout(push_constant) uniform Push {
  uint randomSeed;
} push;

#include "core/boolean.glsl"
#include "core/basic.glsl"
#include "core/random.glsl"
#include "core/trace.glsl"
#include "core/ggx.glsl"
#include "core/shape.glsl"
#include "core/material.glsl"
#include "core/render.glsl"

// ------------- Material -------------

ShadeRecord indirectGgxShade(vec3 rayDirection, vec3 hitPoint, vec3 surfaceColor, vec3 surfaceNormal, float surfaceRoughness, float fresnelReflect, uint additionalRandomSeed) {
  ShadeRecord scat;
  scat.nextRay.origin = hitPoint;

  vec3 unitViewDirection = normalize(rayDirection);
  float f0 = 0.16 * (fresnelReflect * fresnelReflect);

  vec3[3] globalOnb = buildOnb(reflect(unitViewDirection, surfaceNormal));
  scat.nextRay.direction = ggxRandomDirection(globalOnb, surfaceRoughness, additionalRandomSeed);

  vec3 H = normalize(scat.nextRay.direction - rayDirection); // half vector

  float NoL = max(dot(surfaceNormal, normalize(scat.nextRay.direction)), 0.001f);
  float NoV = max(dot(surfaceNormal, -1.0f * unitViewDirection), 0.001f);
  float NoH = max(dot(surfaceNormal, H), 0.001f);
  float VoH = max(dot(unitViewDirection, H), 0.001f);

  float brdf = ggxBrdfValue(NoV, NoL, NoH, VoH, f0, surfaceRoughness);
  float pdf = ggxPdfValue(NoH, VoH, surfaceRoughness);

  scat.radiance = partialIntegrand(surfaceColor, brdf, NoL);
  scat.pdf = when_gt(length(scat.radiance), 0.001f) * pdf;
  
  return scat;
}

ShadeRecord indirectGgxShade(Ray r, HitRecord hit, uint additionalRandomSeed) {
  return indirectGgxShade(r.direction, hit.point, hit.color, hit.normal, hit.roughness, hit.fresnelReflect, additionalRandomSeed);
}

ShadeRecord indirectLambertShade(vec3 hitPoint, vec3 surfaceColor, vec3 surfaceNormal, uint additionalRandomSeed) {
  ShadeRecord scat;

  scat.nextRay.origin = hitPoint;
  scat.nextRay.direction = lambertRandomDirection(buildOnb(surfaceNormal), additionalRandomSeed);

  float NoL = max(dot(surfaceNormal, normalize(scat.nextRay.direction)), 0.001f);
  float brdf = lambertBrdfValue();
  float pdf = lambertPdfValue(NoL);

  scat.radiance = partialIntegrand(surfaceColor, brdf, NoL); 
  scat.pdf = when_gt(length(scat.radiance), 0.001f) * pdf;
  
  return scat;
}

ShadeRecord indirectLambertShade(HitRecord hit, uint additionalRandomSeed) {
  return indirectLambertShade(hit.point, hit.color, hit.normal, additionalRandomSeed);
}

ShadeRecord directGgxShade(uint lightIndex, vec3 rayDirection, vec3 hitPoint, vec3 surfaceColor, vec3 surfaceNormal, float surfaceRoughness, float fresnelReflect, uint additionalRandomSeed) {
  ShadeRecord scat;
  Ray shadowRay;

  scat.radiance = vec3(0.0f);
  scat.pdf = 0.01f;

  shadowRay.origin = hitPoint;
  shadowRay.direction = triangleLightRandomDirection(lights[lightIndex], shadowRay.origin, additionalRandomSeed);

  HitRecord objectHit = hitObjectBvh(shadowRay, 0.001f, FLT_MAX);
  HitRecord lightHit = hitTriangleLightBvh(shadowRay, 0.001f, FLT_MAX);

  if (lightHit.isHit && (!objectHit.isHit || length(lightHit.point - shadowRay.origin) < length(objectHit.point - shadowRay.origin))) {
    vec3 unitLightDirection = normalize(shadowRay.direction);

    float NloL = max(dot(lightHit.normal, -1.0f * unitLightDirection), 0.001f);
    float NoL = max(dot(surfaceNormal, unitLightDirection), 0.001f);

    vec3 unitViewDirection = normalize(rayDirection);
    vec3 H = normalize(shadowRay.direction - rayDirection); // half vector

    float f0 = 0.16 * (fresnelReflect * fresnelReflect);
    
    float NoV = max(dot(surfaceNormal, -1.0f * unitViewDirection), 0.001f);
    float NoH = max(dot(surfaceNormal, H), 0.001f);
    float VoH = max(dot(unitViewDirection, H), 0.001f);

    vec3 vectorDistance = lightHit.point - shadowRay.origin;

    float brdf = ggxBrdfValue(NoV, NoL, NoH, VoH, f0, surfaceRoughness);
    float sqrDistance = dot(vectorDistance, vectorDistance);
    float area = triangleLightArea(lights[lightHit.hitIndex]);
    float pdf = ggxPdfValue(NoH, VoH, surfaceRoughness);

    scat.radiance = partialIntegrand(surfaceColor, brdf, NoL) * Gfactor(NloL, sqrDistance, area) * lights[lightHit.hitIndex].color;
    scat.pdf = when_gt(length(scat.radiance), 0.001f) * pdf;  
  }

  return scat;
}

ShadeRecord directGgxShade(uint lightIndex, Ray r, HitRecord hit, uint additionalRandomSeed) {
  return directGgxShade(lightIndex, r.direction, hit.point, hit.color, hit.normal, hit.roughness, hit.fresnelReflect, additionalRandomSeed);
}

/* ShadeRecord sunDirectGgxShade(vec3 rayDirection, vec3 hitPoint, vec3 surfaceColor, vec3 surfaceNormal, float surfaceRoughness, float fresnelReflect, uint additionalRandomSeed) {
  ShadeRecord scat;
  Ray shadowRay;

  scat.radiance = vec3(0.0f);
  scat.pdf = 0.01f;

  shadowRay.origin = hitPoint;
  shadowRay.direction = sunLightRandomDirection(ubo.sunLight);

  HitRecord objectHit = hitObjectBvh(shadowRay, 0.001f, FLT_MAX);
  HitRecord lightHit = hitTriangleLightBvh(shadowRay, 0.001f, FLT_MAX);

  if (!lightHit.isHit && !objectHit.isHit) {
    vec3 unitLightDirection = normalize(shadowRay.direction);

    float NloL = max(dot(lightHit.normal, -1.0f * unitLightDirection), 0.001f);
    float NoL = max(dot(surfaceNormal, unitLightDirection), 0.001f);

    vec3 unitViewDirection = normalize(rayDirection);
    vec3 H = normalize(shadowRay.direction - rayDirection); // half vector

    float f0 = 0.16 * (fresnelReflect * fresnelReflect);
    
    float NoV = max(dot(surfaceNormal, -1.0f * unitViewDirection), 0.001f);
    float NoH = max(dot(surfaceNormal, H), 0.001f);
    float VoH = max(dot(unitViewDirection, H), 0.001f);

    float brdf = ggxBrdfValue(NoV, NoL, NoH, VoH, f0, surfaceRoughness);
    float pdf = ggxPdfValue(NoH, VoH, surfaceRoughness);

    scat.radiance = partialIntegrand(surfaceColor, brdf, NoL) * ubo.sunLight.color / pdf;
    scat.pdf = when_gt(length(scat.radiance), 0.001f) * pdf;  
  }

  return scat;
}

ShadeRecord sunDirectGgxShade(Ray r, HitRecord hit, uint additionalRandomSeed) {
  return sunDirectGgxShade(r.direction, hit.point, hit.color, hit.normal, hit.roughness, hit.fresnelReflect, additionalRandomSeed);
} */

ShadeRecord directLambertShade(uint lightIndex, vec3 hitPoint, vec3 surfaceColor, vec3 surfaceNormal, uint additionalRandomSeed) {
  ShadeRecord scat;
  Ray shadowRay;

  scat.radiance = vec3(0.0f);
  scat.pdf = 0.01f;

  shadowRay.origin = hitPoint;
  shadowRay.direction = triangleLightRandomDirection(lights[lightIndex], shadowRay.origin, additionalRandomSeed);

  HitRecord objectHit = hitObjectBvh(shadowRay, 0.001f, FLT_MAX);
  HitRecord lightHit = hitTriangleLightBvh(shadowRay, 0.001f, FLT_MAX);

  if (lightHit.isHit && (!objectHit.isHit || length(lightHit.point - shadowRay.origin) < length(objectHit.point - shadowRay.origin))) {
    vec3 unitLightDirection = normalize(shadowRay.direction);

    float NloL = max(dot(lightHit.normal, -1.0f * unitLightDirection), 0.001f);
    float NoL = max(dot(surfaceNormal, unitLightDirection), 0.001f);

    vec3 vectorDistance = lightHit.point - shadowRay.origin;    

    float brdf = lambertBrdfValue();
    float sqrDistance = dot(vectorDistance, vectorDistance);
    float area = triangleLightArea(lights[lightHit.hitIndex]);
    float pdf = lambertPdfValue(NoL);

    scat.radiance = partialIntegrand(surfaceColor, brdf, NoL) * Gfactor(NloL, sqrDistance, area) * lights[lightHit.hitIndex].color;
    scat.pdf = when_gt(length(scat.radiance), 0.001f) * pdf;
  }

  return scat;
}

ShadeRecord directLambertShade(uint lightIndex, HitRecord hit, uint additionalRandomSeed) {
  return directLambertShade(lightIndex, hit.point, hit.color, hit.normal, additionalRandomSeed);
}

/* ShadeRecord sunDirectLambertShade(vec3 hitPoint, vec3 surfaceColor, vec3 surfaceNormal, uint additionalRandomSeed) {
  ShadeRecord scat;
  Ray shadowRay;

  scat.radiance = vec3(0.0f);
  scat.pdf = 0.01f;

  shadowRay.origin = hitPoint;
  shadowRay.direction = sunLightRandomDirection(ubo.sunLight);

  HitRecord objectHit = hitObjectBvh(shadowRay, 0.001f, FLT_MAX);
  HitRecord lightHit = hitTriangleLightBvh(shadowRay, 0.001f, FLT_MAX);

  if (!lightHit.isHit && !objectHit.isHit) {
    vec3 unitLightDirection = normalize(shadowRay.direction);
    
    float NoL = max(dot(surfaceNormal, unitLightDirection), 0.001f);
    float brdf = lambertBrdfValue();
    float pdf = lambertPdfValue(NoL);

    scat.radiance = partialIntegrand(surfaceColor, brdf, NoL) * ubo.sunLight.color / pdf;
    scat.pdf = when_gt(length(scat.radiance), 0.001f) * pdf;
  }

  return scat;
}

ShadeRecord sunDirectLambertShade(HitRecord hit, uint additionalRandomSeed) {
  return sunDirectLambertShade(hit.point, hit.color, hit.normal, additionalRandomSeed);
} */

void main() {
  vec3 surfacePosition = subpassLoad(inputPosition, gl_SampleID).rgb;
  vec3 surfaceNormal = subpassLoad(inputNormal, gl_SampleID).rgb;
  vec3 surfaceMaterialParams = subpassLoad(inputMaterial, gl_SampleID).rgb;
  vec3 surfaceColor = subpassLoad(inputColor, gl_SampleID).rgb;

  ShadeRecord indirectShadeResult, directShadeResult[10];

  if (surfaceMaterialParams.x >= randomFloat(0)) {
    indirectShadeResult = indirectGgxShade(surfacePosition - ubo.origin, surfacePosition, surfaceColor, surfaceNormal, surfaceMaterialParams.y, surfaceMaterialParams.z, 0u);
    // directShadeResult[ubo.numLights] = sunDirectGgxShade(surfacePosition - ubo.origin, surfacePosition, surfaceColor, surfaceNormal, surfaceMaterialParams.y, surfaceMaterialParams.z, 0u);

    for (uint j = 0; j < ubo.numLights; j++) {
      directShadeResult[j] = directGgxShade(j, surfacePosition - ubo.origin, surfacePosition, surfaceColor, surfaceNormal, surfaceMaterialParams.y, surfaceMaterialParams.z, 0u);
    }
  } else {
    indirectShadeResult = indirectLambertShade(surfacePosition, surfaceColor, surfaceNormal, 0u);
    // directShadeResult[ubo.numLights] = sunDirectLambertShade(surfacePosition, surfaceColor, surfaceNormal, 0u);

    for (uint j = 0; j < ubo.numLights; j++) {
      directShadeResult[j] = directLambertShade(j, surfacePosition, surfaceColor, surfaceNormal, 0u);
    }
  }

  float totalPdf = indirectShadeResult.pdf; // + directShadeResult[ubo.numLights].pdf;
  for (uint j = 0; j < ubo.numLights; j++) {
    totalPdf += directShadeResult[j].pdf;
  }

  vec3 cummulativeRadiance = vec3(0.0f); //directShadeResult[ubo.numLights].radiance * directShadeResult[ubo.numLights].pdf;
  for (uint j = 0; j < ubo.numLights; j++) {
    cummulativeRadiance += directShadeResult[j].radiance * directShadeResult[j].pdf;
  }

  vec3 totalRadiance = cummulativeRadiance / totalPdf;
  vec3 totalIndirect = indirectShadeResult.radiance * indirectShadeResult.pdf / totalPdf;

  Ray curRay = indirectShadeResult.nextRay;
  
  for(uint i = 1; i < 2; i++) {
    HitRecord objectHit = hitObjectBvh(curRay, 0.001f, FLT_MAX);
    HitRecord lightHit = hitTriangleLightBvh(curRay, 0.001f, FLT_MAX);

    if (lightHit.isHit && (!objectHit.isHit || length(lightHit.point - curRay.origin) < length(objectHit.point - curRay.origin))) {
      totalIndirect = mix(totalIndirect, totalIndirect * GfactorTriangleLight(curRay, lightHit), when_gt(i, 0u));
      totalRadiance = totalRadiance + totalIndirect * lights[lightHit.hitIndex].color;
      break;
    }

    totalIndirect = totalIndirect / indirectShadeResult.pdf;

    if (!objectHit.isHit && !lightHit.isHit) {
      vec3 lightColor = vec3(0.0f); //when_or(when_ge(dot(normalize(curRay.direction), ubo.sunLight.direction), 0.99f), when_eq(i, 0u)) * ubo.sunLight.color;
      totalRadiance = totalRadiance + totalIndirect * lightColor;
      break;
    }

    if (objectHit.metallicness >= randomFloat(i)) {
      indirectShadeResult = indirectGgxShade(curRay, objectHit, i);
      // directShadeResult[ubo.numLights] = sunDirectGgxShade(curRay, objectHit, i);

      for (uint j = 0; j < ubo.numLights; j++) {
        directShadeResult[j] = directGgxShade(j, curRay, objectHit, i);
      }
    } else {
      indirectShadeResult = indirectLambertShade(objectHit, i);
      // directShadeResult[ubo.numLights] = sunDirectLambertShade(objectHit, i);

      for (uint j = 0; j < ubo.numLights; j++) {
        directShadeResult[j] = directLambertShade(j, objectHit, i);
      }
    }

    float totalPdf = indirectShadeResult.pdf; // + directShadeResult[ubo.numLights].pdf;
    for (uint j = 0; j < ubo.numLights; j++) {
      totalPdf += directShadeResult[j].pdf;
    }

    vec3 cummulativeRadiance = vec3(0.0f); //directShadeResult[ubo.numLights].radiance * directShadeResult[ubo.numLights].pdf;
    for (uint j = 0; j < ubo.numLights; j++) {
      cummulativeRadiance += directShadeResult[j].radiance * directShadeResult[j].pdf;
    }

    totalRadiance += totalIndirect * cummulativeRadiance / totalPdf;
    totalIndirect = totalIndirect * indirectShadeResult.radiance * indirectShadeResult.pdf / totalPdf;

    curRay = indirectShadeResult.nextRay;
  }
  
  outColor = vec4(totalRadiance, 1.0f);
}