// ------------- GGX -------------

vec3 randomGGX(float roughness, uint additionalRandomSeed) {
  float r1 = randomFloat(additionalRandomSeed);
  float r2 = randomFloat(additionalRandomSeed + 1);

  float a = roughness * roughness;
  float phi = 2 * 3.14159265359 * r2;

  float cosTheta = sqrt((1.0f - r1) / ((a * a - 1.0f) * r1 + 1.0f));
  float sinTheta = sqrt(1 - cosTheta * cosTheta);

  float x = cos(phi) * sinTheta;
  float y = sin(phi) * sinTheta;
  float z = cosTheta;

  return vec3(x, y, z);
}

vec3 ggxRandomDirection(vec3[3] globalOnb, float roughness, uint additionalRandomSeed) {
  vec3 source = randomGGX(roughness, additionalRandomSeed);
  return source.x * globalOnb[0] + source.y * globalOnb[1] + source.z * globalOnb[2];
}

float ggxPdfValue(float NoH, float VoH, float roughness) {
  return max(D_GGX(NoH, roughness) * NoH / (4.0 * VoH), 0.001f);
}

float ggxBrdfValue(float NoV, float NoL, float NoH, float VoH, float f0, float roughness) {
  float F = fresnelSchlick(VoH, f0);
  float D = D_GGX(NoH, roughness);
  float G = G_Smith(NoV, NoL, roughness);

  return (F * D * G) / (4.0 * NoV * NoL);
}

// ------------- Lambert ------------- 

vec3 randomCosineDirection(uint additionalRandomSeed) {
  float r1 = randomFloat(additionalRandomSeed);
  float r2 = randomFloat(additionalRandomSeed + 1);

  float cosTheta = sqrt(r1);
  float sinTheta = sqrt(1.0f - cosTheta * cosTheta);
  
  float phi = 2 * pi * r2;

  float x = cos(phi) * sinTheta;
  float y = sin(phi) * sinTheta;
  float z = cosTheta;

  return vec3(x, y, z);
}

vec3 lambertRandomDirection(vec3[3] globalOnb, uint additionalRandomSeed) {
  vec3 source = randomCosineDirection(additionalRandomSeed);
  return source.x * globalOnb[0] + source.y * globalOnb[1] + source.z * globalOnb[2];
}

float lambertPdfValue(float NoL) {
  return max(NoL / pi, 0.001f);
}

float lambertBrdfValue() {
  return 1.0f / pi;
}