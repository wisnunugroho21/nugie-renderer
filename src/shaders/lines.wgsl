// Thick anti-aliased lines: one instanced draw, 6 vertices per segment. Each segment is expanded in screen space to a quad of its pixel
// width (segments crossing the near plane are clipped), with colour and width interpolated from end to end.
//   segs[i] = { a: xyz + width (px), b: xyz + width (px), colorA, colorB }
//#include common_types
//#include common_bind_frame
//#include common_color
//#include common_output

struct Seg { a: vec4<f32>, b: vec4<f32>, ca: vec4<f32>, cb: vec4<f32> };
@group(1) @binding(0) var<storage, read> segs: array<Seg>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) across: f32,        // signed pixel distance from the centre line
  @location(2) halfWidth: f32,     // half the requested width in pixels
};

const END = array<u32, 6>(0u, 0u, 1u, 1u, 0u, 1u);
const SIDE = array<f32, 6>(-1.0, 1.0, -1.0, -1.0, 1.0, 1.0);

fn hidden() -> VSOut {
  var o: VSOut;
  o.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  o.color = vec4<f32>(0.0); o.across = 0.0; o.halfWidth = 0.0;
  return o;
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let s = segs[ii];
  let corner = vi % 6u;
  let endIdx = END[corner];
  let side = SIDE[corner];
  var a = frame.viewProjection * vec4<f32>(s.a.xyz, 1.0);
  var b = frame.viewProjection * vec4<f32>(s.b.xyz, 1.0);
  var ca = s.ca; var cb = s.cb; var wa = s.a.w; var wb = s.b.w;
  if (a.z < 0.0 && b.z < 0.0) { return hidden(); }                       // entirely behind the near plane
  if (a.z < 0.0) { let t = a.z / (a.z - b.z); a = mix(a, b, t); ca = mix(ca, cb, t); wa = mix(wa, wb, t); }
  else if (b.z < 0.0) { let t = b.z / (b.z - a.z); b = mix(b, a, t); cb = mix(cb, ca, t); wb = mix(wb, wa, t); }

  let halfVp = 0.5 * frame.viewport.xy;
  let sa = a.xy / a.w * halfVp;
  let sb = b.xy / b.w * halfVp;
  var dir = sb - sa;
  let dl = length(dir);
  dir = select(vec2<f32>(1.0, 0.0), dir / dl, dl > 1e-5);
  let nrm = vec2<f32>(-dir.y, dir.x);
  let w = select(wa, wb, endIdx == 1u);
  let hw = max(w, 1.0) * 0.5;
  let h = hw + 1.0;                                                       // 1 px feather for the anti-aliased edge
  let base = select(a, b, endIdx == 1u);
  let along = (f32(endIdx) * 2.0 - 1.0) * h;                                 // square caps extend past the endIdx points
  let offsetPx = nrm * side * h + dir * along;
  var o: VSOut;
  o.pos = vec4<f32>(base.xy + offsetPx / halfVp * base.w, base.z - 0.0002 * base.w, base.w);   // a hair towards the camera: lines on surfaces stay visible
  o.color = select(ca, cb, endIdx == 1u);
  o.across = side * h;
  o.halfWidth = hw;
  return o;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let coverage = clamp(in.halfWidth + 0.5 - abs(in.across), 0.0, 1.0);
  return vec4<f32>(outputColor(in.color.rgb), in.color.a * coverage);
}
