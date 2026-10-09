// Thick anti-aliased lines: one instanced draw, 6 vertices per segment. Each segment is expanded in screen space to a quad of its pixel
// (or world-unit) width, segments crossing the near plane are clipped, and colour / width / dash distance interpolate end to end.
//   segs[i] = { a: xyz + width, b: xyz + width, colorA, colorB, dist: (distance along the polyline at a, at b, 0, 0) }
//   params0 = (dash length, gap length, dash offset (all in world units; dash <= 0: solid), cap: 0 butt / 1 square / 2 round)
//   params1 = (width unit: 0 pixels / 1 world units, 0, 0, 0)
//#include common_types
//#include common_bind_frame
//#include common_color
//#include common_output

struct Seg { a: vec4<f32>, b: vec4<f32>, ca: vec4<f32>, cb: vec4<f32>, dist: vec4<f32> };
@group(1) @binding(0) var<storage, read> segs: array<Seg>;
@group(1) @binding(1) var<uniform> params0: vec4<f32>;
@group(1) @binding(2) var<uniform> params1: vec4<f32>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) @interpolate(linear) across: f32,       // signed pixel distance from the centre line
  @location(2) @interpolate(linear) along: f32,        // pixel distance from the segment start (negative before it)
  @location(3) halfWidth: f32,                         // half the requested width in pixels
  @location(4) @interpolate(flat) segLen: f32,         // screen length of the (clipped) segment in pixels
  @location(5) @interpolate(linear) dashDist: f32,     // distance along the polyline in world units
};

const ENDS = array<u32, 6>(0u, 0u, 1u, 1u, 0u, 1u);
const SIDES = array<f32, 6>(-1.0, 1.0, -1.0, -1.0, 1.0, 1.0);

fn hidden() -> VSOut {
  var o: VSOut;
  o.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
  o.color = vec4<f32>(0.0); o.across = 0.0; o.along = 0.0; o.halfWidth = 0.0; o.segLen = 0.0; o.dashDist = 0.0;
  return o;
}

// Width in pixels of a world-unit width at clip position c.
fn worldWidthToPx(w: f32, c: vec4<f32>) -> f32 { return w * frame.projection[1][1] * frame.viewport.y * 0.5 / max(c.w, 1e-4); }

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let s = segs[ii];
  let corner = vi % 6u;
  let endIdx = ENDS[corner];
  let side = SIDES[corner];
  var a = frame.viewProjection * vec4<f32>(s.a.xyz, 1.0);
  var b = frame.viewProjection * vec4<f32>(s.b.xyz, 1.0);
  var ca = s.ca; var cb = s.cb; var wa = s.a.w; var wb = s.b.w; var da = s.dist.x; var db = s.dist.y;
  if (a.z < 0.0 && b.z < 0.0) { return hidden(); }                       // entirely behind the near plane
  if (a.z < 0.0) { let t = a.z / (a.z - b.z); a = mix(a, b, t); ca = mix(ca, cb, t); wa = mix(wa, wb, t); da = mix(da, db, t); }
  else if (b.z < 0.0) { let t = b.z / (b.z - a.z); b = mix(b, a, t); cb = mix(cb, ca, t); wb = mix(wb, wa, t); db = mix(db, da, t); }
  if (params1.x > 0.5) { wa = worldWidthToPx(wa, a); wb = worldWidthToPx(wb, b); }

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
  let capped = params0.w > 0.5;                                           // butt caps do not extend past the end points
  let ext = select(0.0, h, capped);
  let alongOff = (f32(endIdx) * 2.0 - 1.0) * ext;
  let offsetPx = nrm * side * h + dir * alongOff;
  var o: VSOut;
  o.pos = vec4<f32>(base.xy + offsetPx / halfVp * base.w, base.z - 0.0002 * base.w, base.w);   // a hair towards the camera: lines on surfaces stay visible
  o.color = select(ca, cb, endIdx == 1u);
  o.across = side * h;
  o.along = select(0.0, dl, endIdx == 1u) + alongOff;
  o.halfWidth = hw;
  o.segLen = dl;
  o.dashDist = select(da, db, endIdx == 1u);
  return o;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var coverage = clamp(in.halfWidth + 0.5 - abs(in.across), 0.0, 1.0);
  if (params0.w > 1.5) {                                                   // round caps: distance to the end point beyond the body
    let beyond = max(max(-in.along, in.along - in.segLen), 0.0);
    coverage = clamp(in.halfWidth + 0.5 - length(vec2<f32>(in.across, beyond)), 0.0, 1.0);
  }
  if (params0.x > 0.0) {                                                   // dashes: visible for `dash`, hidden for `gap`, repeating along the polyline
    let period = params0.x + max(params0.y, 0.0);
    let t = (in.dashDist + params0.z) - floor((in.dashDist + params0.z) / period) * period;
    let soft = max(fwidth(in.dashDist), 1e-5);
    coverage = coverage * clamp((params0.x - t) / soft + 0.5, 0.0, 1.0) * clamp(t / soft + 0.5, 0.0, 1.0);
  }
  if (coverage <= 0.0) { discard; }
  return vec4<f32>(outputColor(in.color.rgb), in.color.a * coverage);
}
