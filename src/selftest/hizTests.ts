import type { GPUContext } from '../gpu/GPUContext';
import { HiZ } from '../rendering/HiZ';
import { readBuffer, type SelfTest } from './harness';

const DEPTH_WGSL = /* wgsl */ `
struct VSOut { @builtin(position) p: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: VSOut; o.p = vec4<f32>(p, 0.0, 1.0); o.uv = p * 0.5 + 0.5; return o;
}
@fragment fn fs(in: VSOut) -> @builtin(frag_depth) f32 {
  return fract(in.uv.x * 7.3 + in.uv.y * 3.1) * 0.9 + 0.05;
}`;

async function readR32(gpu: GPUContext, tex: GPUTexture, mip: number): Promise<{ w: number; h: number; px: Float32Array }> {
  const w = Math.max(1, tex.width >> mip), h = Math.max(1, tex.height >> mip), bpr = Math.ceil(w * 4 / 256) * 256;
  const buf = gpu.resources.buffers.create('hiz-readback', bpr * h, GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
  const enc = gpu.device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex, mipLevel: mip }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
  gpu.device.queue.submit([enc.finish()]);
  const raw = new Float32Array(await readBuffer(gpu.device, buf, bpr * h));
  const px = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = raw[y * (bpr / 4) + x];
  return { w, h, px };
}

export function hizTests(gpu: GPUContext): SelfTest[] {
  return [{
    name: 'hi-z: pyramid equals the CPU max-reduction at every mip (odd and even sizes)',
    run: async () => {
      const { device, resources: r } = gpu;
      const out: string[] = [];
      for (const [W, H] of [[128, 64], [101, 57]]) {
        const depth = r.textures.create({ label: 'hiz-depth', size: [W, H], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        const module = r.shaders.get('hiz-test-depth', DEPTH_WGSL);
        const pipe = device.createRenderPipeline({
          layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [] },
          depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'always' },
        });
        const hiz = new HiZ(gpu);
        hiz.resize(W, H);
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
        pass.setPipeline(pipe); pass.draw(3); pass.end();
        hiz.encode(enc, depth.createView());
        device.queue.submit([enc.finish()]);
        let prev = await readR32(gpu, hiz.texture!, 0), worst = 0, checked = 0;
        for (let m = 1; m < hiz.mips; m++) {
          const cur = await readR32(gpu, hiz.texture!, m);
          for (let y = 0; y < cur.h; y++) for (let x = 0; x < cur.w; x++) {
            const x1 = (prev.w & 1) && x === cur.w - 1 ? 2 : 1, y1 = (prev.h & 1) && y === cur.h - 1 ? 2 : 1;
            let ref = 0;
            for (let dy = 0; dy <= y1; dy++) for (let dx = 0; dx <= x1; dx++) ref = Math.max(ref, prev.px[Math.min(y * 2 + dy, prev.h - 1) * prev.w + Math.min(x * 2 + dx, prev.w - 1)]);
            worst = Math.max(worst, Math.abs(ref - cur.px[y * cur.w + x])); checked++;
          }
          prev = cur;
        }
        // mip 0 must equal the depth buffer: the 1x1 top must be the global max
        const top = (await readR32(gpu, hiz.texture!, hiz.mips - 1)).px[0], base = await readR32(gpu, hiz.texture!, 0);
        const gmax = Math.max(...base.px);
        if (!(worst < 1e-6)) throw new Error(`${W}x${H}: reduction mismatch ${worst}`);
        if (Math.abs(top - gmax) > 1e-6) throw new Error(`${W}x${H}: top ${top} != max ${gmax}`);
        out.push(`${W}x${H}: ${hiz.mips} mips, ${checked} texels exact`);
      }
      return out.join('; ');
    },
  }];
}
