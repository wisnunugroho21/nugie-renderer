// ------------- Point Light ------------- 

vec3 pointLightFaceNormal(PointLight light, vec3 rayDirection, vec3 origin) {
  vec3 outwardNormal = normalize(light.position - origin);
  return setFaceNormal(rayDirection, outwardNormal);
}

float pointLightArea(PointLight light) {
  return 4 * pi * light.radius * light.radius;
}

vec3 pointLightGenerateRandom(PointLight light, vec3 origin) {
  return light.position - origin;
}

// ------------- Area Light -------------

vec3 areaLightFaceNormal(AreaLight light, vec3 rayDirection) {
  vec3 v0v1 = light.point1 - light.point0;
  vec3 v0v2 = light.point2 - light.point0;

  vec3 outwardNormal = normalize(cross(v0v1, v0v2));
  return setFaceNormal(rayDirection, outwardNormal);
}

float areaAreaLight(AreaLight light) {
  vec3 v0v1 = light.point1 - light.point0;
  vec3 v0v2 = light.point2 - light.point0;

  vec3 pvec = cross(v0v1, v0v2);
  return 0.5 * sqrt(dot(pvec, pvec)); 
}

vec3 areaLightGenerateRandom(AreaLight light, vec3 origin, uint additionalRandomSeed) {
  vec3 a = light.point1 - light.point0;
  vec3 b = light.point2 - light.point0;

  float u1 = randomFloat(additionalRandomSeed);
  float u2 = randomFloat(additionalRandomSeed + 1);

  if (u1 + u2 > 1) {
    u1 = 1 - u1;
    u2 = 1 - u2;
  }

  vec3 randomLight = u1 * a + u2 * b + light.point0;
  return randomLight - origin;
}

// ------------- Triangle -------------

vec3 triangleFaceNormal(uvec3 triIndices, vec3 rayDirection) {
  vec3 xPosition = positions[triIndices.x];

  vec3 v0v1 = positions[triIndices.y].xyz - xPosition.xyz;
  vec3 v0v2 = positions[triIndices.z].xyz - xPosition.xyz;

  vec3 outwardNormal = normalize(cross(v0v1, v0v2));
  return setFaceNormal(rayDirection, outwardNormal);
}

float areaTriangle(uvec3 triIndices) {
  vec3 xPosition = positions[triIndices.x];

  vec3 v0v1 = positions[triIndices.y].xyz - xPosition.xyz;
  vec3 v0v2 = positions[triIndices.z].xyz - xPosition.xyz;

  vec3 pvec = cross(v0v1, v0v2);
  return 0.5 * sqrt(dot(pvec, pvec)); 
}

vec3 triangleGenerateRandom(uvec3 triIndices, vec3 origin, uint additionalRandomSeed) {
  vec3 xPosition = positions[triIndices.x];

  vec3 v0v1 = positions[triIndices.y].xyz - xPosition.xyz;
  vec3 v0v2 = positions[triIndices.z].xyz - xPosition.xyz;

  float u1 = randomFloat(additionalRandomSeed);
  float u2 = randomFloat(additionalRandomSeed + 1);

  if (u1 + u2 > 1) {
    u1 = 1 - u1;
    u2 = 1 - u2;
  }

  vec3 randomTriangle = u1 * a + u2 * b + xPosition.xyz;
  return randomTriangle - origin;
}