// Depth buffer -> linear view distance (r32float), so SSAO / SSR can use plain loads regardless of MSAA.
// fs_depth reads a single-sample depth texture, fs_depth_ms sample 0 of a multisampled one. Q = (proj[2][2], proj[3][2]).
@group(0) @binding(0) var depthTex: texture_depth_2d;
@group(0) @binding(1) var depthTexMs: texture_depth_multisampled_2d;
@group(0) @binding(2) var<uniform> Q: vec4<f32>;

struct VOut { @builtin(position) pos: vec4<f32> };

@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> VOut {
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VOut;
  o.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

// Standard-Z perspective: view distance = proj[3][2] / (depth + proj[2][2]) (near at depth 0, far at depth 1).
fn linearize(d: f32) -> f32 { return Q.y / (d + Q.x); }

@fragment
fn fs_depth(in: VOut) -> @location(0) vec4<f32> {
  return vec4<f32>(linearize(textureLoad(depthTex, vec2<i32>(in.pos.xy), 0)), 0.0, 0.0, 1.0);
}

@fragment
fn fs_depth_ms(in: VOut) -> @location(0) vec4<f32> {
  return vec4<f32>(linearize(textureLoad(depthTexMs, vec2<i32>(in.pos.xy), 0)), 0.0, 0.0, 1.0);
}
