// Volumetric fog: one thread per screen column of froxels (x, y), marching front to back through the exponential depth slices.
// For every froxel: height-exponential density, in-scattered light from the directional / ranged lights (shadow-mapped, with the
// Henyey-Greenstein phase function) plus an ambient term; the result is the scattering and transmittance ACCUMULATED from the camera
// to the end of that slice, so shading just does  color * T + S  with one 3D texture lookup.
//#include scene_eval

struct VolParams {
  camWorld: mat4x4<f32>,   // camera world matrix (inverse of the view matrix)
  dims: vec4<u32>,         // xyz = froxel counts, w = tile size in pixels
  screen: vec4<f32>,       // x = width, y = height, z = near, w = volume far
  proj: vec4<f32>,         // x = projection[0][0], y = projection[1][1]
};

@group(2) @binding(0) var<uniform> vp: VolParams;
@group(2) @binding(1) var volOut: texture_storage_3d<rgba16float, write>;

fn hgPhase(g: f32, cosTheta: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4), 1.5));
}

fn inScatter(light: Light, P: vec3<f32>, viewDir: vec3<f32>, zc: f32) -> vec3<f32> {
  let kind = u32(light.directionType.w + 0.5);
  if (kind == LIGHT_AREA) { return vec3<f32>(0.0); }
  var L = vec3<f32>(0.0, 1.0, 0.0);
  let radiance = lightRadiance(light, P, &L);
  if (dot(radiance, radiance) <= 0.0) { return vec3<f32>(0.0); }
  var vis = 1.0;
  if (light.spot.z >= 0.0) { vis = shadowVisibility(light, P, vec3<f32>(0.0), zc); }
  return radiance * (vis * hgPhase(scene.fogParams.z, dot(L, viewDir)));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = vp.dims.xyz;
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let tile = f32(vp.dims.w);
  let px = (f32(id.x) + 0.5) * tile;
  let py = (f32(id.y) + 0.5) * tile;
  let nx = 2.0 * px / vp.screen.x - 1.0;
  let ny = 1.0 - 2.0 * py / vp.screen.y;
  let near = vp.screen.z; let far = vp.screen.w;
  let ratio = far / near;
  let camPos = vp.camWorld[3].xyz;
  let total = scene.counts.x;
  let globalN = min(scene.counts.y, total);
  var acc = vec3<f32>(0.0);
  var trans = 1.0;
  for (var k = 0u; k < dims.z; k = k + 1u) {
    let z0 = near * pow(ratio, f32(k) / f32(dims.z));
    let z1 = near * pow(ratio, f32(k + 1u) / f32(dims.z));
    let zc = sqrt(z0 * z1);
    let viewPos = vec3<f32>(nx / vp.proj.x * zc, ny / vp.proj.y * zc, -zc);
    let world = (vp.camWorld * vec4<f32>(viewPos, 1.0)).xyz;
    let rayLen = length(viewPos) / zc;               // path length per unit of view depth
    let viewDir = normalize(world - camPos);
    let dens = scene.fogParams.x * exp(-scene.fogParams.y * max(world.y, 0.0));
    let dz = (z1 - z0) * rayLen;
    var s = scene.fogColor.rgb;                      // ambient in-scatter
    for (var i = 0u; i < globalN; i = i + 1u) { s += inScatter(lights[i], world, viewDir, zc); }
    if (scene.clusterGrid.w == 1u) {
      let cell = clusterGrid[clusterIndexOf(vec2<f32>(px, py), zc)];
      for (var j = 0u; j < cell.y; j = j + 1u) { s += inScatter(lights[clusterIndices[cell.x + j]], world, viewDir, zc); }
    } else {
      for (var i = globalN; i < total; i = i + 1u) { s += inScatter(lights[i], world, viewDir, zc); }
    }
    let stepT = exp(-dens * dz);
    // integral of T(s) * sigma * S ds over the slice for constant sigma = S * (1 - stepT)
    acc += trans * s * (1.0 - stepT);
    trans = trans * stepT;
    textureStore(volOut, vec3<i32>(i32(id.x), i32(id.y), i32(k)), vec4<f32>(acc, trans));
  }
}
