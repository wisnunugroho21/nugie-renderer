// Full-screen post-processing passes: bloom (prefilter, downsample, upsample), composite (exposure, tone mapping, grading, sRGB) and FXAA.
// One shared bind layout: sampler, texA, texB and a 64-byte parameter block (a, b, c, d) per pass.
//#include common_color

struct Params { a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, d: vec4<f32> };

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var texA: texture_2d<f32>;
@group(0) @binding(2) var texB: texture_2d<f32>;
@group(0) @binding(3) var<uniform> P: Params;

struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> VOut {
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VOut;
  o.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2<f32>(p.x, 1.0 - p.y);
  return o;
}

fn src(uv: vec2<f32>) -> vec3<f32> { return textureSampleLevel(texA, samp, uv, 0.0).rgb; }

fn luma709(c: vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)); }

// ---- bloom ----------------------------------------------------------------------------------------------------------------------
// a = (1/srcWidth, 1/srcHeight, threshold, soft knee)
fn threshold(c: vec3<f32>) -> vec3<f32> {
  let br = max(c.r, max(c.g, c.b));
  let k = max(P.a.w, 1e-4);
  var soft = clamp(br - P.a.z + k, 0.0, 2.0 * k);
  soft = soft * soft / (4.0 * k);
  let contrib = max(soft, br - P.a.z) / max(br, 1e-5);
  return c * contrib;
}

fn tap13(uv: vec2<f32>, t: vec2<f32>) -> array<vec3<f32>, 13> {
  var s: array<vec3<f32>, 13>;
  s[0] = src(uv + t * vec2<f32>(-2.0, -2.0)); s[1] = src(uv + t * vec2<f32>(0.0, -2.0)); s[2] = src(uv + t * vec2<f32>(2.0, -2.0));
  s[3] = src(uv + t * vec2<f32>(-1.0, -1.0)); s[4] = src(uv + t * vec2<f32>(1.0, -1.0));
  s[5] = src(uv + t * vec2<f32>(-2.0, 0.0));  s[6] = src(uv);                              s[7] = src(uv + t * vec2<f32>(2.0, 0.0));
  s[8] = src(uv + t * vec2<f32>(-1.0, 1.0));  s[9] = src(uv + t * vec2<f32>(1.0, 1.0));
  s[10] = src(uv + t * vec2<f32>(-2.0, 2.0)); s[11] = src(uv + t * vec2<f32>(0.0, 2.0));  s[12] = src(uv + t * vec2<f32>(2.0, 2.0));
  return s;
}

// First pass: threshold each tap, then a Karis-weighted 13-tap downsample (suppresses single-pixel fireflies).
@fragment
fn fs_prefilter(in: VOut) -> @location(0) vec4<f32> {
  var s = tap13(in.uv, P.a.xy);
  for (var i = 0; i < 13; i++) { s[i] = threshold(s[i]); }
  let g0 = (s[3] + s[4] + s[8] + s[9]) * 0.25;
  let g1 = (s[0] + s[1] + s[5] + s[6]) * 0.25;
  let g2 = (s[1] + s[2] + s[6] + s[7]) * 0.25;
  let g3 = (s[5] + s[6] + s[10] + s[11]) * 0.25;
  let g4 = (s[6] + s[7] + s[11] + s[12]) * 0.25;
  let w0 = 0.5 / (1.0 + luma709(g0));
  let w1 = 0.125 / (1.0 + luma709(g1));
  let w2 = 0.125 / (1.0 + luma709(g2));
  let w3 = 0.125 / (1.0 + luma709(g3));
  let w4 = 0.125 / (1.0 + luma709(g4));
  let c = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  return vec4<f32>(c, 1.0);
}

@fragment
fn fs_down(in: VOut) -> @location(0) vec4<f32> {
  let s = tap13(in.uv, P.a.xy);
  let c = (s[3] + s[4] + s[8] + s[9]) * 0.125
        + (s[0] + s[1] + s[5] + s[6]) * 0.03125 + (s[1] + s[2] + s[6] + s[7]) * 0.03125
        + (s[5] + s[6] + s[10] + s[11]) * 0.03125 + (s[6] + s[7] + s[11] + s[12]) * 0.03125;
  return vec4<f32>(c, 1.0);
}

// 3x3 tent filter; the pipeline blends it additively onto the next larger level. a.xy = source texel size * radius.
@fragment
fn fs_up(in: VOut) -> @location(0) vec4<f32> {
  let t = P.a.xy;
  let uv = in.uv;
  let c = src(uv) * 4.0
        + (src(uv + vec2<f32>(0.0, t.y)) + src(uv - vec2<f32>(0.0, t.y)) + src(uv + vec2<f32>(t.x, 0.0)) + src(uv - vec2<f32>(t.x, 0.0))) * 2.0
        + src(uv + t) + src(uv - t) + src(uv + vec2<f32>(t.x, -t.y)) + src(uv + vec2<f32>(-t.x, t.y));
  return vec4<f32>(c / 16.0, 1.0);
}

// ---- tone mapping ---------------------------------------------------------------------------------------------------------------
fn tonemapReinhard(c: vec3<f32>) -> vec3<f32> { return c / (1.0 + c); }

// Khronos PBR Neutral: keeps base-colour hue and saturation for typical albedo, compresses only the highlights.
fn tonemapNeutral(color: vec3<f32>) -> vec3<f32> {
  let startCompression = 0.8 - 0.04;
  let desaturation = 0.15;
  let x = min(color.r, min(color.g, color.b));
  var offset = 0.04;
  if (x < 0.08) { offset = x - 6.25 * x * x; }
  var c = color - vec3<f32>(offset);
  let peak = max(c.r, max(c.g, c.b));
  if (peak < startCompression) { return c; }
  let d = 1.0 - startCompression;
  let newPeak = 1.0 - d * d / (peak + d - startCompression);
  c *= newPeak / peak;
  let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(c, vec3<f32>(newPeak), g);
}

fn tonemap(c: vec3<f32>, id: u32) -> vec3<f32> {
  switch (id) {
    case 1u: { return tonemapReinhard(c); }
    case 2u: { return tonemapACES(c); }
    case 3u: { return clamp(tonemapNeutral(c), vec3<f32>(0.0), vec3<f32>(1.0)); }
    default: { return clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)); }
  }
}

fn hash12(p: vec2<f32>) -> f32 {
  var q = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// ---- composite ------------------------------------------------------------------------------------------------------------------
// b = (exposure, bloom intensity, vignette, saturation), c = (contrast, tone mapper id, bloom on, dither amount), d.x = aspect ratio
@fragment
fn fs_composite(in: VOut) -> @location(0) vec4<f32> {
  var c = textureLoad(texA, vec2<i32>(in.pos.xy), 0).rgb;
  if (P.c.z > 0.5) { c += textureSampleLevel(texB, samp, in.uv, 0.0).rgb * P.b.y; }
  c = tonemap(c * P.b.x, u32(P.c.y));
  var s = linearToSrgb(c);
  // grading in display space
  s = mix(vec3<f32>(dot(s, vec3<f32>(0.299, 0.587, 0.114))), s, P.b.w);
  s = (s - vec3<f32>(0.5)) * P.c.x + vec3<f32>(0.5);
  let d = length((in.uv - vec2<f32>(0.5)) * vec2<f32>(P.d.x, 1.0)) * 1.4142;   // 0 at the centre, ~1 towards the corners
  s *= 1.0 - P.b.z * smoothstep(0.45, 1.05, d);
  s += (hash12(in.pos.xy) - 0.5) * P.c.w;                                       // 1-LSB dither hides banding in dark gradients
  return vec4<f32>(clamp(s, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}

// ---- FXAA (Lottes' compact variant), expects display-referred (sRGB) input --------------------------------------------------------
@fragment
fn fs_fxaa(in: VOut) -> @location(0) vec4<f32> {
  let t = P.a.xy;
  let uv = in.uv;
  let rgbM = src(uv);
  let rgbNW = src(uv + vec2<f32>(-1.0, -1.0) * t);
  let rgbNE = src(uv + vec2<f32>(1.0, -1.0) * t);
  let rgbSW = src(uv + vec2<f32>(-1.0, 1.0) * t);
  let rgbSE = src(uv + vec2<f32>(1.0, 1.0) * t);
  let kl = vec3<f32>(0.299, 0.587, 0.114);
  let lM = dot(rgbM, kl); let lNW = dot(rgbNW, kl); let lNE = dot(rgbNE, kl); let lSW = dot(rgbSW, kl); let lSE = dot(rgbSE, kl);
  let lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  let lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0312, lMax * 0.125)) { return vec4<f32>(rgbM, 1.0); }   // flat area: keep it sharp
  var dir = vec2<f32>(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  let reduce = max((lNW + lNE + lSW + lSE) * (0.25 * (1.0 / 8.0)), 1.0 / 128.0);
  let rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcp, vec2<f32>(-8.0), vec2<f32>(8.0)) * t;
  let rgbA = 0.5 * (src(uv + dir * (1.0 / 3.0 - 0.5)) + src(uv + dir * (2.0 / 3.0 - 0.5)));
  let rgbB = rgbA * 0.5 + 0.25 * (src(uv + dir * -0.5) + src(uv + dir * 0.5));
  let lB = dot(rgbB, kl);
  if (lB < lMin || lB > lMax) { return vec4<f32>(rgbA, 1.0); }
  return vec4<f32>(rgbB, 1.0);
}
