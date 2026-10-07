// Clustered forward shading, light assignment: one thread per cluster tests every RANGED light (bounding sphere) against the
// cluster's view-space AABB and appends the light index to that cluster's list. Directional / area / unlimited-range lights
// are the "global" prefix of the light buffer and are evaluated by every fragment, so they never appear in the lists.
//#include common_types

struct ClusterParams {
  view: mat4x4<f32>,
  dims: vec4<u32>,        // xyz = cluster counts, w = tile size in pixels
  screen: vec4<f32>,      // x = width, y = height, z = near, w = far
  proj: vec4<f32>,        // x = projection[0][0], y = projection[1][1]
  counts: vec4<u32>,      // x = total lights, y = global (always evaluated) lights, z = max lights per cluster
};

@group(0) @binding(0) var<uniform> params: ClusterParams;
@group(0) @binding(1) var<storage, read> lights: array<Light>;
@group(0) @binding(2) var<storage, read_write> clusterGrid: array<vec2<u32>>;
@group(0) @binding(3) var<storage, read_write> clusterIndices: array<u32>;
@group(0) @binding(4) var<storage, read_write> overflow: atomic<u32>;   // lights dropped because a cluster list was full

// View-space point on the ray through pixel (px, py) at view depth z (z < 0).
fn rayAtDepth(px: f32, py: f32, z: f32) -> vec3<f32> {
  let nx = 2.0 * px / params.screen.x - 1.0;
  let ny = 1.0 - 2.0 * py / params.screen.y;
  return vec3<f32>(nx / params.proj.x * -z, ny / params.proj.y * -z, z);
}

fn sphereIntersectsAabb(c: vec3<f32>, r: f32, lo: vec3<f32>, hi: vec3<f32>) -> bool {
  let d = max(lo - c, vec3<f32>(0.0)) + max(c - hi, vec3<f32>(0.0));
  return dot(d, d) <= r * r;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = params.dims.xyz;
  let total = dims.x * dims.y * dims.z;
  let cid = id.x;
  if (cid >= total) { return; }
  let tx = cid % dims.x;
  let ty = (cid / dims.x) % dims.y;
  let tz = cid / (dims.x * dims.y);
  let near = params.screen.z; let far = params.screen.w;
  let ratio = far / near;
  let zNear = -near * pow(ratio, f32(tz) / f32(dims.z));
  let zFar = -near * pow(ratio, f32(tz + 1u) / f32(dims.z));
  let tile = f32(params.dims.w);
  let x0 = f32(tx) * tile; let x1 = x0 + tile;
  let y0 = f32(ty) * tile; let y1 = y0 + tile;
  var lo = vec3<f32>(1e30); var hi = vec3<f32>(-1e30);
  for (var k = 0u; k < 8u; k = k + 1u) {
    let p = rayAtDepth(select(x0, x1, (k & 1u) != 0u), select(y0, y1, (k & 2u) != 0u), select(zNear, zFar, (k & 4u) != 0u));
    lo = min(lo, p); hi = max(hi, p);
  }
  let maxPer = params.counts.z;
  let base = cid * maxPer;
  var count = 0u;
  for (var i = params.counts.y; i < params.counts.x; i = i + 1u) {
    let l = lights[i];
    var center = (params.view * vec4<f32>(l.positionRange.xyz, 1.0)).xyz;
    var radius = l.positionRange.w;
    if (u32(l.directionType.w + 0.5) == LIGHT_SPOT) {
      // bounding sphere of the cone (apex at the light, axis = direction, slant length = range)
      let cosO = clamp(l.spot.x, 0.0, 1.0);
      let axis = (params.view * vec4<f32>(l.directionType.xyz, 0.0)).xyz;
      if (cosO < 0.7071) {
        center = center + axis * (radius * cosO);
        radius = radius * sqrt(1.0 - cosO * cosO);
      } else {
        let r2 = radius / (2.0 * cosO);
        center = center + axis * r2;
        radius = r2;
      }
    }
    if (sphereIntersectsAabb(center, radius, lo, hi)) {
      if (count < maxPer) { clusterIndices[base + count] = i; count = count + 1u; }
      else { atomicAdd(&overflow, 1u); }
    }
  }
  clusterGrid[cid] = vec2<u32>(base, count);
}
