@group(3) @binding(0) var<storage, read> transforms: array<mat4x4<f32>>;
@group(3) @binding(1) var<storage, read> instances: array<Instance>;
@group(3) @binding(2) var<storage, read> jointMatrices: array<mat4x4<f32>>;
// ACTIVE morph targets only, as (targetIndex, weight bits) u32 pairs; instance.morphTargetCount = number of pairs.
@group(3) @binding(3) var<storage, read> morphWeights: array<u32>;
// Per vertex (16 B): .xy = joints (u16x4 packed), .zw = weights (unorm16x4 packed)
@group(3) @binding(4) var<storage, read> skinData: array<vec4<u32>>;
@group(3) @binding(5) var<storage, read> morphPositions: array<vec4<f32>>;
@group(3) @binding(6) var<storage, read> morphNormals: array<vec4<f32>>;
@group(3) @binding(7) var<storage, read> morphTangents: array<vec4<f32>>;
