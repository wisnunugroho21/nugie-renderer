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
    for (var k = 0u; k < inst.morphTargetCount; k = k + 1u) {
      let targetIdx = morphWeights[inst.morphWeightOffset + k * 2u];
      let w = bitcast<f32>(morphWeights[inst.morphWeightOffset + k * 2u + 1u]);
      let idx = inst.morphBase + targetIdx * inst.vertexCount + local;
      p = p + morphPositions[idx].xyz * w;
      n = n + morphNormals[idx].xyz * w;
      t = t + morphTangents[idx].xyz * w;
    }
    n = normalize(n);
    if (dot(t, t) > 0.0) { t = normalize(t); }
  }

  if HAS_SKINNING {
    if (inst.jointCount > 0u) {
      let sd = skinData[inst.skinBase + local];
      let skin =
          jointMatrices[inst.jointOffset + skinJoint(sd.x, false)] * skinWeight(sd.z, false)
        + jointMatrices[inst.jointOffset + skinJoint(sd.x, true)] * skinWeight(sd.z, true)
        + jointMatrices[inst.jointOffset + skinJoint(sd.y, false)] * skinWeight(sd.w, false)
        + jointMatrices[inst.jointOffset + skinJoint(sd.y, true)] * skinWeight(sd.w, true);
      p = (skin * vec4<f32>(p, 1.0)).xyz;
      n = normalize((skin * vec4<f32>(n, 0.0)).xyz);
      if (dot(t, t) > 0.0) { t = normalize((skin * vec4<f32>(t, 0.0)).xyz); }
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
