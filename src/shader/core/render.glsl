// ------------- Integrand ------------- 

vec3 integrandOverHemisphere(vec3 color, float brdf, float NoL, float pdf) {
  return  brdf * NoL / pdf * color;
}

vec3 integrandOverArea(vec3 color, float brdf, float NoL, float NloL, float squareDistance, float area) {
  return  brdf * NoL * NloL * area / squareDistance * color;
}

vec3 partialIntegrand(vec3 color, float brdf, float NoL) {
  return  brdf * NoL * color;
}

float Gfactor(float NloL, float squareDistance, float area) {
  return NloL * area / squareDistance;
}

/* float Gfactor(Ray r, HitRecord hittedLight) {
  float sqrDistance = hittedLight.t * hittedLight.t * dot(r.direction, r.direction);
  float NloL = max(dot(hittedLight.normal, -1.0f * normalize(r.direction)), 0.001f);
  float area = areaAreaLight(lights[hittedLight.hitIndex]);

  return Gfactor(NloL, sqrDistance, area);
} */