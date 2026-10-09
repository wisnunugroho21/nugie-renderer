// Textured sprites (and text glyphs): one instanced draw, 6 vertices per sprite.
//   sprites[i]: posRot = (xyz or pixel x, y, z, rotation radians), size = (w, h, pivotX, pivotY),
//               uv = (u0, v0, u1, v1) with v0 at the top, color, right = (xyz, mode), up = (xyz, 0), extra = (offset x, y in the sprite plane, 0, 0)
//   mode: 0 faces the camera, 1 turns about the world Y axis only, 2 uses `right` / `up` (a fixed plane, e.g. text on a wall)
//   params = (space: 0 world / 1 screen pixels from the top-left, size unit: 0 world units / 1 pixels, 0, 0)
//#include common_types
//#include common_bind_frame
//#include common_color
//#include common_output

struct Sprite { posRot: vec4<f32>, size: vec4<f32>, uv: vec4<f32>, color: vec4<f32>, right: vec4<f32>, up: vec4<f32>, extra: vec4<f32> };
@group(1) @binding(0) var<storage, read> sprites: array<Sprite>;
@group(1) @binding(1) var<uniform> params: vec4<f32>;
@group(1) @binding(2) var spriteSampler: sampler;
@group(1) @binding(3) var spriteTexture: texture_2d<f32>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
};

const CORNER = array<vec2<f32>, 6>(vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0), vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0));

fn hidden() -> VSOut {
  var o: VSOut;
  o.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0); o.uv = vec2<f32>(0.0); o.color = vec4<f32>(0.0);
  return o;
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let s = sprites[ii];
  let cn = CORNER[vi % 6u];
  if (s.size.x <= 0.0 || s.color.a <= 0.0) { return hidden(); }
  var offs = (cn - s.size.zw) * s.size.xy + s.extra.xy;                 // sprite-plane offset (y up): corner relative to the pivot + extra offset
  let ca = cos(s.posRot.w); let sa = sin(s.posRot.w);
  offs = vec2<f32>(offs.x * ca - offs.y * sa, offs.x * sa + offs.y * ca);
  var o: VSOut;
  o.uv = vec2<f32>(mix(s.uv.x, s.uv.z, cn.x), mix(s.uv.w, s.uv.y, cn.y));
  o.color = s.color;

  if (params.x > 0.5) {                                                   // screen space: pixels, origin top-left
    let px = vec2<f32>(s.posRot.x + offs.x, s.posRot.y - offs.y);
    o.pos = vec4<f32>(px.x / frame.viewport.x * 2.0 - 1.0, 1.0 - px.y / frame.viewport.y * 2.0, s.posRot.z, 1.0);
    return o;
  }

  let centre = frame.viewProjection * vec4<f32>(s.posRot.xyz, 1.0);
  if (centre.z < 0.0 || centre.w <= 0.0) { return hidden(); }
  if (params.y > 0.5) {                                                   // constant pixel size: offset in clip space, always faces the camera
    o.pos = vec4<f32>(centre.xy + offs / (0.5 * frame.viewport.xy) * centre.w, centre.z, centre.w);
    return o;
  }

  let camRight = vec3<f32>(frame.view[0][0], frame.view[1][0], frame.view[2][0]);
  let camUp = vec3<f32>(frame.view[0][1], frame.view[1][1], frame.view[2][1]);
  var right = camRight;
  var up = camUp;
  let mode = u32(s.right.w + 0.5);
  if (mode == 1u) {
    up = vec3<f32>(0.0, 1.0, 0.0);
    let toCam = frame.cameraPosition.xyz - s.posRot.xyz;
    right = normalize(cross(up, vec3<f32>(toCam.x, 0.0, toCam.z)) + vec3<f32>(1e-6, 0.0, 0.0));
  } else if (mode == 2u) {
    right = s.right.xyz;
    up = s.up.xyz;
  }
  let world = s.posRot.xyz + right * offs.x + up * offs.y;
  o.pos = frame.viewProjection * vec4<f32>(world, 1.0);
  return o;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let t = textureSample(spriteTexture, spriteSampler, in.uv) * in.color;
  if (t.a < 0.004) { discard; }
  return vec4<f32>(outputColor(t.rgb), t.a);
}
