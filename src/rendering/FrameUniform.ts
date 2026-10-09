import type { GPUContext } from '../gpu/GPUContext';
import type { BindLayouts } from '../gpu/BindLayouts';
import type { Camera } from './Camera';

/** Size of the frame uniform (`frame` in common_bind_frame.wgsl): 15 x vec4 = 240 bytes. */
export const FRAME_FLOATS = 60;

/**
 * The per-view uniform behind bind group 0: camera matrices and position, time, viewport, near / far and a few output flags.
 * Layout (floats): 0 viewProjection, 16 view, 32 projection, 48 camera position, 51 time, 52 width, 53 height, 54 near, 55 far,
 * 56 HDR output (1 = linear HDR target, no tone mapping), 57 screen-space transmission available, 58 its mip count, 59 unused.
 * Off-screen views overwrite it while they render; `snapshot` / `restore` bring the main view's values back.
 */
export class FrameUniform {
  readonly buffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  private data = new Float32Array(FRAME_FLOATS);

  /** Create the uniform buffer and the bind group (group 0) that exposes it. */
  constructor(private gpu: GPUContext, layouts: BindLayouts) {
    const { device, resources: r } = gpu;
    this.buffer = r.buffers.create('FrameUniformBuffer', this.data.byteLength, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.bindGroup = device.createBindGroup({ label: 'frame-bg', layout: layouts.frame, entries: [{ binding: 0, resource: { buffer: this.buffer } }] });
  }

  /** Write the view's camera, time and viewport and upload the whole uniform. The transmission flags start cleared (see `setTransmission`). */
  writeView(camera: Camera, time: number, width: number, height: number, hdrOutput: boolean): void {
    const d = this.data;
    d.set(camera.viewProjection, 0); d.set(camera.view, 16); d.set(camera.projection, 32);
    d.set(camera.position, 48); d[51] = time;
    d[52] = width; d[53] = height; d[54] = camera.near; d[55] = camera.far;
    d[56] = hdrOutput ? 1 : 0;
    d[57] = 0; d[58] = 0; d[59] = 0;
    this.gpu.queue.writeBuffer(this.buffer, 0, d);
  }

  /** Tell the shaders whether the opaque-scene copy is available for transmissive materials, and how many mips it has. Uploads only those floats. */
  setTransmission(available: boolean, mipCount: number): void {
    const d = this.data;
    d[57] = available ? 1 : 0; d[58] = available ? mipCount : 0;
    this.gpu.queue.writeBuffer(this.buffer, 57 * 4, d, 57, 3);
  }

  /** A copy of the current values (taken before an off-screen view overwrites them). */
  snapshot(): Float32Array { return this.data.slice(); }

  /** Put a snapshot back and upload it. */
  restore(snapshot: Float32Array): void {
    this.data.set(snapshot);
    this.gpu.queue.writeBuffer(this.buffer, 0, this.data);
  }
}
