// ------------- vec4 -------------

vec4 when_eq(vec4 x, vec4 y) {
  return 1.0 - abs(sign(x - y));
}

vec4 when_neq(vec4 x, vec4 y) {
  return abs(sign(x - y));
}

vec4 when_gt(vec4 x, vec4 y) {
  return max(sign(x - y), 0.0);
}

vec4 when_lt(vec4 x, vec4 y) {
  return max(sign(y - x), 0.0);
}

vec4 when_ge(vec4 x, vec4 y) {
  return 1.0 - when_lt(x, y);
}

vec4 when_le(vec4 x, vec4 y) {
  return 1.0 - when_gt(x, y);
}

vec4 when_and(vec4 a, vec4 b) {
  return a * b;
}

vec4 when_or(vec4 a, vec4 b) {
  return min(a + b, 1.0);
}

vec4 when_xor(vec4 a, vec4 b) {
  return mod(a + b, 2.0f);
}

vec4 when_not(vec4 a) {
  return 1.0 - a;
}

// ------------- vec3 -------------

vec3 when_eq(vec3 x, vec3 y) {
  return 1.0 - abs(sign(x - y));
}

vec3 when_neq(vec3 x, vec3 y) {
  return abs(sign(x - y));
}

vec3 when_gt(vec3 x, vec3 y) {
  return max(sign(x - y), 0.0);
}

vec3 when_lt(vec3 x, vec3 y) {
  return max(sign(y - x), 0.0);
}

vec3 when_ge(vec3 x, vec3 y) {
  return 1.0 - when_lt(x, y);
}

vec3 when_le(vec3 x, vec3 y) {
  return 1.0 - when_gt(x, y);
}

vec3 when_and(vec3 a, vec3 b) {
  return a * b;
}

vec3 when_or(vec3 a, vec3 b) {
  return min(a + b, 1.0);
}

vec3 when_xor(vec3 a, vec3 b) {
  return mod(a + b, 2.0f);
}

vec3 when_not(vec3 a) {
  return 1.0 - a;
}

// ------------- vec2 -------------

vec2 when_eq(vec2 x, vec2 y) {
  return 1.0 - abs(sign(x - y));
}

vec2 when_neq(vec2 x, vec2 y) {
  return abs(sign(x - y));
}

vec2 when_gt(vec2 x, vec2 y) {
  return max(sign(x - y), 0.0);
}

vec2 when_lt(vec2 x, vec2 y) {
  return max(sign(y - x), 0.0);
}

vec2 when_ge(vec2 x, vec2 y) {
  return 1.0 - when_lt(x, y);
}

vec2 when_le(vec2 x, vec2 y) {
  return 1.0 - when_gt(x, y);
}

vec2 when_and(vec2 a, vec2 b) {
  return a * b;
}

vec2 when_or(vec2 a, vec2 b) {
  return min(a + b, 1.0);
}

vec2 when_xor(vec2 a, vec2 b) {
  return mod(a + b, 2.0f);
}

vec2 when_not(vec2 a) {
  return 1.0 - a;
}

// ------------- float -------------

float when_eq(float x, float y) {
  return 1.0 - abs(sign(x - y));
}

float when_neq(float x, float y) {
  return abs(sign(x - y));
}

float when_gt(float x, float y) {
  return max(sign(x - y), 0.0);
}

float when_lt(float x, float y) {
  return max(sign(y - x), 0.0);
}

float when_ge(float x, float y) {
  return 1.0 - when_lt(x, y);
}

float when_le(float x, float y) {
  return 1.0 - when_gt(x, y);
}

float when_and(float a, float b) {
  return a * b;
}

float when_or(float a, float b) {
  return min(a + b, 1.0);
}

float when_xor(float a, float b) {
  return mod(a + b, 2.0f);
}

float when_not(float a) {
  return 1.0 - a;
}