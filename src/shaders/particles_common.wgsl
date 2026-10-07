// Shared particle data structures (simulation + rendering). All buffers are shared by every particle of a pool:
// no JavaScript object or GPU resource ever exists per live particle.

struct Particle {            // 64 bytes
  position: vec3<f32>,       // world space, or emitter-local space when the emitter simulates in local space
  age: f32,
  velocity: vec3<f32>,
  lifetime: f32,
  color: vec4<f32>,          // spawn-time tint (multiplied with the emitter's start->end color over life)
  size: f32,                 // start size
  rotation: f32,
  angularVelocity: f32,
  emitterId: u32,
};

struct Emitter {             // 240 bytes (60 floats)
  world: mat4x4<f32>,
  shapeParams: vec4<f32>,    // box: half extents xyz | sphere: x = radius, y = 1 -> surface only | cone: x = base radius, w = half angle
  velMin: vec4<f32>,         // xyz = min velocity, w = min radial speed
  velMax: vec4<f32>,         // xyz = max velocity, w = max radial speed
  accelDrag: vec4<f32>,      // xyz = acceleration, w = drag
  lifeSize: vec4<f32>,       // lifeMin, lifeMax, sizeMin, sizeMax
  rotation: vec4<f32>,       // rotMin, rotMax, angVelMin, angVelMax
  colorStart: vec4<f32>,
  colorEnd: vec4<f32>,
  misc: vec4<f32>,           // x = end size scale, y = direction mode (0 none, 1 outward, 2 cone axis), z = shape (0 point, 1 box, 2 sphere, 3 cone), w = simulation space (0 world, 1 local)
  flipbook: vec4<f32>,       // x = columns, y = rows, z = frame count, w = frames per second (0 = spread over lifetime)
  seed: vec4<u32>,           // x = emitter seed
};

const SHAPE_POINT: u32 = 0u;
const SHAPE_BOX: u32 = 1u;
const SHAPE_SPHERE: u32 = 2u;
const SHAPE_CONE: u32 = 3u;

// PCG hash (O'Neill) - deterministic per (seed, frame, index)
fn pcgHash(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn nextRand(state: ptr<function, u32>) -> f32 {
  *state = pcgHash(*state);
  return f32(*state >> 8u) * (1.0 / 16777216.0);
}
