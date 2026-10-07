// GPU particle simulation. One module, four kernels run in this order each frame (see ParticleSystem.ts):
//   reset     : zero the NEXT alive list's counter
//   simulate  : integrate particles of the CURRENT alive list; survivors -> NEXT list, expired -> dead list (indirect dispatch)
//   emit      : pop dead indices, initialise new particles from emitter params, append to the NEXT list
//   finalize  : write indirect draw/dispatch arguments from the NEXT list's count
//
//#include particles_common

struct SimParams {
  dt: f32,
  time: f32,
  frame: u32,
  cur: u32,            // which alive list holds LAST frame's survivors (0 = A, 1 = B)
  maxCount: u32,
  spawnTotal: u32,
  requestCount: u32,
  meshIndexCount: u32, // indirect indexed draw: index count of the pool's mesh (0 for billboard pools)
  meshFirstIndex: u32,
  meshBaseVertex: u32,
  _p0: u32,
  _p1: u32,
};

struct Counters {
  alive: array<atomic<u32>, 2>,
  dead: atomic<u32>,
  spawned: atomic<u32>,   // total particles ever spawned (diagnostics)
  rejected: atomic<u32>,  // spawn requests dropped because the pool was full (diagnostics)
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<uniform> sim: SimParams;
@group(0) @binding(1) var<storage, read> emitters: array<Emitter>;
@group(0) @binding(2) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(3) var<storage, read_write> aliveA: array<u32>;
@group(0) @binding(4) var<storage, read_write> aliveB: array<u32>;
@group(0) @binding(5) var<storage, read_write> deadList: array<u32>;
@group(0) @binding(6) var<storage, read_write> counters: Counters;
@group(0) @binding(7) var<storage, read> requests: array<vec4<u32>>;       // (emitterId, count, prefixStart, _)
@group(0) @binding(8) var<storage, read_write> args: array<u32>;           // [0..4) drawIndirect, [4..9) drawIndexedIndirect, [12..15) dispatchIndirect

fn aliveRead(list: u32, i: u32) -> u32 {
  if (list == 0u) { return aliveA[i]; }
  return aliveB[i];
}
fn aliveWrite(list: u32, i: u32, v: u32) {
  if (list == 0u) { aliveA[i] = v; } else { aliveB[i] = v; }
}

@compute @workgroup_size(1)
fn reset() {
  atomicStore(&counters.alive[1u - sim.cur], 0u);
}

@compute @workgroup_size(64)
fn simulate(@builtin(global_invocation_id) gid: vec3<u32>) {
  let aliveCount = atomicLoad(&counters.alive[sim.cur]);
  let i = gid.x;
  if (i >= aliveCount) { return; }
  let idx = aliveRead(sim.cur, i);
  var p = particles[idx];
  let accelDrag = emitters[p.emitterId].accelDrag;   // load only what is needed (the struct is 240 bytes)

  // semi-implicit Euler with drag (stable for any dt)
  p.velocity = p.velocity + accelDrag.xyz * sim.dt;
  p.velocity = p.velocity / (1.0 + accelDrag.w * sim.dt);
  p.position = p.position + p.velocity * sim.dt;
  p.rotation = p.rotation + p.angularVelocity * sim.dt;
  p.age = p.age + sim.dt;

  if (p.age >= p.lifetime) {
    let d = atomicAdd(&counters.dead, 1u);
    deadList[d] = idx;
  } else {
    particles[idx] = p;
    let o = atomicAdd(&counters.alive[1u - sim.cur], 1u);
    aliveWrite(1u - sim.cur, o, idx);
  }
}

fn randomInSphere(state: ptr<function, u32>) -> vec3<f32> {
  // rejection-free: direction from normalized gaussian-ish via 3 uniforms, radius ~ cbrt
  let z = nextRand(state) * 2.0 - 1.0;
  let a = nextRand(state) * 6.28318530718;
  let r = sqrt(max(0.0, 1.0 - z * z));
  return vec3<f32>(r * cos(a), z, r * sin(a));
}

@compute @workgroup_size(64)
fn emit(@builtin(global_invocation_id) gid: vec3<u32>) {
  let j = gid.x;
  if (j >= sim.spawnTotal) { return; }

  // which emitter does request slot j belong to?
  var emitterId = 0u;
  for (var k = 0u; k < sim.requestCount; k = k + 1u) {
    let r = requests[k];
    if (j >= r.z && j < r.z + r.y) { emitterId = r.x; break; }
  }

  // pop a free particle index (atomic stack); back off if the pool is full
  let old = atomicSub(&counters.dead, 1u);
  if (old == 0u || old > sim.maxCount) {
    atomicAdd(&counters.dead, 1u);
    atomicAdd(&counters.rejected, 1u);
    return;
  }
  let idx = deadList[old - 1u];

  let e = emitters[emitterId];
  var rng = pcgHash(e.seed.x ^ pcgHash(sim.frame * 9781u + j * 6271u + 1u));

  var local = vec3<f32>(0.0);
  var dir = vec3<f32>(0.0, 1.0, 0.0);
  let shape = u32(e.misc.z + 0.5);
  if (shape == SHAPE_BOX) {
    local = (vec3<f32>(nextRand(&rng), nextRand(&rng), nextRand(&rng)) * 2.0 - 1.0) * e.shapeParams.xyz;
    dir = normalize(local + vec3<f32>(0.0, 1e-4, 0.0));
  } else if (shape == SHAPE_SPHERE) {
    let d = randomInSphere(&rng);
    let radius = e.shapeParams.x * select(pow(nextRand(&rng), 1.0 / 3.0), 1.0, e.shapeParams.y > 0.5);
    local = d * radius;
    dir = d;
  } else if (shape == SHAPE_CONE) {
    let a = nextRand(&rng) * 6.28318530718;
    let rr = e.shapeParams.x * sqrt(nextRand(&rng));
    local = vec3<f32>(rr * cos(a), 0.0, rr * sin(a));
    let ang = nextRand(&rng) * e.shapeParams.w;
    let phi = nextRand(&rng) * 6.28318530718;
    dir = vec3<f32>(sin(ang) * cos(phi), cos(ang), sin(ang) * sin(phi));
  }
  let dirMode = u32(e.misc.y + 0.5);
  var radial = vec3<f32>(0.0);
  if (dirMode != 0u) { radial = dir * mix(e.velMin.w, e.velMax.w, nextRand(&rng)); }
  var vel = mix(e.velMin.xyz, e.velMax.xyz, vec3<f32>(nextRand(&rng), nextRand(&rng), nextRand(&rng))) + radial;

  var p: Particle;
  if (e.misc.w > 0.5) {                       // local simulation space: keep emitter-local coordinates
    p.position = local; p.velocity = vel;
  } else {                                    // world space: bake the emitter transform in at spawn time
    p.position = (e.world * vec4<f32>(local, 1.0)).xyz;
    p.velocity = (e.world * vec4<f32>(vel, 0.0)).xyz;
  }
  p.age = 0.0;
  p.lifetime = max(1e-3, mix(e.lifeSize.x, e.lifeSize.y, nextRand(&rng)));
  p.color = vec4<f32>(1.0);
  p.size = mix(e.lifeSize.z, e.lifeSize.w, nextRand(&rng));
  p.rotation = mix(e.rotation.x, e.rotation.y, nextRand(&rng));
  p.angularVelocity = mix(e.rotation.z, e.rotation.w, nextRand(&rng));
  p.emitterId = emitterId;
  particles[idx] = p;

  let o = atomicAdd(&counters.alive[1u - sim.cur], 1u);
  aliveWrite(1u - sim.cur, o, idx);
  atomicAdd(&counters.spawned, 1u);
}

@compute @workgroup_size(1)
fn finalize() {
  let n = atomicLoad(&counters.alive[1u - sim.cur]);
  args[0] = 6u; args[1] = n; args[2] = 0u; args[3] = 0u;                                          // drawIndirect (quad = 6 vertices)
  args[4] = sim.meshIndexCount; args[5] = n; args[6] = sim.meshFirstIndex; args[7] = sim.meshBaseVertex; args[8] = 0u; // drawIndexedIndirect
  args[12] = (n + 63u) / 64u; args[13] = 1u; args[14] = 1u;                                       // next frame's simulate dispatch
}
