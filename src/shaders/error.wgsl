// Fallback used when a custom material fails validation/compilation. Unlit magenta.
//#include common

struct ErrorOut { @builtin(position) clip: vec4<f32> };

@vertex
fn vs_main(in: VertexInput) -> ErrorOut {
  var out: ErrorOut;
  out.clip = frame.viewProjection * getModelMatrix(in.instance) * vec4<f32>(in.position, 1.0);
  return out;
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 0.0, 1.0, 1.0);
}
