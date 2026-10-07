// 2x2 box downsample of one cube mip level into the next (faces are 2d-array layers).
@group(0) @binding(0) var src: texture_2d_array<f32>;
@group(0) @binding(1) var dst: texture_storage_2d_array<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(dst).x;
  if (id.x >= size || id.y >= size) { return; }
  let b = vec2<i32>(i32(id.x) * 2, i32(id.y) * 2);
  let l = i32(id.z);
  let c = (textureLoad(src, b, l, 0) + textureLoad(src, b + vec2<i32>(1, 0), l, 0) + textureLoad(src, b + vec2<i32>(0, 1), l, 0) + textureLoad(src, b + vec2<i32>(1, 1), l, 0)) * 0.25;
  textureStore(dst, vec2<i32>(i32(id.x), i32(id.y)), l, c);
}
