// Punctual light evaluation (directional / point / spot) on top of the shared Cook-Torrance core in brdf.wgsl.
// Area lights (LTC) and image-based lighting are added in their own chunks.
//
//#include brdf

// Smooth range window (Karis): reaches exactly 0 at `range`, ~1 well inside. range <= 0 means unlimited.
fn rangeWindow(d: f32, range: f32) -> f32 {
  if (range <= 0.0) { return 1.0; }
  let x = d / range;
  let w = clamp(1.0 - x * x * x * x, 0.0, 1.0);
  return w * w;
}

// Inverse-square falloff with the range window. d2 = squared distance to the light.
fn pointAttenuation(d2: f32, range: f32) -> f32 {
  return rangeWindow(sqrt(d2), range) / max(d2, 1e-4);
}

// Spot cone: smooth between the outer and inner cone angles. L = direction from the SURFACE toward the light.
fn spotFactor(light: Light, L: vec3<f32>) -> f32 {
  let cd = dot(-L, light.directionType.xyz);
  let t = clamp((cd - light.spot.x) * light.spot.y, 0.0, 1.0);
  return t * t;
}

// Radiance arriving at P from a punctual light and the unit vector toward it. Returns vec4(radiance rgb, 0); L via pointer.
fn lightRadiance(light: Light, P: vec3<f32>, L: ptr<function, vec3<f32>>) -> vec3<f32> {
  let kind = u32(light.directionType.w + 0.5);
  var radiance = light.colorIntensity.rgb * light.colorIntensity.w;
  if (kind == LIGHT_DIRECTIONAL) {
    *L = -light.directionType.xyz;
    return radiance;
  }
  let toLight = light.positionRange.xyz - P;
  let d2 = dot(toLight, toLight);
  *L = toLight * inverseSqrt(max(d2, 1e-8));
  radiance = radiance * pointAttenuation(d2, light.positionRange.w);
  if (kind == LIGHT_SPOT) { radiance = radiance * spotFactor(light, *L); }
  return radiance;
}

// ---- Rectangular area lights -------------------------------------------------------------------------------------
// Diffuse: exact polygon form factor (Lambert's edge formula after clipping to the horizon). Specular: Linearly Transformed
// Cosines - the rectangle is transformed by the fitted inverse matrix of the GGX lobe and integrated against a clamped cosine.
// Radiance = color * intensity per unit area.

fn areaCorner(light: Light, i: u32) -> vec3<f32> {
  let sx = select(-1.0, 1.0, i == 1u || i == 2u);
  let sy = select(-1.0, 1.0, i >= 2u);
  return light.positionRange.xyz + light.right.xyz * (sx * light.right.w) + light.up.xyz * (sy * light.up.w);
}

// True when P is on the emitting side of the light (or the light is two-sided).
fn areaFacesPoint(light: Light, P: vec3<f32>) -> bool {
  return light.spot.w > 0.5 || dot(P - light.positionRange.xyz, light.directionType.xyz) > 0.0;
}

// Integral of the clamped cosine (w.r.t. N) over the solid angle of the quad c0..c3 (vectors relative to the shaded point),
// divided by PI. The quad is clipped to the horizon plane dot(x, N) = 0 first.
fn quadFormFactor(c0: vec3<f32>, c1: vec3<f32>, c2: vec3<f32>, c3: vec3<f32>, N: vec3<f32>) -> f32 {
  var q = array<vec3<f32>, 4>(c0, c1, c2, c3);
  var poly: array<vec3<f32>, 8>;
  var n = 0u;
  for (var i = 0u; i < 4u; i = i + 1u) {
    let a = q[i];
    let b = q[(i + 1u) % 4u];
    let da = dot(a, N); let db = dot(b, N);
    if (da >= 0.0) { poly[n] = a; n = n + 1u; }
    if ((da >= 0.0) != (db >= 0.0)) { poly[n] = a + (b - a) * (da / (da - db)); n = n + 1u; }
  }
  if (n < 3u) { return 0.0; }
  var sum = 0.0;
  for (var i = 0u; i < n; i = i + 1u) {
    let a = normalize(poly[i]); let b = normalize(poly[(i + 1u) % n]);
    let c = cross(a, b); let cl = length(c);
    if (cl > 1e-6) { sum += acos(clamp(dot(a, b), -1.0, 1.0)) * dot(N, c / cl); }
  }
  return abs(sum) / (2.0 * PI);
}

// E / (PI * L) for a diffuse receiver (P, N).
fn areaFormFactor(light: Light, P: vec3<f32>, N: vec3<f32>) -> f32 {
  if (!areaFacesPoint(light, P)) { return 0.0; }
  return quadFormFactor(areaCorner(light, 0u) - P, areaCorner(light, 1u) - P, areaCorner(light, 2u) - P, areaCorner(light, 3u) - P, N);
}

// Fraction of the (normalised) GGX lobe covered by the rectangle. `ltc` = (ia, ib, ic) of M^-1 = [[ia,0,ib],[0,ic,0],[0,0,1]]
// from the LTC table; the final reflectance is  (f0 * A + B) * this  with (A, B) from the BRDF LUT.
fn areaSpecularFraction(light: Light, N: vec3<f32>, V: vec3<f32>, P: vec3<f32>, ltc: vec3<f32>) -> f32 {
  if (!areaFacesPoint(light, P)) { return 0.0; }
  let T1 = normalize(V - N * dot(N, V));
  let T2 = cross(N, T1);
  var c: array<vec3<f32>, 4>;
  for (var i = 0u; i < 4u; i = i + 1u) {
    let v = areaCorner(light, i) - P;
    let l = vec3<f32>(dot(T1, v), dot(T2, v), dot(N, v));
    c[i] = vec3<f32>(ltc.x * l.x + ltc.y * l.z, ltc.z * l.y, l.z);
  }
  return quadFormFactor(c[0], c[1], c[2], c[3], vec3<f32>(0.0, 0.0, 1.0));
}

// Point / spot / directional light shading (no scene bindings needed).
fn shadePointLike(light: Light, s: SurfaceInfo, P: vec3<f32>) -> vec3<f32> {
  var L = vec3<f32>(0.0, 1.0, 0.0);
  let radiance = lightRadiance(light, P, &L);
  if (dot(radiance, radiance) <= 0.0) { return vec3<f32>(0.0); }
  return evaluateDirectLight(s, L, radiance);
}
