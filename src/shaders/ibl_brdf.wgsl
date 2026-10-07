// Split-sum BRDF integration LUT: x = NoV, y = perceptual roughness; stores (scale, bias) applied to F0.
//#include ibl_common
@group(0) @binding(0) var outTex: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(outTex);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let NoV = max((f32(id.x) + 0.5) / f32(size.x), 1e-3);
  let rough = (f32(id.y) + 0.5) / f32(size.y);
  let a = rough * rough;
  let V = vec3<f32>(sqrt(1.0 - NoV * NoV), 0.0, NoV);
  let N = vec3<f32>(0.0, 0.0, 1.0);
  var A = 0.0; var B = 0.0;
  let count = 256u;
  for (var i = 0u; i < count; i = i + 1u) {
    let H = importanceSampleGGX(hammersley(i, count), N, a);
    let L = normalize(2.0 * dot(V, H) * H - V);
    let NoL = clamp(L.z, 0.0, 1.0); let NoH = clamp(H.z, 0.0, 1.0); let VoH = clamp(dot(V, H), 0.0, 1.0);
    if (NoL > 0.0) {
      // Same height-correlated Smith visibility as the direct lighting (V = G / (4 NoL NoV)), so IBL and lights agree.
      let a2 = a * a;
      let gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2); let gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
      let Gvis = 4.0 * NoL * VoH / (NoH) * (0.5 / max(gv + gl, 1e-5));
      let Fc = pow(1.0 - VoH, 5.0);
      A += (1.0 - Fc) * Gvis; B += Fc * Gvis;
    }
  }
  textureStore(outTex, vec2<i32>(i32(id.x), i32(id.y)), vec4<f32>(A / f32(count), B / f32(count), 0.0, 1.0));
}
