@group(3) @binding(0) var<storage, read> transforms: array<mat4x4<f32>>;
@group(3) @binding(1) var<storage, read> instances: array<Instance>;
@group(3) @binding(2) var<storage, read> jointMatrices: array<vec4<f32>>;   // 3 rows (m_r0 m_r1 m_r2 t_r) per joint: affine 3x4, see JointMatrixBuffer
// ACTIVE morph targets only, as (targetIndex, weight bits) u32 pairs; instance.morphTargetCount = number of pairs.
@group(3) @binding(3) var<storage, read> morphWeights: array<u32>;
// ONE arena for all per-vertex deformation data (16 B elements, read as raw u32 so no bit pattern is ever interpreted as a float):
//   skin  (instance.skinBase + vertex):                     .xy = joints (u16x4 packed), .zw = weights (unorm16x4 packed)
//   morph (instance.morphBase + (target * vertexCount + vertex) * stride, stride = instance.flags >> 4 & 3): position delta, [normal delta, [tangent delta]] (xyz as f32 bits)
@group(3) @binding(4) var<storage, read> deformData: array<vec4<u32>>;
