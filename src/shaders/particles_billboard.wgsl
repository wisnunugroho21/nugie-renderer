// Billboard / point-sprite particles. One draw call per pool: drawIndirect(6 vertices x aliveCount instances).
//
//#include common_types
//#include common_bind_frame
//#include common_color
//#include particles_common

struct RenderParams {
  cur: u32,          // which alive list holds this frame's survivors
  orientation: u32,  // 0 screen-aligned, 1 camera-facing (toward the camera POSITION), 2 world-up cylindrical, 3 point sprite (constant pixel size)
  additive: u32,
  _p0: u32,
  fade: vec4<f32>,   // x = distance where the near fade starts, y = fade range (0 = no fade)
};

@group(1) @binding(0) var<storage, read> particles: array<Particle>;
@group(1) @binding(1) var<storage, read> aliveA: array<u32>;
@group(1) @binding(2) var<storage, read> aliveB: array<u32>;
@group(1) @binding(3) var<storage, read> emitters: array<Emitter>;
@group(1) @binding(4) var<uniform> rp: RenderParams;
@group(1) @binding(5) var spriteSampler: sampler;
@group(1) @binding(6) var spriteTexture: texture_2d<f32>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
};

const CORNERS = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
  vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  var idx = aliveB[ii];
  if (rp.cur == 0u) { idx = aliveA[ii]; }
  let p = particles[idx];
  let eWorld = emitters[p.emitterId].world;
  let eColorStart = emitters[p.emitterId].colorStart;
  let eColorEnd = emitters[p.emitterId].colorEnd;
  let eMisc = emitters[p.emitterId].misc;
  let eFlip = emitters[p.emitterId].flipbook;

  let t = clamp(p.age / p.lifetime, 0.0, 1.0);
  let size = mix(p.size, p.size * eMisc.x, t);
  var center = p.position;
  if (eMisc.w > 0.5) { center = (eWorld * vec4<f32>(center, 1.0)).xyz; }

  let corner = CORNERS[vi];
  let cr = cos(p.rotation);
  let sr = sin(p.rotation);
  let rc = vec2<f32>(corner.x * cr - corner.y * sr, corner.x * sr + corner.y * cr);

  var out: VSOut;
  let camPos = frame.cameraPosition.xyz;
  if (rp.orientation == 3u) {
    // point sprite: `size` is in PIXELS regardless of distance
    let clip = frame.viewProjection * vec4<f32>(center, 1.0);
    let px = rc * size * 2.0 / frame.viewport.xy;
    out.pos = vec4<f32>(clip.xy + px * clip.w, clip.z, clip.w);
  } else {
    var right = vec3<f32>(frame.view[0][0], frame.view[1][0], frame.view[2][0]);
    var up = vec3<f32>(frame.view[0][1], frame.view[1][1], frame.view[2][1]);
    if (rp.orientation == 1u) {
      let toCam = normalize(camPos - center);
      var r = cross(vec3<f32>(0.0, 1.0, 0.0), toCam);
      if (dot(r, r) < 1e-6) { r = vec3<f32>(1.0, 0.0, 0.0); }
      right = normalize(r);
      up = cross(toCam, right);
    } else if (rp.orientation == 2u) {
      var toCam = camPos - center;
      toCam.y = 0.0;
      toCam = normalize(toCam + vec3<f32>(1e-5, 0.0, 0.0));
      right = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), toCam));
      up = vec3<f32>(0.0, 1.0, 0.0);
    }
    let world = center + (right * rc.x + up * rc.y) * size;
    out.pos = frame.viewProjection * vec4<f32>(world, 1.0);
  }

  // flipbook (sprite sheet) animation
  var uv = vec2<f32>(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
  let frames = max(1.0, eFlip.z);
  if (frames > 1.0) {
    var f = floor(t * frames);
    if (eFlip.w > 0.0) { f = floor(p.age * eFlip.w) % frames; }
    f = min(f, frames - 1.0);
    let col = f % eFlip.x;
    let row = floor(f / eFlip.x);
    uv = (uv + vec2<f32>(col, row)) / vec2<f32>(eFlip.x, eFlip.y);
  }
  out.uv = uv;

  var color = mix(eColorStart, eColorEnd, t) * p.color;
  if (rp.fade.y > 0.0) { color.a = color.a * clamp((distance(camPos, center) - rp.fade.x) / rp.fade.y, 0.0, 1.0); }
  out.color = color;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let texel = textureSample(spriteTexture, spriteSampler, in.uv);
  let c = texel * in.color;
  if (c.a < 0.004) { discard; }
  // same display transform as the PBR pass (until the HDR post-process chain exists)
  return vec4<f32>(linearToSrgb(tonemapACES(c.rgb)), c.a);
}
