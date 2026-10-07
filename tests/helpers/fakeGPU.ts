import { GPUResources } from '../../src/gpu/GPUResources';
import { MeshManager } from '../../src/rendering/MeshManager';
import { MaterialManager } from '../../src/rendering/materials/MaterialManager';
import { JointMatrixBuffer } from '../../src/rendering/JointMatrixBuffer';
import { World } from '../../src/ecs/World';
import type { BindLayouts } from '../../src/gpu/BindLayouts';

/** Install WebGPU usage-flag globals used by the engine in a Node environment. */
export function installGPUGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  g.GPUBufferUsage = { COPY_DST: 8, COPY_SRC: 4, VERTEX: 32, INDEX: 16, UNIFORM: 64, STORAGE: 128, MAP_READ: 1 };
  g.GPUTextureUsage = { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
  g.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
}

export interface BufferWrite { label: string; offset: number; bytes: number }

/** A recording fake GPUDevice + the engine managers built on it (no real GPU needed). */
export function makeFakeGPU() {
  installGPUGlobals();
  const writes: BufferWrite[] = [];
  const device = {
    queue: {
      writeBuffer: (b: { label: string }, offset: number, _d: unknown, _o: number, size: number) => writes.push({ label: b.label, offset, bytes: size }),
      writeTexture() {}, submit() {},
    },
    createBuffer: (d: { label: string; size: number }) => ({ label: d.label, size: d.size, destroy() {} }),
    createTexture: () => ({ createView: () => ({}), destroy() {} }),
    createSampler: () => ({}), createShaderModule: () => ({}), createBindGroup: () => ({}),
    createRenderPipeline: () => ({}), pushErrorScope() {}, popErrorScope: () => Promise.resolve(null),
    createCommandEncoder: () => ({ copyBufferToBuffer() {}, finish: () => ({}) }),
  } as unknown as GPUDevice;
  const res = new GPUResources(device);
  const world = new World();
  return {
    device, res, world, writes,
    meshes: new MeshManager(device, res.buffers),
    materials: new MaterialManager(device, res, {} as BindLayouts),
    joints: new JointMatrixBuffer(device, res.buffers),
  };
}
