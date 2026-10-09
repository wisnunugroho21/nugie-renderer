// Final colour encoding of a lit fragment. Engine shaders and custom materials end with `outputColor(linearHdrColor)`:
//  - direct rendering (post-processing off): tone map (ACES) + sRGB encode, written to the swap chain;
//  - post-processing on (frame.postFlags.x = 1): the scene target is linear HDR (rgba16float); the composite pass tone maps instead.
//#include common_types
//#include common_bind_frame
//#include common_color

fn outputColor(c: vec3<f32>) -> vec3<f32> {
  if (frame.postFlags.x > 0.5) { return c; }
  return linearToSrgb(tonemapACES(c));
}
