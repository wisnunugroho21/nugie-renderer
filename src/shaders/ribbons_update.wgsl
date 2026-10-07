// Trail history update: one thread per ribbon.
//
// Ring buffer semantics (per ribbon, N slots):
//   slot `head`          = the LIVE point: follows the head position every frame (smooth, no staircase)
//   slots head-1, head-2 = committed (frozen) points, newest first; `count` points are valid in total
//   a point's age = now - birth, where birth = the time it was COMMITTED (frozen)
// When the live point is >= minSegment away from the newest committed point, it is committed and a fresh live
// point opens at the same place. Chains (mode 1) are written directly by the CPU and skipped here.
//
//#include ribbons_common

struct UpdateParams {
  time: f32,
  ribbonCount: u32,
  _p0: u32,
  _p1: u32,
};

@group(0) @binding(0) var<uniform> up: UpdateParams;
@group(0) @binding(1) var<storage, read_write> ribbons: array<RibbonDesc>;
@group(0) @binding(2) var<storage, read_write> segments: array<Segment>;

@compute @workgroup_size(64)
fn update_trails(@builtin(global_invocation_id) gid: vec3<u32>) {
  let r = gid.x;
  if (r >= up.ribbonCount) { return; }
  var d = ribbons[r];
  let mode = u32(d.shape.w + 0.5);
  if (mode == MODE_CHAIN || d.headPos.w < 0.5) { return; }

  let N = d.state.z;
  let base = r * N;
  let p = d.headPos.xyz;
  var head = d.state.x;
  var count = d.state.y;

  if (count == 0u) {
    // first point: it is the only (live) point until the head moves
    segments[base] = Segment(p, up.time, vec4<f32>(1.0), 1.0, 0.0, 0.0, 0.0);
    d.state.x = 0u; d.state.y = 1u;
    ribbons[r] = d;
    return;
  }

  var live = segments[base + head];
  if (count == 1u) {
    // freeze the start point and open the live point at the head position
    live.birth = up.time;
    segments[base + head] = live;
    var next = live;
    next.position = p;
    next.uvDist = distance(live.position, p);
    head = (head + 1u) % N;
    segments[base + head] = next;
    count = 2u;
  } else {
    let prev = segments[base + (head + N - 1u) % N];
    let len = distance(prev.position, p);
    live.position = p;
    live.uvDist = prev.uvDist + len;
    if (len >= d.params.x) {
      // commit the live point (freeze, age starts now) and open a new live point at the same place
      live.birth = up.time;
      segments[base + head] = live;
      head = (head + 1u) % N;
      segments[base + head] = live;
      count = min(count + 1u, N);
    } else {
      segments[base + head] = live;
    }
  }

  d.state.x = head; d.state.y = count;
  ribbons[r] = d;
}
