@group(1) @binding(0) var<uniform> scene: Scene;
@group(1) @binding(1) var<storage, read> lights: array<Light>;
@group(1) @binding(2) var<storage, read> clusterGrid: array<vec2<u32>>;          // per cluster: (offset into clusterIndices, light count)
@group(1) @binding(3) var<storage, read> clusterIndices: array<u32>;
@group(1) @binding(4) var<storage, read> shadowMatrices: array<mat4x4<f32>>;     // light view-projection per shadow slice
@group(1) @binding(5) var shadowMap: texture_depth_2d_array;
@group(1) @binding(6) var shadowSampler: sampler_comparison;
@group(1) @binding(7) var envIrradiance: texture_cube<f32>;                       // diffuse irradiance
@group(1) @binding(8) var envSpecular: texture_cube<f32>;                         // prefiltered radiance (mip = roughness)
@group(1) @binding(9) var brdfLut: texture_2d<f32>;                               // split-sum scale/bias
@group(1) @binding(10) var envSampler: sampler;
@group(1) @binding(11) var ltcMatrix: texture_2d<f32>;                            // LTC inverse-matrix table (area lights)
@group(1) @binding(12) var transmissionTex: texture_2d<f32>;                      // opaque scene colour (HDR, with mips) for screen-space refraction
@group(1) @binding(13) var fogVolume: texture_3d<f32>;                             // rgb = in-scattered light, a = transmittance (accumulated from the camera)                         // LTC magnitude / fresnel table
