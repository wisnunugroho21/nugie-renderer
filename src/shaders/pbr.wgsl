// glTF metallic-roughness PBR + emissive, extended into a small material system. One shader, variants selected by compile-time defines
// (see MaterialFeature in materials/MaterialFlags.ts; unused features are compiled out):
//   ALPHA_MASK, ALPHA_BLEND, HAS_NORMAL_MAP                              as before
//   HAS_BUMP, HAS_PARALLAX, HAS_DISPLACEMENT                              surface detail from the height map (texHeight.r)
//   HAS_ALPHA_MAP, HAS_ENV_MAP, HAS_EXT_MAP                               alpha map, per-material environment, packed physical factors in texAux
//   HAS_CLEARCOAT, HAS_SHEEN, HAS_TRANSMISSION, HAS_IRIDESCENCE,
//   HAS_ANISOTROPY, HAS_SPECULAR, HAS_VOLUME, HAS_DISPERSION              glTF KHR_materials_* extensions
//   MODEL_UNLIT, MODEL_LAMBERT, MODEL_PHONG, MODEL_TOON, MODEL_MATCAP     alternative shading models (none = physically based)
// Per-material parameters of the extensions live in a block of vec4s at m.paramBase (see PBRExtension.ts):
//   0 (shininess, toonSteps, envIntensity, -)   1 (clearcoat, clearcoatRoughness, transmission, thickness)   2 (sheenColor, sheenRoughness)
//   3 (iridescence, filmIor, filmMin, filmMax)  4 (anisotropy, rotation, ior, dispersion)   5 (specularColor, specularIntensity)
//   6 (attenuationColor, attenuationDistance)   7 (bumpScale, parallaxScale, displacementScale, displacementBias)   8 (phongSpecular, -)
//
//#include common
//#include common_output
//#include lighting
//#include ibl_eval

struct VSOut {
  @builtin(position) @invariant clip: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldNormal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) worldTangent: vec4<f32>,
  @location(4) @interpolate(flat) materialIndex: u32,
  @location(5) @interpolate(flat) modelScale: f32,
};

fn ext(m: MaterialRecord, k: u32) -> vec4<f32> { return paramVec4(m.paramBase + k); }

@vertex
fn vs_main(in: VertexInput) -> VSOut {
  var out: VSOut;
  let inst = instances[in.instance];
  let model = transforms[inst.transformIndex];
  let d = deformVertex(inst, in.vertexIndex, in.position, in.normal, in.tangent.xyz);
  var localPos = d.position;
  if HAS_DISPLACEMENT {
    // texHeight is sampled in the vertex stage: the mesh needs enough vertices to carry the detail
    let e = ext(materials[inst.materialIndex], 7u);
    let h = textureSampleLevel(texHeight, materialSampler, in.uv, 0.0).r;
    localPos = localPos + normalize(d.normal) * (h * e.z + e.w);
  }
  let world = model * vec4<f32>(localPos, 1.0);
  let nm = normalMatrix(model);
  out.clip = frame.viewProjection * world;
  out.worldPos = world.xyz;
  out.worldNormal = nm * d.normal;
  out.worldTangent = vec4<f32>(mat3x3<f32>(model[0].xyz, model[1].xyz, model[2].xyz) * d.tangent, in.tangent.w);
  out.uv = in.uv;
  out.materialIndex = inst.materialIndex;
  out.modelScale = length(model[0].xyz);
  return out;
}

// ---- shading frame: uv (parallax-shifted), shading normal (normal map, bump), tangent frame ----------------------------------

struct Shading {
  uv: vec2<f32>,
  N: vec3<f32>,
  Ng: vec3<f32>,
  T: vec3<f32>,
  B: vec3<f32>,
};

// Must be called from uniform control flow (it takes screen-space derivatives): first thing in every fragment entry.
fn computeShading(in: VSOut, frontFacing: bool, m: MaterialRecord) -> Shading {
  let dp1 = dpdx(in.worldPos); let dp2 = dpdy(in.worldPos);
  let duv1 = dpdx(in.uv); let duv2 = dpdy(in.uv);
  var Ng = normalize(in.worldNormal);
  if (!frontFacing) { Ng = -Ng; }                       // double-sided back faces
  var T = vec3<f32>(1.0, 0.0, 0.0);
  var B = vec3<f32>(0.0, 0.0, 1.0);
  if HAS_NORMAL_MAP || HAS_PARALLAX || HAS_ANISOTROPY {
    if (in.worldTangent.w != 0.0) {
      T = normalize(in.worldTangent.xyz - Ng * dot(Ng, in.worldTangent.xyz));
      B = cross(Ng, T) * in.worldTangent.w;
    } else {
      // Derivative-based cotangent frame for meshes without tangents.
      let dp2perp = cross(dp2, Ng); let dp1perp = cross(Ng, dp1);
      let t = dp2perp * duv1.x + dp1perp * duv2.x;
      let b = dp2perp * duv1.y + dp1perp * duv2.y;
      let invmax = inverseSqrt(max(max(dot(t, t), dot(b, b)), 1e-20));
      T = t * invmax; B = -b * invmax;                  // bitangent toward image-up (decreasing V), matching glTF tangents
    }
    if (!frontFacing) { T = -T; B = -B; }
  }

  var uv = in.uv;
  if HAS_PARALLAX {
    // Parallax occlusion mapping: march the view ray through the height field in a fixed number of layers (uniform control flow, so the
    // texture reads below keep their derivatives), then interpolate between the last two samples.
    let scale = ext(m, 7u).y;
    let Vw = normalize(frame.cameraPosition.xyz - in.worldPos);
    let Vt = vec3<f32>(dot(Vw, T), dot(Vw, B), dot(Vw, Ng));
    let perDepth = vec2<f32>(-Vt.x, Vt.y) / max(Vt.z, 0.1) * scale;     // uv shift per unit of depth (v runs against B)
    var depth = 0.0;
    var prevDepth = 0.0;
    var prevGap = 0.0;                                  // (surface depth - ray depth) at the previous layer, > 0 while above the surface
    var hitDepth = 1.0;
    var found = false;
    for (var i = 0; i < 24; i = i + 1) {
      if (!found) {
        let surface = 1.0 - textureSampleGrad(texHeight, materialSampler, in.uv + perDepth * depth, duv1, duv2).r;
        let gap = surface - depth;
        if (gap <= 0.0) {
          let w = clamp(prevGap / max(prevGap - gap, 1e-5), 0.0, 1.0);
          hitDepth = mix(prevDepth, depth, w);
          found = true;
        } else {
          prevGap = gap; prevDepth = depth;
        }
      }
      depth = depth + 1.0 / 24.0;
    }
    uv = in.uv + perDepth * hitDepth;
  }

  var N = Ng;
  if HAS_NORMAL_MAP {
    let tn = textureSample(texNormal, materialSampler, uv).xyz * 2.0 - 1.0;
    N = normalize(T * tn.x * m.normalScale + B * tn.y * m.normalScale + Ng * tn.z);
  }
  if HAS_BUMP {
    // Mikkelsen's bump mapping: perturb the normal by the screen-space gradient of the height
    let bumpScale = ext(m, 7u).x;
    let h0 = textureSample(texHeight, materialSampler, uv).r;
    let dH = vec2<f32>(
      textureSample(texHeight, materialSampler, uv + duv1).r - h0,
      textureSample(texHeight, materialSampler, uv + duv2).r - h0) * bumpScale;
    let faceDir = select(-1.0, 1.0, frontFacing);
    let R1 = cross(dp2, N); let R2 = cross(N, dp1);
    let det = dot(dp1, R1) * faceDir;
    let grad = sign(det) * (dH.x * R1 + dH.y * R2);
    N = normalize(abs(det) * N - grad);
  }
  var sh: Shading;
  sh.uv = uv; sh.N = N; sh.Ng = Ng; sh.T = T; sh.B = B;
  return sh;
}

// ---- image-based lighting: the scene environment, or this material's own ------------------------------------------------------

fn iblDiffuseAt(dir: vec3<f32>) -> vec3<f32> {
  if HAS_ENV_MAP {
    // the roughest prefiltered mip is a good stand-in for the cosine-convolved irradiance
    return textureSampleLevel(texEnv, envSampler, dir, f32(textureNumLevels(texEnv) - 1u)).rgb;
  }
  return textureSampleLevel(envIrradiance, envSampler, rotateY(dir, -scene.env.y), 0.0).rgb;
}

fn iblSpecularAt(dir: vec3<f32>, roughness: f32) -> vec3<f32> {
  if HAS_ENV_MAP {
    return textureSampleLevel(texEnv, envSampler, dir, roughness * f32(textureNumLevels(texEnv) - 1u)).rgb;
  }
  return textureSampleLevel(envSpecular, envSampler, rotateY(dir, -scene.env.y), roughness * (scene.env.z - 1.0)).rgb;
}

// Colour seen through a transmissive surface along `dir`: the opaque scene copy at the point where the ray leaves the volume (screen space), blending
// to the environment near the screen edges; the environment alone when the copy is not available (no post chain, render-target views).
fn refractedLight(P: vec3<f32>, dir: vec3<f32>, thickness: f32, roughness: f32) -> vec3<f32> {
  let env = iblSpecularAt(dir, roughness);
  if (frame.postFlags.y < 0.5) { return env; }
  let exit = frame.viewProjection * vec4<f32>(P + normalize(dir) * thickness, 1.0);
  if (exit.w <= 0.0) { return env; }
  let uv = vec2<f32>(exit.x / exit.w * 0.5 + 0.5, 0.5 - exit.y / exit.w * 0.5);
  let screen = textureSampleLevel(transmissionTex, envSampler, uv, roughness * frame.postFlags.z).rgb;
  let edge = smoothstep(0.0, 0.08, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  return mix(env, screen, edge);
}

// Split-sum IBL with the physical extensions: anisotropic bent reflection, sheen, clearcoat, specular weight.
fn evaluateIBLExt(s: SurfaceInfo, occlusion: f32, intensity: f32) -> vec3<f32> {
  let NoV = max(dot(s.N, s.V), 1e-4);
  var R = reflect(-s.V, s.N);
  if (s.aniso != 0.0) {
    let dir = select(s.T, s.B, s.aniso >= 0.0);
    let tangentAtV = cross(dir, s.V);
    let bentN = normalize(mix(s.N, cross(tangentAtV, dir), abs(s.aniso)));
    R = reflect(-s.V, bentN);
  }
  let ab = textureSampleLevel(brdfLut, envSampler, vec2<f32>(NoV, s.roughness), 0.0).rg;
  let specColor = s.f0 * ab.x + vec3<f32>(s.f90 * ab.y);
  var diffuse = iblDiffuseAt(s.N) * s.diffuseColor;
  var spec = iblSpecularAt(R, s.roughness) * specColor;
  if (max3(s.sheenColor) > 0.0) {
    let scale = sheenAlbedoScale(s.sheenColor, NoV);
    let g = 1.0 - NoV;
    diffuse = diffuse * scale + iblDiffuseAt(s.N) * s.sheenColor * (0.35 + 0.65 * g * g) * 0.5;
    spec = spec * scale;
  }
  var total = diffuse + spec;
  if (s.clearcoat > 0.0) {
    let ccNoV = max(dot(s.Ng, s.V), 1e-4);
    let abc = textureSampleLevel(brdfLut, envSampler, vec2<f32>(ccNoV, s.ccRoughness), 0.0).rg;
    let Fc = s.clearcoat * (0.04 + 0.96 * pow5(1.0 - ccNoV));
    let coat = iblSpecularAt(reflect(-s.V, s.Ng), s.ccRoughness) * (0.04 * abc.x + abc.y) * s.clearcoat;
    total = total * (1.0 - Fc) + coat;
  }
  return total * intensity * occlusion;
}

fn hemisphereAmbient(N: vec3<f32>) -> vec3<f32> {
  return mix(scene.ambientGround.rgb, scene.ambientSky.rgb, N.y * 0.5 + 0.5);
}

// ---- fragment entry points --------------------------------------------------------------------------------------------------

@fragment
fn fs_main(in: VSOut, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4<f32> {
  let m = materials[in.materialIndex];
  let sh = computeShading(in, frontFacing, m);
  let uv = sh.uv;

  var base = textureSample(texBaseColor, materialSampler, uv) * m.baseColor;
  if HAS_ALPHA_MAP { base.a = base.a * textureSample(texAlpha, materialSampler, uv).g; }
  if ALPHA_MASK {
    if (base.a < m.alphaCutoff) { discard; }
  }
  var alpha = 1.0;
  if ALPHA_BLEND { alpha = base.a; }
  let emissive = textureSample(texEmissive, materialSampler, uv).rgb * m.emissive.rgb * m.emissive.w;

  // ---- unlit models ----
  if MODEL_UNLIT {
    let c = applyFog(base.rgb + emissive, in.clip.xy, 1.0 / in.clip.w);
    return vec4<f32>(outputColor(c), alpha);
  }
  if MODEL_MATCAP {
    let vn = normalize((frame.view * vec4<f32>(sh.N, 0.0)).xyz);
    let mc = textureSample(texAux, materialSampler, vec2<f32>(vn.x * 0.5 + 0.5, 0.5 - vn.y * 0.5)).rgb;
    let c = applyFog(mc * base.rgb + emissive, in.clip.xy, 1.0 / in.clip.w);
    return vec4<f32>(outputColor(c), alpha);
  }

  let mr = textureSample(texMetalRough, materialSampler, uv);
  let metallic = clamp(m.metallic * mr.b, 0.0, 1.0);
  let roughness = m.roughness * mr.g;
  let occlusion = 1.0 + m.occlusionStrength * (textureSample(texOcclusion, materialSampler, uv).r - 1.0);
  let V = normalize(frame.cameraPosition.xyz - in.worldPos);
  var s = makeSurface(base.rgb, metallic, roughness, sh.N, V);
  s.Ng = sh.Ng; s.T = sh.T; s.B = sh.B;
  var intensity = scene.env.x;
  if HAS_ENV_MAP { intensity = ext(m, 0u).z; }

  // ---- simple shading models ----
  if MODEL_LAMBERT || MODEL_PHONG || MODEL_TOON {
    s.diffuseColor = base.rgb;
    s.f0 = vec3<f32>(0.0);
    if MODEL_LAMBERT { s.model = 1u; }
    if MODEL_PHONG {
      s.model = 2u;
      s.shininess = max(ext(m, 0u).x, 1.0);
      s.phongSpec = ext(m, 8u).rgb;
    }
    if MODEL_TOON {
      s.model = 3u;
      s.toonSteps = max(ext(m, 0u).y, 1.0);
      s.shininess = max(ext(m, 0u).x, 1.0);
      s.phongSpec = ext(m, 8u).rgb;
      if TOON_RAMP {
        s.toonRamp = 1.0;
        for (var k = 0; k < 8; k = k + 1) { s.ramp[k] = textureSampleLevel(texAux, materialSampler, vec2<f32>((f32(k) + 0.5) / 8.0, 0.5), 0.0).r; }
      }
    }
    var lit = shadeLights(s, in.worldPos, in.clip.xy, 1.0 / in.clip.w);
    if (HAS_ENV_MAP || scene.env.w > 0.5) { lit += iblDiffuseAt(sh.N) * base.rgb * intensity * occlusion; }
    else { lit += hemisphereAmbient(sh.N) * base.rgb * occlusion; }
    lit += emissive;
    lit = applyFog(lit, in.clip.xy, 1.0 / in.clip.w);
    return vec4<f32>(outputColor(lit), alpha);
  }

  // ---- physically based model with the glTF extensions ----
  let NoV = max(dot(s.N, V), 1e-4);
  if HAS_SPECULAR {
    let e4 = ext(m, 4u); let e5 = ext(m, 5u);
    let iorF0 = pow((e4.z - 1.0) / (e4.z + 1.0), 2.0);
    let dielectric = min(vec3<f32>(iorF0) * e5.rgb, vec3<f32>(1.0)) * e5.w;
    s.f0 = mix(dielectric, base.rgb, metallic);
    s.f90 = mix(e5.w, 1.0, metallic);
  }
  if HAS_IRIDESCENCE {
    let e3 = ext(m, 3u);
    let film = evalIridescence(1.0, e3.y, NoV, e3.w, s.f0);
    s.f0 = mix(s.f0, film, e3.x);
  }
  if HAS_ANISOTROPY {
    let e4 = ext(m, 4u);
    let c = cos(e4.y); let sn = sin(e4.y);
    s.T = normalize(sh.T * c + sh.B * sn);
    s.B = normalize(cross(s.N, s.T));
    s.aniso = clamp(e4.x, -1.0, 1.0);
  }
  var coatMul = 1.0; var transMul = 1.0; var thickMul = 1.0; var coatRoughMul = 1.0;
  if HAS_EXT_MAP {
    let x = textureSample(texAux, materialSampler, uv);
    coatMul = x.r; coatRoughMul = x.g; transMul = x.b; thickMul = x.a;
  }
  if HAS_CLEARCOAT {
    let e1 = ext(m, 1u);
    s.clearcoat = clamp(e1.x * coatMul, 0.0, 1.0);
    s.ccRoughness = clamp(e1.y * coatRoughMul, 0.04, 1.0);
  }
  if HAS_SHEEN {
    let e2 = ext(m, 2u);
    s.sheenColor = e2.rgb;
    s.sheenRoughness = clamp(e2.w, 0.03, 1.0);
  }
  var transmission = 0.0;
  if HAS_TRANSMISSION {
    transmission = clamp(ext(m, 1u).z * transMul, 0.0, 1.0) * (1.0 - metallic);
    s.diffuseColor = s.diffuseColor * (1.0 - transmission);        // the transmitted share replaces the diffuse share (specular stays)
  }

  var color = shadeLights(s, in.worldPos, in.clip.xy, 1.0 / in.clip.w);
  // Ambient: split-sum IBL when an environment is bound, otherwise the hemisphere term from ambient lights.
  if (HAS_ENV_MAP || scene.env.w > 0.5) {
    color += evaluateIBLExt(s, occlusion, intensity);
  } else {
    color += hemisphereAmbient(sh.N) * s.diffuseColor * occlusion;
  }

  if HAS_TRANSMISSION {
    // Refraction through the surface: bend the view ray (per colour channel with dispersion), look up the environment along it,
    // absorb by the thickness of the medium (Beer-Lambert), tint by the base colour, and remove what the surface reflects.
    let e1 = ext(m, 1u); let e4 = ext(m, 4u); let e6 = ext(m, 6u);
    let thickness = e1.w * thickMul * in.modelScale;
    let ior = e4.z;
    let roughRefr = clamp(s.roughness * clamp(ior * 2.0 - 2.0, 0.0, 1.0), 0.0, 1.0);
    var transmitted: vec3<f32>;
    if HAS_DISPERSION {
      let spread = (ior - 1.0) * 0.025 * e4.w;
      let iors = vec3<f32>(ior - spread, ior, ior + spread);
      var rr = refract(-V, s.N, 1.0 / iors.x); if (dot(rr, rr) < 1e-6) { rr = reflect(-V, s.N); }
      var rg = refract(-V, s.N, 1.0 / iors.y); if (dot(rg, rg) < 1e-6) { rg = reflect(-V, s.N); }
      var rb = refract(-V, s.N, 1.0 / iors.z); if (dot(rb, rb) < 1e-6) { rb = reflect(-V, s.N); }
      transmitted = vec3<f32>(refractedLight(in.worldPos, rr, thickness, roughRefr).r, refractedLight(in.worldPos, rg, thickness, roughRefr).g, refractedLight(in.worldPos, rb, thickness, roughRefr).b);
    } else {
      var r = refract(-V, s.N, 1.0 / ior);
      if (dot(r, r) < 1e-6) { r = reflect(-V, s.N); }
      transmitted = refractedLight(in.worldPos, r, thickness, roughRefr);
    }
    if HAS_VOLUME {
      if (e6.w > 0.0) {
        let pathLen = thickness / max(abs(dot(s.N, V)), 0.2);
        transmitted = transmitted * pow(max(e6.rgb, vec3<f32>(1e-4)), vec3<f32>(pathLen / e6.w));
      }
    }
    let ab = textureSampleLevel(brdfLut, envSampler, vec2<f32>(NoV, s.roughness), 0.0).rg;
    let reflectance = s.f0 * ab.x + vec3<f32>(s.f90 * ab.y);
    color += transmission * transmitted * base.rgb * (vec3<f32>(1.0) - reflectance) * intensity;
  }

  color += emissive;
  color = applyFog(color, in.clip.xy, 1.0 / in.clip.w);
  return vec4<f32>(outputColor(color), alpha);
}

// Depth-only fragment stage for alpha-masked casters in shadow passes.
@fragment
fn fs_shadow(in: VSOut) {
  let m = materials[in.materialIndex];
  var a = textureSample(texBaseColor, materialSampler, in.uv).a * m.baseColor.a;
  if HAS_ALPHA_MAP { a = a * textureSample(texAlpha, materialSampler, in.uv).g; }
  if ALPHA_MASK {
    if (a < m.alphaCutoff) { discard; }
  }
}

// Octahedral encoding of a unit vector into [-1, 1]^2.
fn octEncode(n: vec3<f32>) -> vec2<f32> {
  let p = n.xy / (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.z >= 0.0) { return p; }
  return (vec2<f32>(1.0) - abs(p.yx)) * vec2<f32>(select(-1.0, 1.0, p.x >= 0.0), select(-1.0, 1.0, p.y >= 0.0));
}

// Surface data for screen-space effects (SSAO / SSR), drawn after the main pass: rg = octahedral VIEW-space normal in [0, 1],
// b = roughness, a = 0.5 + 0.5 * metallic (a >= 0.5 marks a written pixel; the target is cleared to a = 0).
@fragment
fn fs_aux(in: VSOut, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4<f32> {
  let m = materials[in.materialIndex];
  let sh = computeShading(in, frontFacing, m);
  if ALPHA_MASK {
    var a = textureSample(texBaseColor, materialSampler, sh.uv).a * m.baseColor.a;
    if HAS_ALPHA_MAP { a = a * textureSample(texAlpha, materialSampler, sh.uv).g; }
    if (a < m.alphaCutoff) { discard; }
  }
  let mr = textureSample(texMetalRough, materialSampler, sh.uv);
  let metallic = clamp(m.metallic * mr.b, 0.0, 1.0);
  let roughness = clamp(m.roughness * mr.g, 0.0, 1.0);
  let nv = normalize((frame.view * vec4<f32>(sh.N, 0.0)).xyz);
  return vec4<f32>(octEncode(nv) * 0.5 + vec2<f32>(0.5), roughness, 0.5 + 0.5 * metallic);
}
