// Hi-Z level 0: copy the depth buffer into an r32float texture.
@group(0) @binding(0) var depth: texture_depth_2d;
@group(0) @binding(1) var dst: texture_storage_2d<r32float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  textureStore(dst, vec2<i32>(id.xy), vec4<f32>(textureLoad(depth, vec2<i32>(id.xy), 0), 0.0, 0.0, 1.0));
}
