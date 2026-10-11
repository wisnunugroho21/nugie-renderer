// Derives the 24-byte position + normal vertex stream (6 floats) from the standard 48-byte vertex (12 floats).
override SRC_FLOATS: u32 = 12u;
override DST_FLOATS: u32 = 6u;
// Workgroups are laid out in 2D when the vertex count exceeds the 65535-workgroup limit of one dimension: row length in invocations.
const ROW_INVOCATIONS: u32 = 4194240u;   // 65535 workgroups * 64 invocations

@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let vertex = gid.x + gid.y * ROW_INVOCATIONS;
  if (vertex >= arrayLength(&src) / SRC_FLOATS) { return; }
  for (var k = 0u; k < DST_FLOATS; k++) { dst[vertex * DST_FLOATS + k] = src[vertex * SRC_FLOATS + k]; }
}
