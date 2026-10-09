// Material records AND custom parameters share this one buffer (see paramVec4 below).
@group(2) @binding(0) var<storage, read> materials: array<MaterialRecord>;
@group(2) @binding(1) var materialSampler: sampler;
@group(2) @binding(2) var texBaseColor: texture_2d<f32>;
@group(2) @binding(3) var texMetalRough: texture_2d<f32>;
@group(2) @binding(4) var texNormal: texture_2d<f32>;
@group(2) @binding(5) var texOcclusion: texture_2d<f32>;
@group(2) @binding(6) var texEmissive: texture_2d<f32>;
@group(2) @binding(7) var texHeight: texture_2d<f32>;       // R = height (bump / parallax / displacement)
@group(2) @binding(8) var texAlpha: texture_2d<f32>;        // G = alpha
@group(2) @binding(9) var texAux: texture_2d<f32>;          // matcap image, toon ramp, or packed (clearcoat, clearcoat roughness, transmission, thickness)
@group(2) @binding(10) var texEnv: texture_cube<f32>;       // per-material prefiltered environment (mips = roughness)

// Custom-material parameters live in the SAME storage buffer as the material records (one binding): the parameter region is
// addressed in vec4s and each 64-byte record is viewed as four vec4s. `i` is an absolute vec4 index (materials[].paramBase + slot).
fn paramVec4(i: u32) -> vec4<f32> {
  let r = materials[i >> 2u];
  switch (i & 3u) {
    case 0u: { return r.baseColor; }
    case 1u: { return r.emissive; }
    case 2u: { return vec4<f32>(r.metallic, r.roughness, r.normalScale, r.occlusionStrength); }
    default: { return vec4<f32>(r.alphaCutoff, bitcast<f32>(r.flags), bitcast<f32>(r.paramBase), bitcast<f32>(r._pad)); }
  }
}
