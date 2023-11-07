// ------------- Sky Light ------------- 

vec3 sunLightFaceNormal(vec3 rayDirection, vec3 origin) {
  return -1.0f * normalize(rayDirection);
}

float sunLightArea() {
  return 1.0f;
}

vec3 sunLightRandomDirection(SunLight light) {
  return light.direction;
}

// ------------- Point Light ------------- 

vec3 pointLightFaceNormal(PointLight light, vec3 rayDirection, vec3 origin) {
  vec3 outwardNormal = normalize(light.position.xyz - origin);
  return setFaceNormal(rayDirection, outwardNormal);
}

float pointLightArea() {
  return 1.0f;
}

vec3 pointLightRandomDirection(PointLight light, vec3 origin) {
  return light.position.xyz - origin;
}

// ------------- Triangle Light -------------

vec3 triangleLightFaceNormal(TriangleLight light, vec3 rayDirection) {
  vec3 v0v1 = light.point1.xyz - light.point0.xyz;
  vec3 v0v2 = light.point2.xyz - light.point0.xyz;

  vec3 outwardNormal = normalize(cross(v0v1, v0v2));
  return setFaceNormal(rayDirection, outwardNormal);
}

float triangleLightArea(TriangleLight light) {
  vec3 v0v1 = light.point1.xyz - light.point0.xyz;
  vec3 v0v2 = light.point2.xyz - light.point0.xyz;

  vec3 pvec = cross(v0v1, v0v2);
  return 0.5 * sqrt(dot(pvec, pvec)); 
}

vec3 triangleLightRandomDirection(TriangleLight light, vec3 origin, uint additionalRandomSeed) {
  vec3 v0v1 = light.point1.xyz - light.point0.xyz;
  vec3 v0v2 = light.point2.xyz - light.point0.xyz;

  float u1 = randomFloat(additionalRandomSeed);
  float u2 = randomFloat(additionalRandomSeed + 1);

  if (u1 + u2 > 1) {
    u1 = 1 - u1;
    u2 = 1 - u2;
  }

  vec3 randomTriangle = u1 * v0v1 + u2 * v0v2 + light.point0.xyz;
  return randomTriangle - origin;
}

// ------------- Triangle -------------

vec3 triangleFaceNormal(uvec3 triIndices, vec3 rayDirection) {
  vec3 v0v1 = positions[triIndices.y].xyz - positions[triIndices.x].xyz;
  vec3 v0v2 = positions[triIndices.z].xyz - positions[triIndices.x].xyz;

  vec3 outwardNormal = normalize(cross(v0v1, v0v2));
  return setFaceNormal(rayDirection, outwardNormal);
}

float triangleArea(uvec3 triIndices) {
  vec3 v0v1 = positions[triIndices.y].xyz - positions[triIndices.x].xyz;
  vec3 v0v2 = positions[triIndices.z].xyz - positions[triIndices.x].xyz;

  vec3 pvec = cross(v0v1, v0v2);
  return 0.5 * sqrt(dot(pvec, pvec)); 
}

vec3 triangleRandomDirection(uvec3 triIndices, vec3 origin, uint additionalRandomSeed) {
  vec3 a = positions[triIndices.y].xyz - positions[triIndices.x].xyz;
  vec3 b = positions[triIndices.z].xyz - positions[triIndices.x].xyz;

  float u1 = randomFloat(additionalRandomSeed);
  float u2 = randomFloat(additionalRandomSeed + 1);

  if (u1 + u2 > 1) {
    u1 = 1 - u1;
    u2 = 1 - u2;
  }

  vec3 randomTriangle = u1 * a + u2 * b + positions[triIndices.x].xyz;
  return randomTriangle - origin;
}