// Environment background: one fullscreen triangle at the far plane, drawn after opaque geometry (depth test <=, no write).
//#include ibl_eval

struct SkyOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) ndc: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> SkyOut {
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: SkyOut;
  o.clip = vec4<f32>(p, 1.0, 1.0);
  o.ndc = p;
  return o;
}

@fragment
fn fs_main(in: SkyOut) -> @location(0) vec4<f32> {
  // View-space ray from the projection scale terms, rotated to world space with the transposed view rotation.
  let v = vec3<f32>(in.ndc.x / frame.projection[0][0], in.ndc.y / frame.projection[1][1], -1.0);
  let r = mat3x3<f32>(frame.view[0].xyz, frame.view[1].xyz, frame.view[2].xyz);
  let world = normalize(transpose(r) * v);
  var c = textureSampleLevel(envSpecular, envSampler, rotateY(world, -scene.env.y), 0.0).rgb * scene.env.x;
  c = applyFog(c, in.clip.xy, scene.fogParams.w);   // sky sits behind the whole fog volume
  return vec4<f32>(linearToSrgb(tonemapACES(c)), 1.0);
}
