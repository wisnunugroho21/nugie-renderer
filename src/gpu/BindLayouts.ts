/**
 * Engine bind-group layouts (see src/shaders/common.wgsl for the WGSL side of the contract).
 *   0 Frame    : b0 uniform Frame
 *   1 Scene    : b0 uniform Scene, b1 lights, b2 cluster grid, b3 cluster indices, b4 shadow matrices, b5 shadow map (depth array),
 *                b6 shadow comparison sampler, b7 irradiance cube, b8 specular cube, b9 BRDF LUT, b10 env sampler, b11/b12 LTC tables
 *   2 Material : b0 storage materials, b1 storage customParams, b2 sampler, b3..b7 textures
 *   3 Object   : b0 transforms, b1 instances, b2 joint matrices, b3 morph weights, b4 skin data,
 *                b5/b6/b7 morph position/normal/tangent deltas (all read-only storage)
 */
export interface BindLayouts {
  frame: GPUBindGroupLayout;
  scene: GPUBindGroupLayout;
  material: GPUBindGroupLayout;
  object: GPUBindGroupLayout;
  /** frame, scene, material, object */
  pipelineLayout: GPUPipelineLayout;
}

export const MATERIAL_TEXTURE_SLOTS = 5;

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
  const tex = (binding: number): GPUBindGroupLayoutEntry => ({
    binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' },
  });
  const material = device.createBindGroupLayout({
    label: 'layout-material',
    entries: [
      { binding: 0, visibility: VF, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: VF, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      tex(3), tex(4), tex(5), tex(6), tex(7),
    ],
  });
  // Object-group data is consumed by vertex (and compute) stages only; fragment shaders get per-instance values via varyings.
  const VC = GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE;
  const ro = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: VC, buffer: { type: 'read-only-storage' } });
  const object = device.createBindGroupLayout({
    label: 'layout-object',
    entries: [ro(0), ro(1), ro(2), ro(3), ro(4), ro(5), ro(6), ro(7)],
  });
  const pipelineLayout = device.createPipelineLayout({
    label: 'engine-pipeline-layout',
    bindGroupLayouts: [frame, scene, material, object],
  });
  return { frame, scene, material, object, pipelineLayout };
}
