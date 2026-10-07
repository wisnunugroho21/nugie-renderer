// Split-sum prefiltered radiance: GGX importance sampling with N = V = R, filtered by the sample pdf (source mip selection).
//#include ibl_common
struct Params { roughness: f32, srcSize: f32, _a: f32, _b: f32 };
@group(0) @binding(0) var src: texture_cube<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var outTex: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: Params;

fn D_GGX_(NoH: f32, a: f32) -> f32 {
  let a2 = a * a; let d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(outTex).x;
  if (id.x >= size || id.y >= size) { return; }
  let N = cubeTexelDir(id.z, id.x, id.y, size);
  let V = N;
  let a = params.roughness * params.roughness;
  let saTexel = 4.0 * PI / (6.0 * params.srcSize * params.srcSize);
  var sum = vec3<f32>(0.0);
  var wsum = 0.0;
  let count = 192u;
  for (var i = 0u; i < count; i = i + 1u) {
    let H = importanceSampleGGX(hammersley(i, count), N, max(a, 1e-3));
    let L = normalize(2.0 * dot(V, H) * H - V);
    let NoL = dot(N, L);
    if (NoL > 0.0) {
      var lod = 0.0;
      if (params.roughness > 0.0) {
        let NoH = max(dot(N, H), 0.0); let VoH = max(dot(V, H), 1e-4);
        let pdf = D_GGX_(NoH, a) * NoH / (4.0 * VoH) + 1e-4;
        lod = max(0.5 * log2(1.0 / (f32(count) * pdf * saTexel)) + 1.0, 0.0);
      }
      sum += textureSampleLevel(src, smp, L, lod).rgb * NoL;
      wsum += NoL;
    }
  }
  textureStore(outTex, vec2<i32>(i32(id.x), i32(id.y)), i32(id.z), vec4<f32>(sum / max(wsum, 1e-4), 1.0));
}
