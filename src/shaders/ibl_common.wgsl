// Shared helpers for the IBL baking passes (cube-face addressing, Hammersley sequence, GGX importance sampling).
//#include common_color

// Direction through texel (x, y) of a cube face (WebGPU/GL face order +X -X +Y -Y +Z -Z, texel y grows downward).
fn cubeTexelDir(face: u32, x: u32, y: u32, size: u32) -> vec3<f32> {
  let u = 2.0 * (f32(x) + 0.5) / f32(size) - 1.0;
  let v = 2.0 * (f32(y) + 0.5) / f32(size) - 1.0;
  var d: vec3<f32>;
  switch face {
    case 0u: { d = vec3<f32>(1.0, -v, -u); }
    case 1u: { d = vec3<f32>(-1.0, -v, u); }
    case 2u: { d = vec3<f32>(u, 1.0, v); }
    case 3u: { d = vec3<f32>(u, -1.0, -v); }
    case 4u: { d = vec3<f32>(u, -v, 1.0); }
    default: { d = vec3<f32>(-u, -v, -1.0); }
  }
  return normalize(d);
}

fn radicalInverse(i: u32) -> f32 {
  var bits = i;
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return f32(bits) * 2.3283064365386963e-10;
}

fn hammersley(i: u32, n: u32) -> vec2<f32> { return vec2<f32>(f32(i) / f32(n), radicalInverse(i)); }

// GGX-distributed half vector around N (a = perceptual roughness squared).
fn importanceSampleGGX(Xi: vec2<f32>, N: vec3<f32>, a: f32) -> vec3<f32> {
  let phi = 2.0 * PI * Xi.x;
  let cosT = sqrt((1.0 - Xi.y) / (1.0 + (a * a - 1.0) * Xi.y));
  let sinT = sqrt(max(1.0 - cosT * cosT, 0.0));
  let Hl = vec3<f32>(sinT * cos(phi), sinT * sin(phi), cosT);
  var up = vec3<f32>(0.0, 0.0, 1.0);
  if (abs(N.z) > 0.999) { up = vec3<f32>(1.0, 0.0, 0.0); }
  let T = normalize(cross(up, N));
  let B = cross(N, T);
  return normalize(T * Hl.x + B * Hl.y + N * Hl.z);
}
