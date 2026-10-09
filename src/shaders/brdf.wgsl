// Shared BRDF core. Direct lights, area lights and IBL all build on these.
//   - Cook-Torrance metallic-roughness (GGX, height-correlated Smith, Schlick) with the glTF physical extensions:
//     clearcoat, sheen (Charlie), anisotropy, specular weight (f90) and thin-film iridescence;
//   - the simple shading models: Lambert, Blinn-Phong and Toon.
// Extension fields of SurfaceInfo are zero by default, so a plain material compiles to exactly the old BRDF.
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

// Schlick with an explicit grazing reflectance (KHR_materials_specular lowers it below 1).
fn F_Schlick90(VoH: f32, f0: vec3<f32>, f90: f32) -> vec3<f32> {
  let f = pow(1.0 - VoH, 5.0);
  return f0 + (vec3<f32>(f90) - f0) * f;
}

// ---- anisotropic GGX (glTF KHR_materials_anisotropy) ----------------------------------------------------------------
fn D_GGX_aniso(NoH: f32, ToH: f32, BoH: f32, at: f32, ab: f32) -> f32 {
  let a2 = at * ab;
  let f = vec3<f32>(ab * ToH, at * BoH, a2 * NoH);
  let w2 = a2 / dot(f, f);
  return a2 * w2 * w2 / PI;
}

fn V_GGX_aniso(NoL: f32, NoV: f32, BoV: f32, ToV: f32, ToL: f32, BoL: f32, at: f32, ab: f32) -> f32 {
  let ggxv = NoL * length(vec3<f32>(at * ToV, ab * BoV, NoV));
  let ggxl = NoV * length(vec3<f32>(at * ToL, ab * BoL, NoL));
  return clamp(0.5 / max(ggxv + ggxl, 1e-5), 0.0, 1.0);
}

// ---- clearcoat visibility (Kelemen) -----------------------------------------------------------------------------------
fn V_Kelemen(LoH: f32) -> f32 { return 0.25 / max(LoH * LoH, 1e-4); }

// ---- sheen: Charlie distribution + Neubelt-style visibility (Estevez & Kulla, as in the glTF sample renderer) ----------------
fn D_Charlie(sheenRoughness: f32, NoH: f32) -> f32 {
  let alphaG = max(sheenRoughness, 1e-3) * max(sheenRoughness, 1e-3);
  let invR = 1.0 / alphaG;
  let cos2h = NoH * NoH;
  let sin2h = max(1.0 - cos2h, 1e-5);
  return (2.0 + invR) * pow(sin2h, invR * 0.5) / (2.0 * PI);
}

fn lambdaSheenHelper(x: f32, alphaG: f32) -> f32 {
  let om = (1.0 - alphaG) * (1.0 - alphaG);
  let a = mix(21.5473, 25.3245, om);
  let b = mix(3.82987, 3.32435, om);
  let c = mix(0.19823, 0.16801, om);
  let d = mix(-1.97760, -1.27393, om);
  let e = mix(-4.32054, -4.85967, om);
  return a / (1.0 + b * pow(x, c)) + d * x + e;
}

fn lambdaSheen(cosTheta: f32, alphaG: f32) -> f32 {
  if (abs(cosTheta) < 0.5) { return exp(lambdaSheenHelper(abs(cosTheta), alphaG)); }
  return exp(2.0 * lambdaSheenHelper(0.5, alphaG) - lambdaSheenHelper(1.0 - abs(cosTheta), alphaG));
}

fn V_Sheen(NoL: f32, NoV: f32, sheenRoughness: f32) -> f32 {
  let alphaG = max(sheenRoughness, 1e-3) * max(sheenRoughness, 1e-3);
  return clamp(1.0 / ((1.0 + lambdaSheen(NoV, alphaG) + lambdaSheen(NoL, alphaG)) * (4.0 * max(NoV * NoL, 1e-4))), 0.0, 1.0);
}

fn max3(c: vec3<f32>) -> f32 { return max(c.x, max(c.y, c.z)); }

// How much light the sheen layer takes away from the base layer (a fit of the sheen albedo-scaling table: grows towards grazing angles).
fn sheenAlbedoScale(sheenColor: vec3<f32>, NoV: f32) -> f32 {
  let g = 1.0 - clamp(NoV, 0.0, 1.0);
  return 1.0 - max3(sheenColor) * (0.2 + 0.4 * g * g);
}

// ---- thin-film iridescence (Belcour & Barla 2017, as in the glTF sample renderer) ---------------------------------------
fn sq1(x: f32) -> f32 { return x * x; }
fn sq3(x: vec3<f32>) -> vec3<f32> { return x * x; }

fn fresnel0ToIor(f0: vec3<f32>) -> vec3<f32> {
  let s = sqrt(f0);
  return (vec3<f32>(1.0) + s) / (vec3<f32>(1.0) - s);
}

fn iorToFresnel0v(transmitted: vec3<f32>, incident: f32) -> vec3<f32> {
  return sq3((transmitted - vec3<f32>(incident)) / (transmitted + vec3<f32>(incident)));
}

fn iorToFresnel0(transmitted: f32, incident: f32) -> f32 { return sq1((transmitted - incident) / (transmitted + incident)); }

fn evalSensitivity(opd: f32, shift: vec3<f32>) -> vec3<f32> {
  let phase = 2.0 * PI * opd * 1.0e-9;
  let val = vec3<f32>(5.4856e-13, 4.4201e-13, 5.2481e-13);
  let pos = vec3<f32>(1.6810e+06, 1.7953e+06, 2.2084e+06);
  let vr = vec3<f32>(4.3278e+09, 9.3046e+09, 6.6121e+09);
  var xyz = val * sqrt(2.0 * PI * vr) * cos(pos * phase + shift) * exp(-phase * phase * vr);
  xyz.x += 9.7470e-14 * sqrt(2.0 * PI * 4.5282e+09) * cos(2.2399e+06 * phase + shift.x) * exp(-4.5282e+09 * phase * phase);
  xyz = xyz / 1.0685e-7;
  let xyzToRec709 = mat3x3<f32>(
    vec3<f32>(3.2404542, -0.9692660, 0.0556434),
    vec3<f32>(-1.5371385, 1.8760108, -0.2040259),
    vec3<f32>(-0.4985314, 0.0415560, 1.0572252));
  return xyzToRec709 * xyz;
}

// Fresnel of a base layer with reflectance f0 under a thin film of index `filmIor` and thickness (nm); returns the colour-shifted reflectance.
fn evalIridescence(outsideIor: f32, filmIor: f32, cosTheta1: f32, thickness: f32, baseF0: vec3<f32>) -> vec3<f32> {
  let iridIor = mix(outsideIor, filmIor, smoothstep(0.0, 0.03, thickness));
  let sinTheta2Sq = sq1(outsideIor / iridIor) * (1.0 - sq1(cosTheta1));
  let cosTheta2Sq = 1.0 - sinTheta2Sq;
  if (cosTheta2Sq < 0.0) { return vec3<f32>(1.0); }                     // total internal reflection
  let cosTheta2 = sqrt(cosTheta2Sq);
  let r0 = iorToFresnel0(iridIor, outsideIor);
  let r12 = r0 + (1.0 - r0) * pow(1.0 - cosTheta1, 5.0);
  let t121 = 1.0 - r12;
  var phi12 = 0.0;
  if (iridIor < outsideIor) { phi12 = PI; }
  let phi21 = PI - phi12;
  let baseIor = fresnel0ToIor(clamp(baseF0, vec3<f32>(0.0), vec3<f32>(0.9999)));
  let r1 = iorToFresnel0v(baseIor, iridIor);
  let r23 = r1 + (vec3<f32>(1.0) - r1) * pow(1.0 - cosTheta2, 5.0);
  let phi23 = vec3<f32>(select(0.0, PI, baseIor.x < iridIor), select(0.0, PI, baseIor.y < iridIor), select(0.0, PI, baseIor.z < iridIor));
  let opd = 2.0 * iridIor * thickness * cosTheta2;
  let phi = vec3<f32>(phi21) + phi23;
  let r123 = clamp(r12 * r23, vec3<f32>(1e-5), vec3<f32>(0.9999));
  let rr = sqrt(r123);
  let rs = sq1(t121) * r23 / (vec3<f32>(1.0) - r123);
  var intensity = vec3<f32>(r12) + rs;                                  // DC term
  var cm = rs - vec3<f32>(t121);
  for (var m = 1; m <= 2; m = m + 1) {
    cm = cm * rr;
    intensity = intensity + cm * 2.0 * evalSensitivity(f32(m) * opd, f32(m) * phi);
  }
  return max(intensity, vec3<f32>(0.0));
}

// ---- surface description ----------------------------------------------------------------------------------------------

struct SurfaceInfo {
  baseColor: vec3<f32>,
  metallic: f32,
  roughness: f32,   // perceptual roughness
  N: vec3<f32>,
  V: vec3<f32>,
  f0: vec3<f32>,
  diffuseColor: vec3<f32>,
  // --- shading model: 0 physically based, 1 Lambert, 2 Blinn-Phong, 3 Toon
  model: u32,
  shininess: f32,
  phongSpec: vec3<f32>,
  toonSteps: f32,
  toonRamp: f32,                     // 1: use `ramp` (8 samples of the ramp texture) instead of `toonSteps` flat bands
  ramp: array<f32, 8>,
  // --- physical extensions
  f90: f32,                          // grazing reflectance of the dielectric specular (KHR_materials_specular)
  Ng: vec3<f32>,                     // geometric normal (clearcoat lobe)
  clearcoat: f32,
  ccRoughness: f32,
  sheenColor: vec3<f32>,
  sheenRoughness: f32,
  aniso: f32,                        // anisotropy strength (signed); 0 = isotropic
  T: vec3<f32>,
  B: vec3<f32>,
};

fn makeSurface(baseColor: vec3<f32>, metallic: f32, roughness: f32, N: vec3<f32>, V: vec3<f32>) -> SurfaceInfo {
  var s: SurfaceInfo;                // zero-initialised: every extension off
  s.baseColor = baseColor;
  s.metallic = metallic;
  s.roughness = clamp(roughness, 0.04, 1.0);
  s.N = N;
  s.V = V;
  s.f0 = mix(vec3<f32>(0.04), baseColor, metallic);
  s.diffuseColor = baseColor * (1.0 - metallic);
  s.f90 = 1.0;
  s.Ng = N;
  s.shininess = 30.0;
  s.toonSteps = 3.0;
  return s;
}

// Lambert / Blinn-Phong / Toon for one light. radiance = light colour * intensity * attenuation.
fn evaluateSimpleLight(s: SurfaceInfo, L: vec3<f32>, radiance: vec3<f32>) -> vec3<f32> {
  let NoL = clamp(dot(s.N, L), 0.0, 1.0);
  if (NoL <= 0.0) { return vec3<f32>(0.0); }
  let diffuse = s.diffuseColor / PI;
  if (s.model == 1u) { return diffuse * radiance * NoL; }
  let H = normalize(s.V + L);
  let NoH = clamp(dot(s.N, H), 0.0, 1.0);
  if (s.model == 2u) {
    let spec = s.phongSpec * ((s.shininess + 8.0) / (8.0 * PI)) * pow(NoH, s.shininess);
    return (diffuse + spec) * radiance * NoL;
  }
  // toon: flat bands (or a ramp) instead of the smooth cosine; an optional hard highlight
  var band = ceil(NoL * s.toonSteps) / s.toonSteps;
  if (s.toonRamp > 0.5) {
    var ramp = s.ramp;
    band = ramp[min(u32(NoL * 8.0), 7u)];
  }
  var color = diffuse * radiance * band;
  if (max3(s.phongSpec) > 0.0 && pow(NoH, s.shininess) > 0.5) { color = color + s.phongSpec * radiance; }
  return color;
}

// radiance = light color * intensity * attenuation (already includes spot/range terms).
fn evaluateDirectLight(s: SurfaceInfo, L: vec3<f32>, radiance: vec3<f32>) -> vec3<f32> {
  if (s.model != 0u) { return evaluateSimpleLight(s, L, radiance); }
  let NoL = clamp(dot(s.N, L), 0.0, 1.0);
  let ccNoL = clamp(dot(s.Ng, L), 0.0, 1.0);
  if (NoL <= 0.0 && !(s.clearcoat > 0.0 && ccNoL > 0.0)) { return vec3<f32>(0.0); }
  let H = normalize(s.V + L);
  let NoV = max(dot(s.N, s.V), 1e-4);
  let NoH = clamp(dot(s.N, H), 0.0, 1.0);
  let VoH = clamp(dot(s.V, H), 0.0, 1.0);
  let a = s.roughness * s.roughness;
  let F = F_Schlick90(VoH, s.f0, s.f90);
  var D: f32;
  var Vis: f32;
  if (s.aniso != 0.0) {
    let at = mix(a, 1.0, s.aniso * s.aniso);
    let ab = clamp(a, 0.001, 1.0);
    D = D_GGX_aniso(NoH, dot(s.T, H), dot(s.B, H), at, ab);
    Vis = V_GGX_aniso(NoL, NoV, dot(s.B, s.V), dot(s.T, s.V), dot(s.T, L), dot(s.B, L), at, ab);
  } else {
    D = D_GGX(NoH, a);
    Vis = V_SmithGGXCorrelated(NoV, NoL, a);
  }
  let spec = D * Vis * F;
  let diff = (vec3<f32>(1.0) - F) * s.diffuseColor / PI;
  var base = diff + spec;
  var extra = vec3<f32>(0.0);

  if (max3(s.sheenColor) > 0.0) {
    base = base * sheenAlbedoScale(s.sheenColor, NoV);
    extra = extra + s.sheenColor * D_Charlie(s.sheenRoughness, NoH) * V_Sheen(NoL, NoV, s.sheenRoughness) * NoL;
  }
  var coat = vec3<f32>(0.0);
  if (s.clearcoat > 0.0) {
    let ccA = max(s.ccRoughness * s.ccRoughness, 0.002);
    let ccNoH = clamp(dot(s.Ng, H), 0.0, 1.0);
    let Fc = s.clearcoat * (0.04 + 0.96 * pow(1.0 - VoH, 5.0));
    base = base * (1.0 - Fc);
    extra = extra * (1.0 - Fc);
    coat = vec3<f32>(D_GGX(ccNoH, ccA) * V_Kelemen(VoH) * Fc * ccNoL);
  }
  return (base * NoL + extra) * radiance + coat * radiance;
}
