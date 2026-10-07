// Equirectangular HDR image -> cube map.
//#include ibl_common
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var outTex: texture_storage_2d_array<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(outTex).x;
  if (id.x >= size || id.y >= size) { return; }
  let d = cubeTexelDir(id.z, id.x, id.y, size);
  let uv = vec2<f32>(atan2(d.z, d.x) / (2.0 * PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI);
  let c = textureSampleLevel(src, smp, uv, 0.0).rgb;
  textureStore(outTex, vec2<i32>(i32(id.x), i32(id.y)), i32(id.z), vec4<f32>(c, 1.0));
}
