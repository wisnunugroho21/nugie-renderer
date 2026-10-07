@group(2) @binding(0) var<storage, read> materials: array<MaterialRecord>;
@group(2) @binding(1) var<storage, read> customParams: array<vec4<f32>>;
@group(2) @binding(2) var materialSampler: sampler;
@group(2) @binding(3) var texBaseColor: texture_2d<f32>;
@group(2) @binding(4) var texMetalRough: texture_2d<f32>;
@group(2) @binding(5) var texNormal: texture_2d<f32>;
@group(2) @binding(6) var texOcclusion: texture_2d<f32>;
@group(2) @binding(7) var texEmissive: texture_2d<f32>;
