// ------------- Integrand ------------- 

vec3 integrandOverHemisphere(vec3 color, float brdf, float NoL, float pdf) {
  return color * brdf * NoL / pdf; 
}

vec3 integrandOverArea(vec3 color, float brdf, float NoL, float NloL, float squareDistance, float area) {
  return color * brdf * NoL * NloL * area / squareDistance;
}

vec3 partialIntegrand(vec3 color, float brdf, float NoL) {
  return color * brdf * NoL;
}

float Gfactor(float NloL, float squareDistance, float area) {
  return NloL * area / squareDistance;
}

float GfactorPointLight(Ray r, HitRecord hittedLight) {
  float sqrDistance = hittedLight.t * hittedLight.t * dot(r.direction, r.direction);
  float NloL = max(dot(hittedLight.normal, -1.0f * normalize(r.direction)), 0.001f);
  float area = pointLightArea();

  return Gfactor(NloL, sqrDistance, area);
}

float GfactorTriangleLight(Ray r, HitRecord hittedLight) {
  float sqrDistance = hittedLight.t * hittedLight.t * dot(r.direction, r.direction);
  float NloL = max(dot(hittedLight.normal, -1.0f * normalize(r.direction)), 0.001f);
  float area = triangleLightArea(lights[hittedLight.hitIndex]);

  return Gfactor(NloL, sqrDistance, area);
}