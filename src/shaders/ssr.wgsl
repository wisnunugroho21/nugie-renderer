// Screen-space reflections: march the reflected ray through the linear depth buffer (steps are uniform in screen space, depth is
// interpolated as 1/z), refine the hit by bisection, and output the hit colour with a confidence weight.
//   texA = scene colour (HDR), texB = aux (view normal, roughness, metallic), texD = linear depth
//   a = (max distance, thickness, stride px, max steps), b = (intensity, max roughness, 0, far), c.x = near
//   rgb = reflected radiance, a = how much of the pixel's colour it replaces (Fresnel x fades x intensity)
//#include post_common

@fragment
fn fs_ssr(in: VOut) -> @location(0) vec4<f32> {
  let px = vec2<i32>(in.pos.xy);
  let z = linDepth(px);
  let aux = textureLoad(texB, px, 0);
  let maxRough = P.b.y;
  if (aux.a < 0.5 || z > P.b.w * 0.999 || aux.b >= maxRough) { return vec4<f32>(0.0); }
  let roughness = aux.b;
  let metallic = (aux.a - 0.5) * 2.0;

  let N = octDecode(aux.rg * 2.0 - vec2<f32>(1.0));
  let pos = viewPos(px, z);
  let V = normalize(-pos);
  let R = reflect(-V, N);

  var len = P.a.x;
  if (R.z > 0.0) { len = min(len, (-P.c.x - pos.z) / R.z); }             // stop before the ray reaches the near plane
  if (len < 0.05) { return vec4<f32>(0.0); }
  let endp = pos + R * len;
  let s0 = in.pos.xy;
  let s1 = projectPx(endp);
  let delta = s1 - s0;
  let pixLen = max(abs(delta.x), abs(delta.y));
  if (pixLen < 1.0) { return vec4<f32>(0.0); }

  let invZ0 = 1.0 / z;
  let invZ1 = 1.0 / (-endp.z);
  let nSteps = i32(clamp(pixLen / max(P.a.z, 1.0), 1.0, P.a.w));
  let thick = P.a.y * (1.0 + z * 0.05);                                  // looser tolerance with distance
  let bias = max(0.02, z * 0.003);
  let jitter = ign(in.pos.xy);

  var hit = false;
  var tHit = 0.0;
  var tPrev = 0.0;
  for (var i = 1; i <= nSteps; i++) {
    let t = (f32(i) + jitter) / f32(nSteps + 1);
    let sp = s0 + delta * t;
    if (sp.x < 0.0 || sp.y < 0.0 || sp.x >= P.f.z || sp.y >= P.f.w) { break; }
    let zr = 1.0 / mix(invZ0, invZ1, t);
    let zs = linDepth(vec2<i32>(sp));
    let diff = zr - zs;                                                  // > 0: the ray is behind the surface
    if (diff > bias && diff < thick) { hit = true; tHit = t; break; }
    tPrev = t;
  }
  if (!hit) { return vec4<f32>(0.0); }

  // Bisection between the last miss and the first hit.
  var lo = tPrev;
  var hi = tHit;
  for (var k = 0; k < 6; k++) {
    let mid = 0.5 * (lo + hi);
    let sp = s0 + delta * mid;
    let zr = 1.0 / mix(invZ0, invZ1, mid);
    if (zr > linDepth(vec2<i32>(sp))) { hi = mid; } else { lo = mid; }
  }
  let hp = s0 + delta * hi;
  let finalDiff = 1.0 / mix(invZ0, invZ1, hi) - linDepth(vec2<i32>(hp));
  if (finalDiff > thick) { return vec4<f32>(0.0); }

  let huv = hp * P.f.xy;
  let edge = smoothstep(0.0, 0.12, min(min(huv.x, 1.0 - huv.x), min(huv.y, 1.0 - huv.y)));
  let distFade = 1.0 - hi;
  let roughFade = 1.0 - smoothstep(0.0, maxRough, roughness);
  let facing = 1.0 - smoothstep(0.55, 0.95, R.z);                        // rays aimed back at the camera rarely find their hit on screen
  let cosV = clamp(dot(N, V), 0.0, 1.0);
  let f0 = mix(0.04, 0.9, metallic);
  let fresnel = f0 + (1.0 - f0) * pow(1.0 - cosV, 5.0);
  let w = clamp(edge * distFade * roughFade * roughFade * facing * fresnel * P.b.x, 0.0, 1.0);

  let hitColor = min(textureSampleLevel(texA, samp, huv, 0.0).rgb, vec3<f32>(16.0));
  let base = textureLoad(texA, px, 0).rgb;
  let tint = mix(vec3<f32>(1.0), base / max(max(base.r, max(base.g, base.b)), 1e-3), metallic);   // metals tint their reflection
  return vec4<f32>(hitColor * tint, w);
}
