// Diffuse irradiance convolution. Output = E / PI (so shading is simply  irradiance * albedo).
//#include ibl_common
@group(0) @binding(0) var src: texture_cube<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var outTex: texture_storage_2d_array<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(outTex).x;
  if (id.x >= size || id.y >= size) { return; }
  let N = cubeTexelDir(id.z, id.x, id.y, size);
  var up = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(N.y) > 0.999) { up = vec3<f32>(1.0, 0.0, 0.0); }
  let T = normalize(cross(up, N));
  let B = cross(N, T);
  let srcSize = f32(textureDimensions(src).x);
  let lod = max(log2(srcSize / 32.0), 0.0);   // read a ~32px mip: the integral is low-frequency
  var sum = vec3<f32>(0.0);
  let nPhi = 64u; let nTheta = 24u;
  for (var i = 0u; i < nPhi; i = i + 1u) {
    let phi = 2.0 * PI * (f32(i) + 0.5) / f32(nPhi);
    for (var j = 0u; j < nTheta; j = j + 1u) {
      let theta = 0.5 * PI * (f32(j) + 0.5) / f32(nTheta);
      let s = vec3<f32>(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta));
      let d = T * s.x + B * s.y + N * s.z;
      sum += textureSampleLevel(src, smp, d, lod).rgb * cos(theta) * sin(theta);
    }
  }
  // E = sum * dTheta * dPhi with dTheta * dPhi = (PI/2 / nTheta) * (2 PI / nPhi);  so  E / PI = sum * PI / (nTheta * nPhi)
  let e = sum * PI / f32(nPhi * nTheta);
  textureStore(outTex, vec2<i32>(i32(id.x), i32(id.y)), i32(id.z), vec4<f32>(e, 1.0));
}
