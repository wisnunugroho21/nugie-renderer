// Random number generation using pcg32i_random_t, using inc = 1. Our random state is a uint.
uint stepRNG(uint rngState) {
  return rngState * 747796405 + 1;
}

// Steps the RNG and returns a floating-point value between 0 and 1 inclusive.
float stepAndOutputRNGFloat(inout uint rngState) {
  // Condensed version of pcg_output_rxs_m_xs_32_32, with simple conversion to floating-point [0,1].
  rngState  = stepRNG(rngState);
  uint word = ((rngState >> ((rngState >> 28u) + 4u)) ^ rngState) * 277803737u;
  word      = (word >> 22u) ^ word;
  return float(word) / 4294967295.0f;
}

uint stepAndOutputRNGUint(inout uint rngState) {
  // Condensed version of pcg_output_rxs_m_xs_32_32, with simple conversion to floating-point [0,1].
  rngState  = stepRNG(rngState);
  uint word = ((rngState >> ((rngState >> 28u) + 4u)) ^ rngState) * 277803737u;
  word      = (word >> 22u) ^ word;
  return word / 4294967295u;
}

float randomFloat(uint additionalRandomSeed) {
  uint rngState =  uint(ubo.screenSize.x * gl_FragCoord.y + gl_FragCoord.x) * (push.randomSeed + 1 + additionalRandomSeed);
  return stepAndOutputRNGFloat(rngState);
}

uint randomUint(uint additionalRandomSeed) {
  uint rngState =  uint(ubo.screenSize.x * gl_FragCoord.y + gl_FragCoord.x) * (push.randomSeed + 1 + additionalRandomSeed);
  return stepAndOutputRNGUint(rngState);
}

float randomFloatAt(float min, float max, uint additionalRandomSeed) {
  return min + (max - min) * randomFloat(additionalRandomSeed);
}

int randomInt(float min, float max, uint additionalRandomSeed) {
  return int(randomFloatAt(min, max + 1, additionalRandomSeed));
}

uint randomUint(uint min, uint max, uint additionalRandomSeed) {
  return uint(randomFloatAt(min, max + 1, additionalRandomSeed));
}

vec3 randomVecThree(uint additionalRandomSeed) {
  return vec3(randomFloat(additionalRandomSeed), randomFloat(additionalRandomSeed + 1), randomFloat(additionalRandomSeed + 2));
}

vec3 randomVecThreeAt(float min, float max, uint additionalRandomSeed) {
  return vec3(randomFloatAt(min, max, additionalRandomSeed), randomFloatAt(min, max, additionalRandomSeed), randomFloatAt(min, max, additionalRandomSeed));
}

vec3 randomInUnitSphere(uint additionalRandomSeed) {
  while (true) {
    vec3 p = randomVecThreeAt(-1.0f, 1.0f, additionalRandomSeed);

    if (dot(p, p) < 1) {
      return p;
    }
  }
}

vec3 randomInHemisphere(vec3 normal, uint additionalRandomSeed) {
  vec3 in_unit_sphere = randomInUnitSphere(additionalRandomSeed);

  // In the same hemisphere as the normal
  if (dot(in_unit_sphere, normal) > 0.0f) {
    return in_unit_sphere;
  } else {
    return -in_unit_sphere;
  }   
}

vec3 randomInUnitDisk(uint additionalRandomSeed) {
  while (true) {
    vec3 p = vec3(randomFloatAt(-1.0f, 1.0f, additionalRandomSeed), randomFloatAt(-1.0f, 1.0f, additionalRandomSeed), 0.0f);

    if (dot(p, p) < 1) {
      return p;
    }
  }
}