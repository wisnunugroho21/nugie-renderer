// Screen-space ambient occlusion: normal-oriented hemisphere sampling against the linear depth buffer, then a depth-aware blur.
//   fs_ssao:  texA = aux (view normal), texD = linear depth.   a = (radius, bias, intensity, power), b = (samples, 0, far, 0)
//   fs_blur:  texA = occlusion, texD = linear depth.            a = (dir.x, dir.y, depth sharpness, 0)
//#include post_common

@fragment
fn fs_ssao(in: VOut) -> @location(0) vec4<f32> {
  let px = vec2<i32>(in.pos.xy);
  let z = linDepth(px);
  if (z > P.b.z * 0.999) { return vec4<f32>(1.0); }                     // sky
  let aux = textureLoad(texA, px, 0);
  let N = viewNormal(px, aux, z);
  let pos = viewPos(px, z);

  // Per-pixel rotation of the sample pattern (hidden by the blur).
  let ang = ign(in.pos.xy) * 6.2831853;
  let rv = vec3<f32>(cos(ang), sin(ang), 0.0);
  var T = rv - N * dot(rv, N);
  if (dot(T, T) < 1e-4) { T = cross(N, vec3<f32>(0.0, 1.0, 0.0)); }
  T = normalize(T);
  let B = cross(N, T);

  let count = i32(P.b.x);
  let radius = P.a.x;
  var occ = 0.0;
  for (var i = 0; i < count; i++) {
    let fi = (f32(i) + 0.5) / f32(count);
    let r = sqrt(fi);
    let phi = f32(i) * 2.3999632;                                        // golden angle
    let h = vec3<f32>(r * cos(phi), r * sin(phi), sqrt(max(1.0 - fi, 0.0)));
    let scale = mix(0.15, 1.0, fi * fi);                                 // more samples close to the pixel
    let sp = pos + (T * h.x + B * h.y + N * h.z) * (radius * scale);
    if (sp.z > -0.01) { continue; }
    let spx = projectPx(sp);
    if (spx.x < 0.0 || spx.y < 0.0 || spx.x >= P.f.z || spx.y >= P.f.w) { continue; }
    let sceneZ = linDepth(vec2<i32>(spx));
    if (sceneZ < -sp.z - P.a.y) {                                        // the sample lies behind the visible surface
      occ += smoothstep(0.0, 1.0, radius / max(abs(z - sceneZ), 1e-4)); // ignore occluders far in front of the pixel
    }
  }
  let ao = pow(clamp(1.0 - P.a.z * occ / f32(count), 0.0, 1.0), P.a.w);
  return vec4<f32>(ao, 0.0, 0.0, 1.0);
}

@fragment
fn fs_blur(in: VOut) -> @location(0) vec4<f32> {
  let px = vec2<i32>(in.pos.xy);
  let zc = linDepth(px);
  let dir = vec2<i32>(i32(P.a.x), i32(P.a.y));
  var sum = 0.0;
  var wsum = 0.0;
  for (var k = -4; k <= 4; k++) {
    let q = px + dir * k;
    let zs = linDepth(q);
    let wd = exp(-abs(zc - zs) / max(zc, 0.1) * P.a.z);                  // do not blur across depth edges
    let w = wd * exp(-f32(k * k) / 8.0);
    sum += textureLoad(texA, clamp(q, vec2<i32>(0), sizePx() - vec2<i32>(1)), 0).r * w;
    wsum += w;
  }
  return vec4<f32>(sum / max(wsum, 1e-5), 0.0, 0.0, 1.0);
}
