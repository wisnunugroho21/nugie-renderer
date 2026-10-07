// Ribbon / trail / chain / flat-streak data (see RibbonSystem.ts).
// All ribbons share ONE segment buffer: ribbon r owns slots [r * N, (r + 1) * N) used as a ring buffer.

struct RibbonDesc {              // 112 bytes (7 x vec4)
  headPos: vec4<f32>,             // xyz = current head position (set by the CPU each frame), w = enabled (1/0)
  colorStart: vec4<f32>,         // color at the head / newest point
  colorEnd: vec4<f32>,           // color at the end of life / oldest point
  widths: vec4<f32>,             // x = width at head, y = width at tail, z = lifetime in seconds (0 = no age fading), w = uv units per meter
  shape: vec4<f32>,              // xyz = fixed plane normal (flat mode), w = mode (0 trail, 1 chain, 2 flat trail)
  state: vec4<u32>,              // x = head slot (newest, LIVE point), y = committed point count, z = capacity N, w = reserved
  params: vec4<f32>,             // x = minimum committed segment length
};

struct Segment {                 // 48 bytes
  position: vec3<f32>,
  birth: f32,                    // time the point was committed (age = now - birth)
  color: vec4<f32>,              // per-point tint (chains), multiplied with the age gradient
  width: f32,                    // per-point width multiplier (chains), 1 for trails
  uvDist: f32,                   // accumulated length along the ribbon (u coordinate)
  _p0: f32,
  _p1: f32,
};

const MODE_TRAIL: u32 = 0u;
const MODE_CHAIN: u32 = 1u;
const MODE_FLAT_TRAIL: u32 = 2u;
