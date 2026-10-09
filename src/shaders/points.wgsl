// Point sprites: one instanced draw, 6 vertices per point, squares or anti-aliased discs of a size in pixels or world units.
//   pts[i] = { xyz + size, color };  params = (size mode: 0 pixels / 1 world units, shape: 0 square / 1 disc, min size px, max size px (0 = none))
//#include common_types
//#include common_bind_frame
//#include common_color
//#include common_output

struct Pt { p: vec4<f32>, c: vec4<f32> };
@group(1) @binding(0) var<storage, read> pts: array<Pt>;
@group(1) @binding(1) var<uniform> params: vec4<f32>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) quadPos: vec2<f32>,    // -1..1 across the quad
  @location(2) sizePx: f32,
};

const CORNER = array<vec2<f32>, 6>(vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0), vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0));

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let pt = pts[ii];
  let c = CORNER[vi % 6u];
  let clip = frame.viewProjection * vec4<f32>(pt.p.xyz, 1.0);
  var o: VSOut;
  if (clip.z < 0.0 || clip.w <= 0.0) { o.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0); o.color = vec4<f32>(0.0); o.quadPos = vec2<f32>(0.0); o.sizePx = 0.0; return o; }
  // world sizes become pixels through the projection: size * (focal length in pixels) / distance
  var sizePx = pt.p.w;
  if (params.x > 0.5) { sizePx = pt.p.w * frame.projection[1][1] * frame.viewport.y * 0.5 / clip.w; }
  sizePx = max(sizePx, params.z);
  if (params.w > 0.0) { sizePx = min(sizePx, params.w); }
  let h = sizePx * 0.5 + 1.0;                                             // + feather
  o.pos = vec4<f32>(clip.xy + c * h / (0.5 * frame.viewport.xy) * clip.w, clip.z - 0.0002 * clip.w, clip.w);
  o.color = pt.c;
  o.quadPos = c * h;
  o.sizePx = sizePx;
  return o;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let halfSize = in.sizePx * 0.5;
  var coverage = 1.0;
  if (params.y > 0.5) { coverage = clamp(halfSize + 0.5 - length(in.quadPos), 0.0, 1.0); }
  else { coverage = clamp(halfSize + 0.5 - max(abs(in.quadPos.x), abs(in.quadPos.y)), 0.0, 1.0); }
  if (coverage <= 0.0) { discard; }
  return vec4<f32>(outputColor(in.color.rgb), in.color.a * coverage);
}
