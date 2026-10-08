/**
 * Engine bind-group layouts (see src/shaders/common.wgsl for the WGSL side of the contract).
 *   0 Frame    : b0 uniform Frame
 *   1 Scene    : b0 uniform Scene, b1 lights, b2 cluster grid, b3 cluster indices, b4 shadow matrices, b5 shadow map (depth array),
 *                b6 shadow comparison sampler, b7 irradiance cube, b8 specular cube, b9 BRDF LUT, b10 env sampler, b11/b12 LTC tables
 *   2 Material : b0 storage materials (records + custom parameters), b1 sampler, b2..b6 textures
 *   3 Object   : b0 transforms, b1 instances, b2 joint matrices, b3 morph weights, b4 deform data (skin + morph deltas)
 *                (all read-only storage)
 * Vertex stage storage buffers: 5 (object) + 1 (materials) = 6, so the engine runs within the default limit of 8.
 */
export interface BindLayouts {
  frame: GPUBindGroupLayout;
  scene: GPUBindGroupLayout;
  material: GPUBindGroupLayout;
  object: GPUBindGroupLayout;
  /**
   * Same entries as `object` but visible to compute shaders. Kept OUT of `pipelineLayout` on purpose: a pipeline layout is
   * validated per stage; kept separate so compute-only users do not need the render stages' groups.
   * Only the GPU self-tests (WGSL `deformVertex` run as a compute kernel) use it.
   */
  objectCompute: GPUBindGroupLayout;
  /** frame, scene, material, object */
  pipelineLayout: GPUPipelineLayout;
}

export const MATERIAL_TEXTURE_SLOTS = 5;

/** Create the four engine bind-group layouts and the pipeline layout combining them (see the table above). */
export function createBindLayouts(device: GPUDevice): BindLayouts {
  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const frame = device.createBindGroupLayout({
    label: 'layout-frame',
    entries: [{ binding: 0, visibility: VF | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }],
  });
  const F = GPUShaderStage.FRAGMENT;
  // Scene storage buffers are FRAGMENT-only: keeps the vertex stage within its storage-buffer budget (see MIN_VERTEX_STORAGE_BUFFERS).
  const FC = GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;   // compute: volumetric fog reads lights / shadows through this group
  const sro = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: FC, buffer: { type: 'read-only-storage' } });
  /** Fragment-visible 2D float texture binding. */
  const tex2d = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: F, texture: { sampleType: 'float', viewDimension: '2d' } });
  const scene = device.createBindGroupLayout({
    label: 'layout-scene',
    entries: [
      { binding: 0, visibility: VF | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      sro(1), sro(2), sro(3), sro(4),
      { binding: 5, visibility: FC, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
      { binding: 6, visibility: FC, sampler: { type: 'comparison' } },
      { binding: 7, visibility: F, texture: { sampleType: 'float', viewDimension: 'cube' } },
      { binding: 8, visibility: F, texture: { sampleType: 'float', viewDimension: 'cube' } },
      tex2d(9),
      { binding: 10, visibility: F, sampler: { type: 'filtering' } },
      tex2d(11), tex2d(12),
      { binding: 13, visibility: F, texture: { sampleType: 'float', viewDimension: '3d' } },   // volumetric fog
    ],
  });
  /** Fragment-visible 2D float material texture binding. */
  const tex = (binding: number): GPUBindGroupLayoutEntry => ({
    binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' },
  });
  const material = device.createBindGroupLayout({
    label: 'layout-material',
    entries: [
      { binding: 0, visibility: VF, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      tex(2), tex(3), tex(4), tex(5), tex(6),
    ],
  });
  // Object-group data is consumed by the vertex stage only; fragment shaders get per-instance values via varyings.
  const objectEntries = (visibility: number): GPUBindGroupLayoutEntry[] =>
    Array.from({ length: 5 }, (_, binding) => ({ binding, visibility, buffer: { type: 'read-only-storage' } }));
  const object = device.createBindGroupLayout({ label: 'layout-object', entries: objectEntries(GPUShaderStage.VERTEX) });
  const objectCompute = device.createBindGroupLayout({ label: 'layout-object-compute', entries: objectEntries(GPUShaderStage.COMPUTE) });
  const pipelineLayout = device.createPipelineLayout({
    label: 'engine-pipeline-layout',
    bindGroupLayouts: [frame, scene, material, object],
  });
  return { frame, scene, material, object, objectCompute, pipelineLayout };
}
