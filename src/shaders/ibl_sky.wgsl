// Procedural HDR sky -> cube map (gradient + sun disc).
//#include ibl_common

struct SkyParams {
  zenith: vec4<f32>,
  horizon: vec4<f32>,
  ground: vec4<f32>,
  sunDir: vec4<f32>,     // xyz = direction TOWARD the sun, w = cos(angular radius)
  sunColor: vec4<f32>,   // rgb = radiance of the disc
};
@group(0) @binding(0) var<uniform> p: SkyParams;
@group(0) @binding(1) var outTex: texture_storage_2d_array<rgba16float, write>;

fn skyColor(d: vec3<f32>) -> vec3<f32> {
  var c: vec3<f32>;
  if (d.y >= 0.0) { c = mix(p.horizon.rgb, p.zenith.rgb, pow(d.y, 0.5)); }
  else { c = mix(p.horizon.rgb, p.ground.rgb, pow(-d.y, 0.5)); }
  let s = dot(d, p.sunDir.xyz);
  if (s > p.sunDir.w) { c = p.sunColor.rgb; }
  return c;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(outTex).x;
  if (id.x >= size || id.y >= size) { return; }
  textureStore(outTex, vec2<i32>(i32(id.x), i32(id.y)), i32(id.z), vec4<f32>(skyColor(cubeTexelDir(id.z, id.x, id.y, size)), 1.0));
}
