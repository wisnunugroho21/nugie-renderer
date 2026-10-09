import type { GPUContext } from '../gpu/GPUContext';
import { createBindLayouts } from '../gpu/BindLayouts';
import { Camera } from '../rendering/Camera';
import { RibbonSystem, beamPoints, SEGMENT_FLOATS, type RibbonSystemConfig } from '../particles/RibbonSystem';
import { readTextureRGBA8, type SelfTest } from './harness';

const TARGET = { colorFormat: 'rgba8unorm' as GPUTextureFormat, depthFormat: 'depth24plus' as GPUTextureFormat, sampleCount: 1 };

/** Create a ribbon system (8 ribbons x 16 points by default) with the given overrides. */
function make(gpu: GPUContext, cfg: Partial<RibbonSystemConfig> = {}) {
  const layouts = createBindLayouts(gpu.device);
  return { layouts, rs: new RibbonSystem(gpu, layouts, TARGET, { maxRibbons: 8, pointsPerRibbon: 16, blend: 'alpha', ...cfg }) };
}

/** Run `frames` compute frames; `drive(frame)` sets the targets before each. Time advances 1/60 per frame. */
function run(gpu: GPUContext, rs: RibbonSystem, frames: number, drive: (f: number) => void): number {
  let time = 0;
  for (let f = 0; f < frames; f++) {
    drive(f);
    time = f / 60;
    rs.update(time);
    const enc = gpu.device.createCommandEncoder();
    rs.encodeCompute(enc);
    gpu.device.queue.submit([enc.finish()]);
  }
  return time;
}

/** Render the system to a 64x64 target with a camera at z=4 looking at the origin; returns RGB sums per pixel. */
async function render(gpu: GPUContext, rs: RibbonSystem, layouts: ReturnType<typeof createBindLayouts>, time: number): Promise<(x: number, y: number) => number> {
  const { device } = gpu;
  const cam = new Camera(); cam.position.set([0, 0, 4]); cam.target.set([0, 0, 0]); cam.aspect = 1; cam.update();
  const fd = new Float32Array(60); fd.set(cam.viewProjection, 0); fd.set(cam.view, 16); fd.set(cam.projection, 32); fd.set(cam.position, 48); fd[51] = time; fd[52] = 64; fd[53] = 64;
  const buf = gpu.resources.buffers.create('frame', 240, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  device.queue.writeBuffer(buf, 0, fd);
  const bg = device.createBindGroup({ layout: layouts.frame, entries: [{ binding: 0, resource: { buffer: buf } }] });
  const color = gpu.resources.textures.create({ size: [64, 64], format: TARGET.colorFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const depth = gpu.resources.textures.create({ size: [64, 64], format: TARGET.depthFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT });
  device.pushErrorScope('validation');
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({
    colorAttachments: [{ view: color.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
  });
  rs.encodeDraw(pass, bg); pass.end();
  device.queue.submit([enc.finish()]);
  const err = await device.popErrorScope();
  if (err) throw new Error('validation error: ' + err.message);
  const px = await readTextureRGBA8(device, color, 0, 64, 64);
  return (x, y) => px[(y * 64 + x) * 4] + px[(y * 64 + x) * 4 + 1] + px[(y * 64 + x) * 4 + 2];
}

/** Throw `msg` unless `cond` holds. */
const need = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };

/** Ribbon / trail / beam tests: segment generation, ring behaviour and rendering. */
export function ribbonTests(gpu: GPUContext): SelfTest[] {
  return [
    {
      name: 'ribbons: trail history ring (live head, commit spacing, uv distance, wrap-around)',
      run: async () => {
        const { rs } = make(gpu);
        const id = rs.addRibbon({ mode: 'trail', minSegment: 0.25, lifetime: 100 });
        const F = 80;
        run(gpu, rs, F, (f) => rs.setTarget(id, 0.1 * f, 0, 0));
        const r = await rs.readRibbon(id), N = 16;
        need(r.count === N, `count ${r.count} (ring should be full: N=${N})`);
        /** Position and texture coordinate of the point `k` steps behind the ribbon head. */
        const pos = (k: number) => { const slot = (r.head + N - k) % N; return { x: r.points[slot * SEGMENT_FLOATS], u: r.points[slot * SEGMENT_FLOATS + 9] }; };
        const head = pos(0);
        need(Math.abs(head.x - 0.1 * (F - 1)) < 1e-4, `live head x ${head.x} != ${0.1 * (F - 1)}`);
        let prev = head;
        for (let k = 1; k < N; k++) {
          const p = pos(k);
          const gap = prev.x - p.x;
          need(gap > 0, `points are not ordered newest-first at k=${k}`);
          if (k >= 2) need(gap >= 0.25 - 1e-4 && gap <= 0.36, `committed spacing ${gap} at k=${k}`);
          need(Math.abs(p.u - p.x) < 1e-3, `uvDist ${p.u} should equal arc length ${p.x} at k=${k}`);
          prev = p;
        }
        return `ring full (${N}), live head at ${head.x.toFixed(2)}, spacing 0.25..0.35 over wrap`;
      },
    },
    {
      name: 'ribbons: reset() drops the history (no streak across a teleport)',
      run: async () => {
        const { rs } = make(gpu);
        const id = rs.addRibbon({ mode: 'trail', minSegment: 0.1 });
        run(gpu, rs, 30, (f) => rs.setTarget(id, 0.1 * f, 0, 0));
        need((await rs.readRibbon(id)).count > 5, 'history should have built up');
        rs.reset(id);
        run(gpu, rs, 1, () => rs.setTarget(id, 50, 0, 0));
        const r = await rs.readRibbon(id);
        need(r.count === 1, `count after reset+1 frame = ${r.count}`);
        return 'history cleared';
      },
    },
    {
      name: 'ribbons: chain (beam) renders a continuous band; empty regions stay black',
      run: async () => {
        const { rs, layouts } = make(gpu, { pointsPerRibbon: 32, blend: 'additive' });
        const id = rs.addRibbon({ mode: 'chain', widthHead: 0.4, widthTail: 0.4, colorStart: [1, 0.9, 0.5, 1], colorEnd: [1, 0.9, 0.5, 1], lifetime: 0 });
        rs.setChain(id, beamPoints([-1.2, 0, 0], [1.2, 0, 0], 20, 0), undefined, undefined);
        rs.update(0);
        const at = await render(gpu, rs, layouts, 0);
        for (let x = 12; x <= 52; x += 4) need(at(x, 32) > 80, `beam pixel (${x},32) too dark: ${at(x, 32)}`);
        need(at(32, 6) === 0 && at(32, 58) === 0 && at(2, 32) === 0 && at(61, 32) === 0, 'pixels away from the beam must stay black');
        return `band ${at(32, 32)} at centre`;
      },
    },
    {
      name: 'ribbons: moving trail draws behind the head and fades out after its lifetime',
      run: async () => {
        const { rs, layouts } = make(gpu, { blend: 'additive' });
        const id = rs.addRibbon({ mode: 'trail', widthHead: 0.4, widthTail: 0.1, lifetime: 0.5, minSegment: 0.05, colorStart: [1, 1, 1, 1], colorEnd: [1, 1, 1, 0.2] });
        const t = run(gpu, rs, 24, (f) => rs.setTarget(id, -1.0 + f * 0.09, 0, 0));      // 0.4 s of motion along +X
        const at = await render(gpu, rs, layouts, t);
        const head = Math.round(32 + (-1.0 + 23 * 0.09) * 64 / 4 / 1.0 * 0.75);
        need(at(head, 32) > 40, `head region too dark (${at(head, 32)})`);
        need(at(32, 6) === 0, 'off-path pixel must be black');
        // 2 seconds later (no new targets): every point is older than the lifetime
        const later = await render(gpu, rs, layouts, t + 2.0);
        for (let x = 0; x < 64; x += 8) need(later(x, 32) === 0, `ribbon should have faded away at x=${x}`);
        return `visible at t, gone at t+2s`;
      },
    },
    {
      name: 'ribbons: flat ribbons use a fixed plane normal (visible when facing the camera)',
      run: async () => {
        const { rs, layouts } = make(gpu, { blend: 'additive' });
        const id = rs.addRibbon({ mode: 'flat', flatNormal: [0, 0, 1], widthHead: 0.5, widthTail: 0.5, lifetime: 0, minSegment: 0.05, colorStart: [1, 1, 1, 1], colorEnd: [1, 1, 1, 1] });
        const t = run(gpu, rs, 30, (f) => rs.setTarget(id, -1.2 + f * 0.08, 0, 0));
        const at = await render(gpu, rs, layouts, t);
        // the ring keeps only the newest 16 points (~1.3 m behind the head at x = 1.12): world x = 0.5 -> pixel ~42
        need(at(42, 32) > 60, `flat ribbon not visible (${at(42, 32)})`);
        need(at(10, 32) === 0, 'the ribbon must not extend beyond the retained history');
        const edgeOn = make(gpu, { blend: 'additive' });
        const id2 = edgeOn.rs.addRibbon({ mode: 'flat', flatNormal: [0, 1, 0], widthHead: 0.5, widthTail: 0.5, lifetime: 0, minSegment: 0.05, colorStart: [1, 1, 1, 1], colorEnd: [1, 1, 1, 1] });
        const t2 = run(gpu, edgeOn.rs, 30, (f) => edgeOn.rs.setTarget(id2, -1.2 + f * 0.08, 0, 0));
        const thin = await render(gpu, edgeOn.rs, edgeOn.layouts, t2);
        need(thin(42, 20) === 0 && thin(42, 44) === 0, 'a ribbon lying in the XZ plane seen edge-on must not fill the screen');
        return `facing ${at(42, 32)}`;
      },
    },
  ];
}
