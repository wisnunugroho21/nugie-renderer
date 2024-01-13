// ------------- Basic -------------

vec3 rayAt(Ray r, float t) {
  return r.origin + t * r.direction;
}

vec3[3] buildOnb(vec3 normal) {
  vec3 a = abs(normalize(normal).x) > 0.9 ? vec3(0.0f, 1.0f, 0.0f) : vec3(1.0f, 0.0f, 0.0f);

  vec3 z = normalize(normal);
  vec3 y = normalize(cross(z, a));
  vec3 x = cross(z, y);

  return vec3[3](x, y, z);
}

vec3 setFaceNormal(vec3 r_direction, vec3 outwardNormal) {
  return dot(r_direction, outwardNormal) < 0.0f ? outwardNormal : -1.0f * outwardNormal;
}

/* vec2 getTotalTextureCoordinate(uvec3 triIndices, vec2 uv) {
  return (1.0f - uv.x - uv.y) * textCoords[triIndices.x] + uv.x * textCoords[triIndices.y] + uv.y * textCoords[triIndices.z];
} */

// ------------- Point Light -------------

/* HitRecord hitPointLight(PointLight light, Ray r, float tMin, float tMax) {
  HitRecord hit;
  hit.isHit = false;

  vec3 lightDirection = normalize(light.position - r.origin);
  if (dot(lightDirection, normalize(r.direction)) < 1.0f) {
    return hit;
  }

  float t = (light.position - r.origin).x / r.direction.x; // Only works if dot(lightDir, rayDir) == 1, otherwise use => length(lightDirection / r.direction);
  if (t < tMin || t > tMax) {
    return hit;
  }

  hit.isHit = true;
  hit.t = t;
  hit.point = light.position;
  hit.normal = setFaceNormal(r.direction, lightDirection);

  return hit;
} */

// ------------- Area Light -------------
/* HitRecord hitAreaLight(AreaLight light, Ray r, float tMin, float tMax) {
  HitRecord hit;
  hit.isHit = false;

  vec3 v0v1 = light.point1 - light.point0;
  vec3 v0v2 = light.point2 - light.point0;
  vec3 pvec = cross(r.direction, v0v2);
  float det = dot(v0v1, pvec);
  
  if (abs(det) < KEPSILON) {
    return hit;
  }
    
  float invDet = 1.0f / det;

  vec3 tvec = r.origin - light.point0;
  float u = dot(tvec, pvec) * invDet;
  if (u < 0.0f || u > 1.0f) {
    return hit;
  }

  vec3 qvec = cross(tvec, v0v1);
  float v = dot(r.direction, qvec) * invDet;
  if (v < 0.0f || u + v > 1.0f) {
    return hit;
  }
  
  float t = dot(v0v2, qvec) * invDet;

  if (t <= KEPSILON) {
    return hit;
  }

  if (t < tMin || t > tMax) {
    return hit;
  }

  hit.isHit = true;
  hit.t = t;
  hit.point = rayAt(r, t);
  hit.uv = vec2(u, v);

  vec3 outwardNormal = normalize(cross(v0v1, v0v2));
  hit.normal = setFaceNormal(r.direction, outwardNormal);

  return hit;
} */

// ------------- Triangle -------------

HitRecord hitTriangle(uvec3 triIndices, Ray r, float tMin, float tMax, uint transformIndex) {
  HitRecord hit;
  hit.isHit = false;

  vec3 xPosition = positions[triIndices.x].position.xyz;

  vec3 v0v1 = positions[triIndices.y].position.xyz - xPosition.xyz;
  vec3 v0v2 = positions[triIndices.z].position.xyz - xPosition.xyz;
  vec3 pvec = cross(r.direction, v0v2);
  float det = dot(v0v1, pvec);
  
  if (abs(det) < KEPSILON) {
    return hit;
  }
    
  float invDet = 1.0f / det;

  vec3 tvec = r.origin - xPosition.xyz;
  float u = dot(tvec, pvec) * invDet;
  if (u < 0.0f || u > 1.0f) {
    return hit;
  }

  vec3 qvec = cross(tvec, v0v1);
  float v = dot(r.direction, qvec) * invDet;
  if (v < 0.0f || u + v > 1.0f) {
    return hit;
  }
  
  float t = dot(v0v2, qvec) * invDet;

  if (t <= KEPSILON) {
    return hit;
  }

  if (t < tMin || t > tMax) {
    return hit;
  }

  Transformation transforms = transformations[transformIndex];

  hit.isHit = true;
  hit.t = t;
  hit.point = (transforms.pointMatrix * vec4(rayAt(r, t), 1.0f)).xyz;
  hit.uv = vec2(u, v);

  vec3 outwardNormal = normalize(cross(v0v1, v0v2));
  hit.normal = normalize(mat3(transforms.normalMatrix) * setFaceNormal(r.direction, outwardNormal));

  return hit;
}

// ------------- Bvh -------------

bool intersectAABB(Ray r, vec3 boxMin, vec3 boxMax) {
  vec3 tMin = (boxMin - r.origin) / r.direction;
  vec3 tMax = (boxMax - r.origin) / r.direction;
  vec3 t1 = min(tMin, tMax);
  vec3 t2 = max(tMin, tMax);
  float tNear = max(max(t1.x, t1.y), t1.z);
  float tFar = min(min(t2.x, t2.y), t2.z);

  return tNear < tFar;
}

HitRecord hitPrimitiveBvh(Ray r, float tMin, float tMax, uint firstBvhIndex, uint firstPrimitiveIndex, uint transformIndex) {
  HitRecord hit;
  hit.isHit = false;
  hit.t = tMax;

  uint stack[30];
  stack[0] = 1u;

  Transformation transforms = transformations[transformIndex];
  int stackIndex = 1;  

  r.origin = (transforms.pointInverseMatrix * vec4(r.origin, 1.0f)).xyz;
  r.direction = mat3(transforms.dirInverseMatrix) * r.direction;

  while(stackIndex > 0 && stackIndex <= 30) {
    stackIndex--;
    uint currentNode = stack[stackIndex];
    if (currentNode == 0u) {
      continue;
    }

    BvhNode primBvhNode = primitiveBvhNodes[currentNode - 1u + firstBvhIndex];

    if (!intersectAABB(r, primBvhNode.minimum.xyz, primBvhNode.maximum.xyz)) {
      continue;
    }

    uint primIndex = primBvhNode.nodeObjectIndex.z;
    if (primIndex >= 1u) {
      HitRecord tempHit = hitTriangle(primitives[primIndex - 1u + firstPrimitiveIndex].indicesMaterialIndex.xyz, r, tMin, hit.t, transformIndex);

      if (tempHit.isHit) {
        hit = tempHit;
        hit.hitIndex = primIndex - 1u + firstPrimitiveIndex;
        // hit.uv = getTotalTextureCoordinate(primitives[hit.hitIndex].indices, hit.uv);
      }
    }

    primIndex = primBvhNode.nodeObjectIndex.w;    
    if (primIndex >= 1u) {
      HitRecord tempHit = hitTriangle(primitives[primIndex - 1u + firstPrimitiveIndex].indicesMaterialIndex.xyz, r, tMin, hit.t, transformIndex);

      if (tempHit.isHit) {
        hit = tempHit;
        hit.hitIndex = primIndex - 1u + firstPrimitiveIndex;
        // hit.uv = getTotalTextureCoordinate(primitives[hit.hitIndex].indices, hit.uv);
      }
    }

    uint bvhNodeIndex = primBvhNode.nodeObjectIndex.x;
    if (bvhNodeIndex >= 1u) {
      stack[stackIndex] = bvhNodeIndex;
      stackIndex++;
    }

    bvhNodeIndex = primBvhNode.nodeObjectIndex.y;
    if (bvhNodeIndex >= 1u) {
      stack[stackIndex] = bvhNodeIndex;
      stackIndex++;
    }
  }

  return hit;
}

HitRecord hitObjectBvh(Ray r, float tMin, float tMax) {
  HitRecord hit;
  hit.isHit = false;
  hit.t = tMax;

  uint stack[30];
  stack[0] = 1u;

  int stackIndex = 1;
  while(stackIndex > 0 && stackIndex <= 30) {
    stackIndex--;
    uint currentNode = stack[stackIndex];
    if (currentNode == 0u) {
      continue;
    }

    BvhNode objBvhNode = objectBvhNodes[currentNode - 1u];

    if (!intersectAABB(r, objBvhNode.minimum.xyz, objBvhNode.maximum.xyz)) {
      continue;
    }

    uint objIndex = objBvhNode.nodeObjectIndex.z;
    if (objIndex >= 1u) {
      Object object = objects[objIndex - 1u];
      HitRecord tempHit = hitPrimitiveBvh(r, tMin, hit.t, object.bvhPrimitiveTransformIndex.x, object.bvhPrimitiveTransformIndex.y, object.bvhPrimitiveTransformIndex.z);

      if (tempHit.isHit) {
        hit = tempHit;
      }
    }

    objIndex = objBvhNode.nodeObjectIndex.w;
    if (objIndex >= 1u) {
      Object object = objects[objIndex - 1u];
      HitRecord tempHit = hitPrimitiveBvh(r, tMin, hit.t, object.bvhPrimitiveTransformIndex.x, object.bvhPrimitiveTransformIndex.y, object.bvhPrimitiveTransformIndex.z);

      if (tempHit.isHit) {
        hit = tempHit;
      }
    }

    uint bvhNode = objBvhNode.nodeObjectIndex.x;
    if (bvhNode >= 1u) {
      stack[stackIndex] = bvhNode;
      stackIndex++;
    }

    bvhNode = objBvhNode.nodeObjectIndex.y;
    if (bvhNode >= 1u) {
      stack[stackIndex] = bvhNode;
      stackIndex++;
    }
  }

  return hit;
}

// ------------- Light BVH -------------

/* HitRecord hitLightBvh(Ray r, float tMin, float tMax) {
  HitRecord hit;
  hit.isHit = false;
  hit.t = tMax;

  uint stack[30];
  stack[0] = 1u;

  int stackIndex = 1;
  while(stackIndex > 0 && stackIndex <= 30) {
    stackIndex--;
    uint currentNode = stack[stackIndex];
    if (currentNode == 0u) {
      continue;
    }

    if (!intersectAABB(r, lightBvhNodes[currentNode - 1u].minimum, lightBvhNodes[currentNode - 1u].maximum)) {
      continue;
    }

    uint lightIndex = lightBvhNodes[currentNode - 1u].nodeObjectIndex.z;
    if (lightIndex >= 1u) {
      // HitRecord tempHit = hitPointLight(lights[lightIndex - 1u], r, tMin, hit.t);
      HitRecord tempHit = hitAreaLight(lights[lightIndex - 1u], r, tMin, hit.t);

      if (tempHit.isHit) {
        hit = tempHit;
        hit.hitIndex = lightIndex - 1u;
      }
    }

    lightIndex = lightBvhNodes[currentNode - 1u].nodeObjectIndex.w;    
    if (lightIndex >= 1u) {
      // HitRecord tempHit = hitPointLight(lights[lightIndex - 1u], r, tMin, hit.t);
      HitRecord tempHit = hitAreaLight(lights[lightIndex - 1u], r, tMin, hit.t);

      if (tempHit.isHit) {
        hit = tempHit;
        hit.hitIndex = lightIndex - 1u;
      }
    }

    uint bvhNode = lightBvhNodes[currentNode - 1u].nodeObjectIndex.x;
    if (bvhNode >= 1u) {
      stack[stackIndex] = bvhNode;
      stackIndex++;
    }

    bvhNode = lightBvhNodes[currentNode - 1u].nodeObjectIndex.y;
    if (bvhNode >= 1u) {
      stack[stackIndex] = bvhNode;
      stackIndex++;
    }
  }

  return hit;
} */