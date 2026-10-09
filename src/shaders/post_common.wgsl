// Shared header of the full-screen post passes: one bind layout (sampler, texA, texB, parameters, texC, texD) and helpers that turn the
// linear-depth texture (texD, r32float, positive view distance, loaded with textureLoad) into view-space positions and normals.
//   P.a .. P.d: pass specific.  P.e = (proj[0][0], proj[1][1], proj[2][2], proj[3][2]), P.f = (1/width, 1/height, width, height)
//#include common_color

struct Params { a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, d: vec4<f32>, e: vec4<f32>, f: vec4<f32> };

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var texA: texture_2d<f32>;
@group(0) @binding(2) var texB: texture_2d<f32>;
@group(0) @binding(3) var<uniform> P: Params;
@group(0) @binding(4) var texC: texture_2d<f32>;
@group(0) @binding(5) var texD: texture_2d<f32>;

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

fn sizePx() -> vec2<i32> { return vec2<i32>(P.f.zw); }

// Linear view distance at pixel `px` (clamped to the screen); the far plane for the sky.
fn linDepth(px: vec2<i32>) -> f32 {
  return textureLoad(texD, clamp(px, vec2<i32>(0), sizePx() - vec2<i32>(1)), 0).r;
}

// View-space position (camera looks down -Z) of pixel `px` at view distance `z`.
fn viewPos(px: vec2<i32>, z: f32) -> vec3<f32> {
  let uv = (vec2<f32>(px) + vec2<f32>(0.5)) * P.f.xy;
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  return vec3<f32>(ndc.x * z / P.e.x, ndc.y * z / P.e.y, -z);
}

// Pixel coordinates of a view-space position.
fn projectPx(v: vec3<f32>) -> vec2<f32> {
  let ndc = vec2<f32>(v.x * P.e.x, v.y * P.e.y) / (-v.z);
  return vec2<f32>((ndc.x * 0.5 + 0.5) * P.f.z, (0.5 - ndc.y * 0.5) * P.f.w);
}

fn octDecode(e: vec2<f32>) -> vec3<f32> {
  var v = vec3<f32>(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  if (v.z < 0.0) {
    let xy = (vec2<f32>(1.0) - abs(v.yx)) * vec2<f32>(select(-1.0, 1.0, v.x >= 0.0), select(-1.0, 1.0, v.y >= 0.0));
    v = vec3<f32>(xy.x, xy.y, v.z);
  }
  return normalize(v);
}

// Normal from depth alone (for pixels the aux pass did not write): the smaller depth step on each axis avoids edge artefacts.
fn reconstructNormal(px: vec2<i32>, z: f32) -> vec3<f32> {
  let p = viewPos(px, z);
  let zl = linDepth(px + vec2<i32>(-1, 0)); let zr = linDepth(px + vec2<i32>(1, 0));
  let zu = linDepth(px + vec2<i32>(0, -1)); let zd = linDepth(px + vec2<i32>(0, 1));
  var dx: vec3<f32>;
  if (abs(zl - z) < abs(zr - z)) { dx = p - viewPos(px + vec2<i32>(-1, 0), zl); } else { dx = viewPos(px + vec2<i32>(1, 0), zr) - p; }
  var dyDown: vec3<f32>;                                                  // tangent along +pixel-y (view-space downwards)
  if (abs(zu - z) < abs(zd - z)) { dyDown = p - viewPos(px + vec2<i32>(0, -1), zu); } else { dyDown = viewPos(px + vec2<i32>(0, 1), zd) - p; }
  var n = normalize(cross(dx, -dyDown));
  if (dot(n, p) > 0.0) { n = -n; }                                        // face the camera
  return n;
}

// View-space normal of the pixel: the aux pass value when it was written (aux.a >= 0.5), else reconstructed from depth.
fn viewNormal(px: vec2<i32>, aux: vec4<f32>, z: f32) -> vec3<f32> {
  if (aux.a >= 0.5) { return octDecode(aux.rg * 2.0 - vec2<f32>(1.0)); }
  return reconstructNormal(px, z);
}

// Interleaved gradient noise in [0, 1).
fn ign(p: vec2<f32>) -> f32 { return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715)))); }
