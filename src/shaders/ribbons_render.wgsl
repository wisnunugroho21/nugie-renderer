// Ribbon rendering: ONE draw call for every ribbon of the system: draw(6 * (N - 1), ribbonCount).
// Instance = ribbon, vertex_index / 6 = segment (newest first), vertex_index % 6 = corner. Geometry is built here;
// nothing is generated per segment on the CPU and there is no draw call per segment.
//
//#include common_types
//#include common_bind_frame
//#include common_color
//#include common_output
//#include ribbons_common

@group(1) @binding(0) var<storage, read> ribbons: array<RibbonDesc>;
@group(1) @binding(1) var<storage, read> segments: array<Segment>;
@group(1) @binding(2) var ribbonSampler: sampler;
@group(1) @binding(3) var ribbonTexture: texture_2d<f32>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
};

// corner table: (end 0/1 of the segment, side -1/+1)
const END = array<u32, 6>(0u, 0u, 1u, 1u, 0u, 1u);
const SIDE = array<f32, 6>(-1.0, 1.0, -1.0, -1.0, 1.0, 1.0);

fn hidden() -> VSOut {
  var o: VSOut;
  o.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);   // outside the view volume; all vertices coincide => degenerate triangles
  o.uv = vec2<f32>(0.0);
  o.color = vec4<f32>(0.0);
  return o;
}

// position of the k-th newest point of ribbon r (k = 0 is the live head point)
fn pointAt(base: u32, head: u32, N: u32, k: u32) -> Segment {
  return segments[base + (head + N - k) % N];
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) r: u32) -> VSOut {
  let d = ribbons[r];
  let N = d.state.z;
  let count = d.state.y;
  let seg = vi / 6u;
  let corner = vi % 6u;
  if (d.headPos.w < 0.5 && u32(d.shape.w + 0.5) != MODE_CHAIN) { return hidden(); }
  if (seg + 1u >= count) { return hidden(); }

  let base = r * N;
  let head = d.state.x;
  let k = seg + END[corner];                 // which point this vertex belongs to
  let cur = pointAt(base, head, N, k);
  let mode = u32(d.shape.w + 0.5);

  // age and lifetime fade (the live head point is always age 0)
  var age = 0.0;
  if (k > 0u && mode != MODE_CHAIN) { age = frame.cameraPosition.w - cur.birth; }
  let life = d.widths.z;
  let t = select(0.0, clamp(age / life, 0.0, 1.0), life > 0.0);
  if (life > 0.0 && age > life) { return hidden(); }

  // smooth tangent from the neighbours (previous = newer, next = older)
  let newer = pointAt(base, head, N, select(k, k - 1u, k > 0u)).position;
  let older = pointAt(base, head, N, select(k, k + 1u, k + 1u < count)).position;
  var tangent = newer - older;
  if (dot(tangent, tangent) < 1e-10) { return hidden(); }
  tangent = normalize(tangent);

  var side: vec3<f32>;
  if (mode == MODE_FLAT_TRAIL) {
    side = cross(tangent, normalize(d.shape.xyz));
  } else {
    side = cross(tangent, normalize(cur.position - frame.cameraPosition.xyz));
  }
  if (dot(side, side) < 1e-10) { return hidden(); }
  side = normalize(side);

  // width: along the ribbon (head -> tail taper) combined with age and per-point multiplier
  let along = f32(k) / f32(max(count - 1u, 1u));
  let width = mix(d.widths.x, d.widths.y, select(along, t, life > 0.0)) * cur.width;
  let world = cur.position + side * (SIDE[corner] * width * 0.5);

  var out: VSOut;
  out.pos = frame.viewProjection * vec4<f32>(world, 1.0);
  out.uv = vec2<f32>(cur.uvDist * d.widths.w, SIDE[corner] * 0.5 + 0.5);
  out.color = mix(d.colorStart, d.colorEnd, select(along, t, life > 0.0)) * cur.color;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let texel = textureSample(ribbonTexture, ribbonSampler, in.uv);
  let c = texel * in.color;
  if (c.a < 0.004) { discard; }
  return vec4<f32>(outputColor(c.rgb), c.a);
}
