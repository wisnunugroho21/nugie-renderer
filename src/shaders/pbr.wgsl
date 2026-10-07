// glTF metallic-roughness PBR + emissive. One shader, small variant set via defines:
//   ALPHA_MASK, HAS_NORMAL_MAP  (everything else is runtime material data)
//
// (lighting pulls in the shared BRDF core)
//#include common
//#include lighting
//#include ibl_eval

struct VSOut {
  @builtin(position) @invariant clip: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldNormal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) worldTangent: vec4<f32>,
  @location(4) @interpolate(flat) materialIndex: u32,
};

@vertex
fn vs_main(in: VertexInput) -> VSOut {
  var out: VSOut;
  let inst = instances[in.instance];
  let model = transforms[inst.transformIndex];
  let d = deformVertex(inst, in.vertexIndex, in.position, in.normal, in.tangent.xyz);
  let world = model * vec4<f32>(d.position, 1.0);
  let nm = normalMatrix(model);
  out.clip = frame.viewProjection * world;
  out.worldPos = world.xyz;
  out.worldNormal = nm * d.normal;
  out.worldTangent = vec4<f32>(mat3x3<f32>(model[0].xyz, model[1].xyz, model[2].xyz) * d.tangent, in.tangent.w);
  out.uv = in.uv;
  out.materialIndex = inst.materialIndex;
  return out;
}

@fragment
fn fs_main(in: VSOut, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4<f32> {
  let m = materials[in.materialIndex];
  let base = textureSample(texBaseColor, materialSampler, in.uv) * m.baseColor;

  if ALPHA_MASK {
    if (base.a < m.alphaCutoff) { discard; }
  }

  let mr = textureSample(texMetalRough, materialSampler, in.uv);
  let metallic = clamp(m.metallic * mr.b, 0.0, 1.0);
  let roughness = m.roughness * mr.g;
  let occlusion = 1.0 + m.occlusionStrength * (textureSample(texOcclusion, materialSampler, in.uv).r - 1.0);

  var N = normalize(in.worldNormal);
  if (!frontFacing) { N = -N; } // double-sided back faces
  if HAS_NORMAL_MAP {
    // Derivatives must be taken in uniform control flow, so compute them before any branching.
    let dp1 = dpdx(in.worldPos); let dp2 = dpdy(in.worldPos);
    let duv1 = dpdx(in.uv); let duv2 = dpdy(in.uv);
    var T: vec3<f32>;
    var B: vec3<f32>;
    if (in.worldTangent.w != 0.0) {
      T = normalize(in.worldTangent.xyz - N * dot(N, in.worldTangent.xyz));
      B = cross(N, T) * in.worldTangent.w;
    } else {
      // Derivative-based cotangent frame for meshes without tangents.
      let dp2perp = cross(dp2, N); let dp1perp = cross(N, dp1);
      let t = dp2perp * duv1.x + dp1perp * duv2.x;
      let b = dp2perp * duv1.y + dp1perp * duv2.y;
      let invmax = inverseSqrt(max(dot(t, t), dot(b, b)));
      T = t * invmax; B = -b * invmax; // bitangent toward image-up (decreasing V), matching glTF tangents
    }
    if (!frontFacing) { T = -T; B = -B; }
    let tn = textureSample(texNormal, materialSampler, in.uv).xyz * 2.0 - 1.0;
    N = normalize(T * tn.x * m.normalScale + B * tn.y * m.normalScale + N * tn.z);
  }

  let V = normalize(frame.cameraPosition.xyz - in.worldPos);
  let s = makeSurface(base.rgb, metallic, roughness, N, V);

  // Direct lighting: global lights + (clustered) ranged lights.
  var color = shadeLights(s, in.worldPos, in.clip.xy, 1.0 / in.clip.w);   // position.w in a fragment shader is 1 / clip.w
  // Ambient: split-sum IBL when an environment is bound, otherwise the hemisphere term from ambient lights.
  if (scene.env.w > 0.5) {
    color += evaluateIBL(s, occlusion);
  } else {
    let hemi = mix(scene.ambientGround.rgb, scene.ambientSky.rgb, N.y * 0.5 + 0.5);
    color += hemi * s.diffuseColor * occlusion;
  }

  // Emissive is HDR and NOT a light source.
  let emissive = textureSample(texEmissive, materialSampler, in.uv).rgb * m.emissive.rgb * m.emissive.w;
  color += emissive;

  color = applyFog(color, in.clip.xy, 1.0 / in.clip.w);

  var alpha = 1.0;
  if ALPHA_BLEND { alpha = base.a; }
  return vec4<f32>(linearToSrgb(tonemapACES(color)), alpha);
}

// Depth-only fragment stage for alpha-masked casters in shadow passes.
@fragment
fn fs_shadow(in: VSOut) {
  let m = materials[in.materialIndex];
  let a = textureSample(texBaseColor, materialSampler, in.uv).a * m.baseColor.a;
  if ALPHA_MASK {
    if (a < m.alphaCutoff) { discard; }
  }
}
