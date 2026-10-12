// Depth buffer -> linear view distance (r32float), so SSAO / SSR can use plain loads regardless of MSAA.
// The technique binds the depth buffer as depthTex (texture_depth_2d, or texture_depth_multisampled_2d: sample 0 is read either way).
// The `depthQ` variable holds (proj[2][2], proj[3][2]).

struct VOut { @builtin(position) pos: vec4<f32> };

@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> VOut {
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VOut;
  o.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

// Standard-Z perspective: view distance = proj[3][2] / (depth + proj[2][2]) (near at depth 0, far at depth 1).
fn linearize(d: f32) -> f32 { let q = /*$(Variable:depthQ)*/; return q.y / (d + q.x); }

@fragment
fn fs_depth(in: VOut) -> @location(0) vec4<f32> {
  return vec4<f32>(linearize(textureLoad(depthTex, vec2<i32>(in.pos.xy), 0)), 0.0, 0.0, 1.0);
}
