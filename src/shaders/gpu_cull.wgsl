// GPU-driven culling + compaction. One thread per instance: frustum test (bounding sphere), optional Hi-Z occlusion test,
// then survivors are appended to their batch's segment of the compacted instance buffer and the batch's indirect draw
// argument instanceCount is bumped atomically. The CPU only writes the static draw arguments (instanceCount = 0).

struct CullParams {
  planes: array<vec4<f32>, 6>,
  viewProj: mat4x4<f32>,
  counts: vec4<u32>,     // x = instance count, y = batch count, z = source base (instance index), w = Hi-Z enabled
  bases: vec4<u32>,      // x = sphere base (vec4 index), y = phase (0 single, 1 = A: previously visible, 2 = B: the rest), z = first virtual draw of this phase's args, w = dst instance base
  hiz: vec4<f32>,        // x = width, y = height, z = mip count, w = LOD bias
  cam: vec4<f32>,        // xyz = camera position, w = tan(fovY / 2)
};

@group(0) @binding(0) var<uniform> p: CullParams;
@group(0) @binding(1) var<storage, read> src: array<u32>;                 // 12 words per instance
@group(0) @binding(2) var<storage, read_write> dst: array<u32>;
@group(0) @binding(3) var<storage, read> spheres: array<vec4<f32>>;       // world-space bounding sphere per instance
@group(0) @binding(4) var<storage, read> batchFirst: array<u32>;          // first instance of each batch; [batchCount] = total
@group(0) @binding(5) var<storage, read_write> args: array<atomic<u32>>;  // 5 words per batch (drawIndexedIndirect)
@group(0) @binding(6) var hizTex: texture_2d<f32>;
@group(0) @binding(7) var<storage, read_write> visBits: array<u32>;       // per object: drawn last frame (two-phase occlusion culling)
@group(0) @binding(8) var<storage, read> batchInfo: array<vec4<u32>>;     // per batch: x = LOD levels, y = first virtual draw, z = dst offset, w = cull below last level
@group(0) @binding(9) var<storage, read> lodThresholds: array<f32>;       // per virtual draw: minScreenSize of its level

const INSTANCE_WORDS: u32 = 12u;

fn frustumVisible(c: vec3<f32>, r: f32) -> bool {
  for (var i = 0u; i < 6u; i = i + 1u) {
    let pl = p.planes[i];
    if (dot(pl.xyz, c) + pl.w < -r) { return false; }
  }
  return true;
}

// true when the sphere is certainly hidden behind the depth pyramid
fn occluded(c: vec3<f32>, r: f32) -> bool {
  var mn = vec3<f32>(1e30);
  var mx = vec3<f32>(-1e30);
  for (var k = 0u; k < 8u; k = k + 1u) {
    let o = vec3<f32>(select(-r, r, (k & 1u) != 0u), select(-r, r, (k & 2u) != 0u), select(-r, r, (k & 4u) != 0u));
    let clip = p.viewProj * vec4<f32>(c + o, 1.0);
    if (clip.w <= 1e-4) { return false; }          // crosses the camera plane: cannot judge
    let ndc = clip.xyz / clip.w;
    mn = min(mn, ndc); mx = max(mx, ndc);
  }
  let uvMin = clamp(vec2<f32>(mn.x * 0.5 + 0.5, 0.5 - mx.y * 0.5), vec2<f32>(0.0), vec2<f32>(1.0));
  let uvMax = clamp(vec2<f32>(mx.x * 0.5 + 0.5, 0.5 - mn.y * 0.5), vec2<f32>(0.0), vec2<f32>(1.0));
  let sizePx = (uvMax - uvMin) * p.hiz.xy;
  let level = clamp(i32(ceil(log2(max(max(sizePx.x, sizePx.y), 1.0)))), 0, i32(p.hiz.z) - 1);
  let dims = vec2<i32>(textureDimensions(hizTex, level));
  let a = clamp(vec2<i32>(uvMin * vec2<f32>(dims)), vec2<i32>(0), dims - 1);
  let b = clamp(vec2<i32>(uvMax * vec2<f32>(dims)), vec2<i32>(0), dims - 1);
  var farthest = textureLoad(hizTex, a, level).r;
  farthest = max(farthest, textureLoad(hizTex, vec2<i32>(b.x, a.y), level).r);
  farthest = max(farthest, textureLoad(hizTex, vec2<i32>(a.x, b.y), level).r);
  farthest = max(farthest, textureLoad(hizTex, b, level).r);
  return clamp(mn.z, 0.0, 1.0) > farthest + 1e-5;
}

// batch containing instance i: last b with batchFirst[b] <= i
fn findBatch(i: u32) -> u32 {
  var lo = 0u;
  var hi = p.counts.y;
  while (hi - lo > 1u) {
    let mid = (lo + hi) / 2u;
    if (batchFirst[mid] <= i) { lo = mid; } else { hi = mid; }
  }
  return lo;
}

// LOD level from the projected size (CPU reference: selectLevel without history). Returns `levels` when the object is culled.
fn selectLod(info: vec4<u32>, s: vec4<f32>) -> u32 {
  if (info.x <= 1u) { return 0u; }
  let dist = distance(s.xyz, p.cam.xyz);
  var size = 1e30;
  if (dist > s.w) { size = s.w / (dist * p.cam.w); }
  size = size * p.hiz.w;
  for (var l = 0u; l < info.x; l = l + 1u) {
    if (size >= lodThresholds[info.y + l]) { return l; }
  }
  return select(info.x - 1u, info.x, info.w == 1u);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= p.counts.x) { return; }
  let s = spheres[p.bases.x + i];
  let sOff = (p.counts.z + i) * INSTANCE_WORDS;
  let phase = p.bases.y;
  let b = findBatch(i);
  let info = batchInfo[b];
  let level = selectLod(info, s);
  let inFrustum = level < info.x && frustumVisible(s.xyz, s.w);
  if (phase == 0u) {
    if (!inFrustum) { return; }
    if (p.counts.w == 1u && occluded(s.xyz, s.w)) { return; }
  } else {
    let obj = src[sOff + 6u];
    let was = visBits[obj] == 1u;
    if (phase == 1u) {
      // A: only what was visible last frame (they build the depth buffer the pyramid is made from)
      if (!inFrustum || !was) { return; }
    } else {
      // B: re-test everything against the new pyramid; draw what was NOT drawn in A and is now visible
      if (!inFrustum) { visBits[obj] = 0u; return; }
      let occ = occluded(s.xyz, s.w);
      if (was) { if (occ) { visBits[obj] = 0u; } return; }
      if (occ) { return; }
      visBits[obj] = 1u;
    }
  }
  let count = batchFirst[b + 1u] - batchFirst[b];
  let slot = atomicAdd(&args[(p.bases.z + info.y + level) * 5u + 1u], 1u);
  let d = (p.bases.w + info.z + level * count + slot) * INSTANCE_WORDS;
  for (var k = 0u; k < INSTANCE_WORDS; k = k + 1u) { dst[d + k] = src[sOff + k]; }
}
