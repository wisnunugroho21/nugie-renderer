// Meshlet culling: one thread per meshlet. A meshlet that survives the frustum and normal-cone tests appends its triangle
// indices to a compacted index buffer; args[0] (the indexCount of a drawIndexedIndirect) counts what was written.

struct Meshlet {
  sphere: vec4<f32>,   // object-space bounding sphere (x, y, z, radius)
  cone: vec4<f32>,     // object-space normal cone: axis xyz, cutoff = sin(spread) (>= 1: never cone-culled)
  range: vec4<u32>,    // x = first index in srcIndices, y = index count
};

struct Params {
  model: mat4x4<f32>,                  // object -> world (rotation + translation + UNIFORM scale)
  planes: array<vec4<f32>, 6>,         // world-space frustum planes, inward normals: inside <=> dot(n, p) + d >= 0
  eye: vec4<f32>,                      // world-space camera position
  counts: vec4<u32>,                   // x = meshlet count
  scale: vec4<f32>,                    // x = the model's uniform scale (radius multiplier)
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> meshlets: array<Meshlet>;
@group(0) @binding(2) var<storage, read> srcIndices: array<u32>;
@group(0) @binding(3) var<storage, read_write> dstIndices: array<u32>;
@group(0) @binding(4) var<storage, read_write> args: array<atomic<u32>, 5>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.counts.x) { return; }
  let m = meshlets[i];
  let center = (params.model * vec4<f32>(m.sphere.xyz, 1.0)).xyz;
  let radius = m.sphere.w * params.scale.x;
  for (var p = 0u; p < 6u; p = p + 1u) {
    let pl = params.planes[p];
    if (dot(pl.xyz, center) + pl.w < -radius) { return; }
  }
  let cutoff = m.cone.w;
  if (cutoff < 1.0) {
    let toMeshlet = center - params.eye.xyz;
    let dist = length(toMeshlet);
    if (dist > radius) {
      let axis = normalize((params.model * vec4<f32>(m.cone.xyz, 0.0)).xyz);
      if (dot(toMeshlet, axis) / dist > cutoff + radius / dist) { return; }
    }
  }
  let n = m.range.y;
  let first = m.range.x;
  let dst = atomicAdd(&args[0], n);
  for (var k = 0u; k < n; k = k + 1u) { dstIndices[dst + k] = srcIndices[first + k]; }
}
