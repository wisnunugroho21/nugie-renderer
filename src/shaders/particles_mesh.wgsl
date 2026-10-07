// Mesh particles: ONE mesh per pool, instanced via drawIndexedIndirect(instanceCount = alive count).
// Per-particle state supplies the transform (position, axis-angle rotation, size) and color.
//
//#include common_types
//#include common_bind_frame
//#include common_color
//#include particles_common

struct RenderParams {
  cur: u32,
  orientation: u32,
  additive: u32,
  _p0: u32,
  fade: vec4<f32>,
};

@group(1) @binding(0) var<storage, read> particles: array<Particle>;
@group(1) @binding(1) var<storage, read> aliveA: array<u32>;
@group(1) @binding(2) var<storage, read> aliveB: array<u32>;
@group(1) @binding(3) var<storage, read> emitters: array<Emitter>;
@group(1) @binding(4) var<uniform> rp: RenderParams;

struct VSIn {
  @builtin(instance_index) instance: u32,
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) tangent: vec4<f32>,
};

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) color: vec4<f32>,
};

fn rotationAxisAngle(axis: vec3<f32>, angle: f32) -> mat3x3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  let t = 1.0 - c;
  let x = axis.x; let y = axis.y; let z = axis.z;
  return mat3x3<f32>(
    vec3<f32>(t * x * x + c,     t * x * y + s * z, t * x * z - s * y),
    vec3<f32>(t * x * y - s * z, t * y * y + c,     t * y * z + s * x),
    vec3<f32>(t * x * z + s * y, t * y * z - s * x, t * z * z + c),
  );
}

@vertex
fn vs_main(in: VSIn) -> VSOut {
  var idx = aliveB[in.instance];
  if (rp.cur == 0u) { idx = aliveA[in.instance]; }
  let p = particles[idx];
  let eWorld = emitters[p.emitterId].world;
  let eColorStart = emitters[p.emitterId].colorStart;
  let eColorEnd = emitters[p.emitterId].colorEnd;
  let eMisc = emitters[p.emitterId].misc;

  let t = clamp(p.age / p.lifetime, 0.0, 1.0);
  let size = mix(p.size, p.size * eMisc.x, t);
  var center = p.position;
  if (eMisc.w > 0.5) { center = (eWorld * vec4<f32>(center, 1.0)).xyz; }

  // per-particle random tumble axis from the particle index
  var h = pcgHash(idx * 2654435761u + 17u);
  let ax = f32(h & 1023u) / 511.5 - 1.0; h = pcgHash(h);
  let ay = f32(h & 1023u) / 511.5 - 1.0; h = pcgHash(h);
  let az = f32(h & 1023u) / 511.5 - 1.0;
  var axis = vec3<f32>(ax, ay, az);
  if (dot(axis, axis) < 1e-4) { axis = vec3<f32>(0.0, 1.0, 0.0); }
  let R = rotationAxisAngle(normalize(axis), p.rotation);

  var out: VSOut;
  out.pos = frame.viewProjection * vec4<f32>(center + R * (in.position * size), 1.0);
  out.normal = R * in.normal;
  out.color = mix(eColorStart, eColorEnd, t) * p.color;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let sun = normalize(vec3<f32>(0.4, 0.8, 0.5));
  let hemi = 0.35 + 0.65 * (n.y * 0.5 + 0.5);
  let lit = in.color.rgb * (hemi * 0.6 + max(dot(n, sun), 0.0) * 1.2);
  if (in.color.a < 0.004) { discard; }
  return vec4<f32>(linearToSrgb(tonemapACES(lit)), in.color.a);
}
