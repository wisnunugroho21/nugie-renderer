//#include common_color

// ---------------------------------------------------------------------------------------------
// Vertex deformation: base vertex -> morph targets -> skinning. ONE implementation shared by the
// main, depth and shadow passes (and any custom vertex shader that calls deformVertex()).
// The result is in mesh space; the caller applies the model matrix afterwards.
//   jointMatrix = inverse(meshWorld) * jointWorld * inverseBind   (computed on the CPU)
// HAS_MORPH_TARGETS / HAS_SKINNING are per-pipeline constants (set by the engine).
// ---------------------------------------------------------------------------------------------
struct DeformedVertex {
  position: vec3<f32>,
  normal: vec3<f32>,
  tangent: vec3<f32>,
};

fn skinJoint(packed: u32, high: bool) -> u32 {
  return select(packed & 0xffffu, packed >> 16u, high);
}

fn skinWeight(packed: u32, high: bool) -> f32 {
  return f32(select(packed & 0xffffu, packed >> 16u, high)) / 65535.0;
}

fn deformVertex(inst: Instance, vertexIndex: u32, position: vec3<f32>, normal: vec3<f32>, tangent: vec3<f32>) -> DeformedVertex {
  var p = position;
  var n = normal;
  var t = tangent;
  let local = vertexIndex - inst.vertexBase;

  if HAS_MORPH_TARGETS {
    // Only ACTIVE targets are listed (CPU-compacted): cost scales with active targets, not total targets.
    // Deltas are stored per vertex as position [, normal [, tangent]]: only the attributes the mesh has are fetched (stride 1..3).
    let stride = (inst.flags >> 4u) & 3u;
    for (var k = 0u; k < inst.morphTargetCount; k = k + 1u) {
      let targetIdx = morphWeights[inst.morphWeightOffset + k * 2u];
      let w = bitcast<f32>(morphWeights[inst.morphWeightOffset + k * 2u + 1u]);
      let idx = inst.morphBase + (targetIdx * inst.vertexCount + local) * stride;
      p = p + bitcast<vec4<f32>>(deformData[idx]).xyz * w;
      if (stride > 1u) { n = n + bitcast<vec4<f32>>(deformData[idx + 1u]).xyz * w; }
      if (stride > 2u) { t = t + bitcast<vec4<f32>>(deformData[idx + 2u]).xyz * w; }
    }
    n = normalize(n);
    if (dot(t, t) > 0.0) { t = normalize(t); }
  }

  if HAS_SKINNING {
    if (inst.jointCount > 0u) {
      let sd = deformData[inst.skinBase + local];
      // blend the four joints' affine rows (row r of joint j is jointMatrices[(jointOffset + j) * 3 + r])
      let j0 = (inst.jointOffset + skinJoint(sd.x, false)) * 3u; let w0 = skinWeight(sd.z, false);
      let j1 = (inst.jointOffset + skinJoint(sd.x, true)) * 3u;  let w1 = skinWeight(sd.z, true);
      let j2 = (inst.jointOffset + skinJoint(sd.y, false)) * 3u; let w2 = skinWeight(sd.w, false);
      let j3 = (inst.jointOffset + skinJoint(sd.y, true)) * 3u;  let w3 = skinWeight(sd.w, true);
      let r0 = jointMatrices[j0] * w0 + jointMatrices[j1] * w1 + jointMatrices[j2] * w2 + jointMatrices[j3] * w3;
      let r1 = jointMatrices[j0 + 1u] * w0 + jointMatrices[j1 + 1u] * w1 + jointMatrices[j2 + 1u] * w2 + jointMatrices[j3 + 1u] * w3;
      let r2 = jointMatrices[j0 + 2u] * w0 + jointMatrices[j1 + 2u] * w1 + jointMatrices[j2 + 2u] * w2 + jointMatrices[j3 + 2u] * w3;
      let ph = vec4<f32>(p, 1.0);
      p = vec3<f32>(dot(r0, ph), dot(r1, ph), dot(r2, ph));
      n = normalize(vec3<f32>(dot(r0.xyz, n), dot(r1.xyz, n), dot(r2.xyz, n)));
      if (dot(t, t) > 0.0) { t = normalize(vec3<f32>(dot(r0.xyz, t), dot(r1.xyz, t), dot(r2.xyz, t))); }
    }
  }

  var out: DeformedVertex;
  out.position = p;
  out.normal = n;
  out.tangent = t;
  return out;
}

fn getModelMatrix(instance: u32) -> mat4x4<f32> {
  return transforms[instances[instance].transformIndex];
}

// Normal matrix for uniform / non-uniform scale (inverse-transpose of the 3x3).
fn normalMatrix(m: mat4x4<f32>) -> mat3x3<f32> {
  let a = m[0].xyz; let b = m[1].xyz; let c = m[2].xyz;
  return mat3x3<f32>(cross(b, c), cross(c, a), cross(a, b));
}
