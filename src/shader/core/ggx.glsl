// ------------- GGX Function -------------

float fresnelSchlick(float VoH, float F0) {
  return F0 + (1.0f - F0) * pow(1.0f - VoH, 5.0f);
} 

float D_GGX(float NoH, float roughness) {
  float r = max(roughness, 0.05f);
  
  float alpha = r * r;
  float alpha2 = alpha * alpha;
  
  float b = (NoH * NoH * (alpha2 - 1.0f) + 1.0f);
  return alpha2 / (pi * b * b);
}
float G1_GGX_Schlick(float cosine, float roughness) {
  float r = 0.5 + 0.5 * roughness; // Disney remapping
  float k = (r * r) / 2.0f;

  float denom = cosine * (1.0f - k) + k;
  return cosine / denom;
}

float G1_GGX(float cosine, float roughness) {
  float alpha = roughness * roughness;
  float alpha2 = alpha * alpha;

  float b = alpha2 + (1 - alpha2) * cosine * cosine;
  return 2 * cosine / (cosine + sqrt(b));
}

float G_Smith(float NoV, float NoL, float roughness) {
  float g1_l = G1_GGX(NoL, roughness);
  float g1_v = G1_GGX(NoV, roughness);

  return g1_l * g1_v;
}