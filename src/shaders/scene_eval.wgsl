// Scene-aware lighting (IBL, area lights, shadows, clusters, fog). Needs only the frame + scene bind groups, so compute
// shaders (volumetric fog) can use it without the material / object groups.
//#include common_types
//#include common_bind_frame
//#include common_bind_scene
//#include lighting

fn rotateY(d: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a); let sn = sin(a);
  return vec3<f32>(c * d.x + sn * d.z, d.y, -sn * d.x + c * d.z);
}

// Image-based lighting (split-sum): diffuse irradiance + prefiltered specular * (F0 * A + B).
fn evaluateIBL(s: SurfaceInfo, occlusion: f32) -> vec3<f32> {
  let NoV = max(dot(s.N, s.V), 1e-4);
  let R = reflect(-s.V, s.N);
  let rot = -scene.env.y;
  let irradiance = textureSampleLevel(envIrradiance, envSampler, rotateY(s.N, rot), 0.0).rgb;
  let lod = s.roughness * (scene.env.z - 1.0);
  let prefiltered = textureSampleLevel(envSpecular, envSampler, rotateY(R, rot), lod).rgb;
  let ab = textureSampleLevel(brdfLut, envSampler, vec2<f32>(NoV, s.roughness), 0.0).rg;
  let specular = prefiltered * (s.f0 * ab.x + vec3<f32>(ab.y * s.f90));
  return (irradiance * s.diffuseColor + specular) * scene.env.x * occlusion;
}

// LTC table lookup: x = perceptual roughness, y = sqrt(1 - NoV); texel centres map to [0, 1] exactly.
fn ltcLookup(roughness: f32, NoV: f32) -> vec3<f32> {
  let size = 32.0;
  let uv = (vec2<f32>(roughness, sqrt(1.0 - clamp(NoV, 0.0, 1.0))) * (size - 1.0) + 0.5) / size;
  return textureSampleLevel(ltcMatrix, envSampler, uv, 0.0).xyz;
}

fn shadeArea(light: Light, s: SurfaceInfo, P: vec3<f32>) -> vec3<f32> {
  let radiance = light.colorIntensity.rgb * light.colorIntensity.w;
  if (s.model != 0u) { return s.diffuseColor * areaFormFactor(light, P, s.N) * radiance; }   // Lambert / Phong / Toon: diffuse only
  let NoV = max(dot(s.N, s.V), 1e-3);
  let ab = textureSampleLevel(brdfLut, envSampler, vec2<f32>(NoV, s.roughness), 0.0).rg;
  let specColor = s.f0 * ab.x + vec3<f32>(ab.y * s.f90);
  let spec = specColor * areaSpecularFraction(light, s.N, s.V, P, ltcLookup(s.roughness, NoV));
  let diffuse = s.diffuseColor * (vec3<f32>(1.0) - specColor) * areaFormFactor(light, P, s.N);
  return (diffuse + spec) * radiance;
}

// Shading of one light from the Light buffer (any type).
fn shadePunctual(light: Light, s: SurfaceInfo, P: vec3<f32>) -> vec3<f32> {
  if (u32(light.directionType.w + 0.5) == LIGHT_AREA) { return shadeArea(light, s, P); }
  return shadePointLike(light, s, P);
}


// ---- Shadows ------------------------------------------------------------------------------------------------------
// light.spot.z = first shadow-map layer (< 0: none). Directional: cascaded (layer + cascade); spot: one layer.
// light.up holds per-cascade texel world sizes (directional) or tan(half fov) in .x (spot) for the normal offset.
fn sampleShadowLayer(layer: u32, P: vec3<f32>, N: vec3<f32>, texelWorld: f32, softness: f32) -> f32 {
  let Pn = P + N * (texelWorld * scene.shadow.z);
  let c = shadowMatrices[layer] * vec4<f32>(Pn, 1.0);
  let ndc = c.xyz / c.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z > 1.0 || ndc.z < 0.0) { return 1.0; }
  let refDepth = ndc.z - scene.shadowParams.y;
  let step = scene.shadow.y * softness / scene.shadowParams.x;
  var sum = 0.0;
  for (var dy = -1; dy <= 1; dy = dy + 1) {
    for (var dx = -1; dx <= 1; dx = dx + 1) {
      sum += textureSampleCompareLevel(shadowMap, shadowSampler, uv + vec2<f32>(f32(dx), f32(dy)) * step, i32(layer), refDepth);
    }
  }
  return sum / 9.0;
}

fn shadowVisibility(light: Light, P: vec3<f32>, N: vec3<f32>, viewZ: f32) -> f32 {
  if (light.spot.z < 0.0 || scene.shadow.w < 0.5) { return 1.0; }
  let base = u32(light.spot.z + 0.5);
  if (u32(light.directionType.w + 0.5) == LIGHT_DIRECTIONAL) {
    let n = u32(scene.shadow.x);
    var c = 0u;
    while (c < n && viewZ > scene.cascadeSplits[c]) { c = c + 1u; }
    if (c >= n) { return 1.0; }
    // blend into the next cascade (or fade to unshadowed past the last one) over the final 10% of this cascade's range
    var vis = sampleShadowLayer(base + c, P, N, light.up[c], 1.0);
    let split = scene.cascadeSplits[c];
    let t = clamp((viewZ - split * 0.9) / (split * 0.1), 0.0, 1.0);
    if (t > 0.0) {
      if (c + 1u < n) { vis = mix(vis, sampleShadowLayer(base + c + 1u, P, N, light.up[c + 1u], 1.0), t); }
      else { vis = mix(vis, 1.0, t); }
    }
    return vis;
  }
  let dist = distance(P, light.positionRange.xyz);
  var layer = base;
  let kind = u32(light.directionType.w + 0.5);
  if (kind == LIGHT_POINT || kind == LIGHT_AREA) {
    // cube shadow: six 2D layers (+X -X +Y -Y +Z -Z); pick the face of the major axis of the light -> point vector
    let d = P - light.positionRange.xyz;
    let a = abs(d);
    var face = 4u;
    if (a.x >= a.y && a.x >= a.z) { face = select(1u, 0u, d.x >= 0.0); }
    else if (a.y >= a.z) { face = select(3u, 2u, d.y >= 0.0); }
    else { face = select(5u, 4u, d.z >= 0.0); }
    layer = base + face;
  }
  if (kind == LIGHT_AREA) {
    // area light: the cube map is rendered from the light centre; the penumbra widens with the light's size relative to the distance
    // (tan(half fov) lives in spot.y because the up / right vectors are the rectangle's axes)
    let extent = max(light.right.w, light.up.w);
    let soft = 1.0 + clamp(extent / max(dist, 0.5), 0.0, 2.0) * 3.0;
    return sampleShadowLayer(layer, P, N, 2.0 * dist * light.spot.y / scene.shadowParams.x, soft);
  }
  return sampleShadowLayer(layer, P, N, 2.0 * dist * light.up.x / scene.shadowParams.x, 1.0);
}

// Cluster lookup: tile from the fragment pixel, exponential depth slice from the view-space depth (clip.w).
fn clusterIndexOf(fragXY: vec2<f32>, viewZ: f32) -> u32 {
  let dims = scene.clusterGrid.xyz;
  let tile = scene.clusterDepth.w;
  let tx = min(u32(fragXY.x / tile), dims.x - 1u);
  let ty = min(u32(fragXY.y / tile), dims.y - 1u);
  let sz = u32(clamp(log(max(viewZ, scene.clusterDepth.x) / scene.clusterDepth.x) * scene.clusterDepth.z, 0.0, f32(dims.z - 1u)));
  return (sz * dims.y + ty) * dims.x + tx;
}

fn shadowedLight(light: Light, s: SurfaceInfo, P: vec3<f32>, viewZ: f32) -> vec3<f32> {
  var vis = 1.0;
  if (light.spot.z >= 0.0) { vis = shadowVisibility(light, P, s.N, viewZ); }
  if (vis <= 0.0) { return vec3<f32>(0.0); }
  return shadePunctual(light, s, P) * vis;
}

// Direct lighting from every light that can reach this fragment: the global prefix always, then either this fragment's
// cluster list (clustered shading) or every remaining light (naive loop).
fn shadeLights(s: SurfaceInfo, P: vec3<f32>, fragXY: vec2<f32>, viewZ: f32) -> vec3<f32> {
  // One loop (and so one inlined copy of the shading code): indices 0..globalN-1 are the global lights, the rest come from the cell list or the plain range.
  var color = vec3<f32>(0.0);
  let total = scene.counts.x;
  let globalN = min(scene.counts.y, total);
  let clustered = scene.clusterGrid.w == 1u;
  var cell = vec2<u32>(0u);
  var count = total;
  if (clustered) {
    cell = clusterGrid[clusterIndexOf(fragXY, viewZ)].xy;
    count = globalN + cell.y;
  }
  for (var n = 0u; n < count; n = n + 1u) {
    var li = n;
    if (clustered && n >= globalN) { li = clusterIndices[cell.x + n - globalN]; }
    color += shadowedLight(lights[li], s, P, viewZ);
  }
  return color;
}

// Volumetric fog: color * transmittance + in-scattered light accumulated from the camera to this depth (see volumetric.wgsl).
fn applyFog(color: vec3<f32>, fragXY: vec2<f32>, viewZ: f32) -> vec3<f32> {
  if (scene.fogColor.w < 0.5) { return color; }
  let dims = vec3<f32>(textureDimensions(fogVolume));
  let near = scene.clusterDepth.x;
  let far = scene.fogParams.w;
  let w = clamp(log(max(viewZ, near) / near) / log(far / near), 0.0, 1.0);
  let uv = fragXY / (dims.xy * scene.shadowParams.z);
  let wz = clamp(w - 0.5 / dims.z, 0.0, 1.0);   // texel k holds the integral up to the END of slice k
  let v = textureSampleLevel(fogVolume, envSampler, vec3<f32>(uv, wz), 0.0);
  return color * v.a + v.rgb;
}
