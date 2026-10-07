// Shared Cook-Torrance BRDF core. Direct lights, area lights and IBL all build on these.
//#include common_color

fn D_GGX(NoH: f32, a: f32) -> f32 {
  let a2 = a * a;
  let d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

// Height-correlated Smith visibility (includes the 1 / (4 NoL NoV) term).
fn V_SmithGGXCorrelated(NoV: f32, NoL: f32, a: f32) -> f32 {
  let a2 = a * a;
  let gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  let gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}

fn F_Schlick(VoH: f32, f0: vec3<f32>) -> vec3<f32> {
  let f = pow(1.0 - VoH, 5.0);
  return f0 + (vec3<f32>(1.0) - f0) * f;
}

struct SurfaceInfo {
  baseColor: vec3<f32>,
  metallic: f32,
  roughness: f32,   // perceptual roughness
  N: vec3<f32>,
  V: vec3<f32>,
  f0: vec3<f32>,
  diffuseColor: vec3<f32>,
};

fn makeSurface(baseColor: vec3<f32>, metallic: f32, roughness: f32, N: vec3<f32>, V: vec3<f32>) -> SurfaceInfo {
  var s: SurfaceInfo;
  s.baseColor = baseColor;
  s.metallic = metallic;
  s.roughness = clamp(roughness, 0.04, 1.0);
  s.N = N;
  s.V = V;
  s.f0 = mix(vec3<f32>(0.04), baseColor, metallic);
  s.diffuseColor = baseColor * (1.0 - metallic);
  return s;
}

// radiance = light color * intensity * attenuation (already includes spot/range terms).
fn evaluateDirectLight(s: SurfaceInfo, L: vec3<f32>, radiance: vec3<f32>) -> vec3<f32> {
  let NoL = clamp(dot(s.N, L), 0.0, 1.0);
  if (NoL <= 0.0) { return vec3<f32>(0.0); }
  let H = normalize(s.V + L);
  let NoV = max(dot(s.N, s.V), 1e-4);
  let NoH = clamp(dot(s.N, H), 0.0, 1.0);
  let VoH = clamp(dot(s.V, H), 0.0, 1.0);
  let a = s.roughness * s.roughness;
  let F = F_Schlick(VoH, s.f0);
  let spec = D_GGX(NoH, a) * V_SmithGGXCorrelated(NoV, NoL, a) * F;
  let diff = (vec3<f32>(1.0) - F) * s.diffuseColor / PI;
  return (diff + spec) * radiance * NoL;
}
