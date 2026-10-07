// Hi-Z reduction: each texel keeps the FARTHEST (max, standard-Z) depth of the 2x2 (or 3x3 for odd sources) block below it.
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<r32float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let srcSize = vec2<i32>(textureDimensions(src));
  let b = vec2<i32>(id.xy) * 2;
  var d = textureLoad(src, min(b, srcSize - 1), 0).r;
  d = max(d, textureLoad(src, min(b + vec2<i32>(1, 0), srcSize - 1), 0).r);
  d = max(d, textureLoad(src, min(b + vec2<i32>(0, 1), srcSize - 1), 0).r);
  d = max(d, textureLoad(src, min(b + vec2<i32>(1, 1), srcSize - 1), 0).r);
  // odd source size: the last output texel also covers the extra row / column
  let ox = (srcSize.x & 1) == 1 && i32(id.x) == i32(size.x) - 1;
  let oy = (srcSize.y & 1) == 1 && i32(id.y) == i32(size.y) - 1;
  if (ox) { d = max(d, textureLoad(src, min(b + vec2<i32>(2, 0), srcSize - 1), 0).r); d = max(d, textureLoad(src, min(b + vec2<i32>(2, 1), srcSize - 1), 0).r); }
  if (oy) { d = max(d, textureLoad(src, min(b + vec2<i32>(0, 2), srcSize - 1), 0).r); d = max(d, textureLoad(src, min(b + vec2<i32>(1, 2), srcSize - 1), 0).r); }
  if (ox && oy) { d = max(d, textureLoad(src, min(b + vec2<i32>(2, 2), srcSize - 1), 0).r); }
  textureStore(dst, vec2<i32>(id.xy), vec4<f32>(d, 0.0, 0.0, 1.0));
}
