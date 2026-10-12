import { describe, expect, it } from 'vitest';
import { OffscreenViews, type ViewHost, type ViewJob } from '../src/rendering/OffscreenViews';
import type { RenderTarget } from '../src/rendering/RenderTarget';
import { ViewScene } from '../src/rendering/lighting/SceneResources';
import type { RenderWorld } from '../src/rendering/RenderWorld';
import type { GPUContext } from '../src/gpu/GPUContext';
import { installGPUGlobals, makeFakeGPU } from './helpers/fakeGPU';
import { FrameBuilder } from '../src/rendering/graph/FrameGraph';
import { orderOf } from './helpers/frameGraph';

installGPUGlobals();

/** A render target stand-in: the views only read its textures, size and `ref`. */
const texture = (format: string) => ({ width: 64, height: 32, depthOrArrayLayers: 1, format, dimension: '2d', mipLevelCount: 1, sampleCount: 1, usage: 0xff }) as unknown as GPUTexture;
const target = (): RenderTarget => ({ texture: texture('rgba16float'), depthTexture: texture('depth32float'), width: 64, height: 32, ref: null, scale: 0 }) as unknown as RenderTarget;

function setup() {
  const g = makeFakeGPU();
  const destroyed: string[] = [];
  const device = g.device as unknown as Record<string, unknown>;
  device.createBindGroup = () => ({});
  const gpu = { device: g.device, resources: g.res, queue: g.device.queue, canvas: { width: 640, height: 360 } } as unknown as GPUContext;
  const prepared: { job: ViewJob; viewState: unknown }[] = [];
  const host: ViewHost = {
    buildBatches: (job, view) => { prepared.push({ job, viewState: view }); },
    drawGeometry: () => {},
    drawSky: () => {},
    time: 0,
    clearColor: { r: 0, g: 0, b: 0, a: 1 },
    ibl: {} as never,
  };
  const scene = {
    createViewScene: () => new ViewScene({ label: 'view-scene', size: 176, destroy() { destroyed.push('scene'); } } as unknown as GPUBuffer, {
      bytes: () => new ArrayBuffer(176), epoch: () => 0, bindGroup: () => ({}) as GPUBindGroup, destroy: () => { destroyed.push('scene'); },
    }),
  };
  const views = new OffscreenViews(gpu, { frame: {}, scene: {} } as never, { textureChanged() {} } as never, {} as never, scene as never, host);
  const rw = { hasCamera: true, count: 0, camera: {} } as unknown as RenderWorld;
  return { views, prepared, rw, destroyed };
}

describe('OffscreenViews in the frame', () => {
  it('prepares every due view with its own uniforms and draw state, in registration order', () => {
    const { views, prepared, rw } = setup();
    const a = views.addView({ target: target(), cull: 'none' }), b = views.addView({ target: target(), cull: 'none' });
    views.renderDue(rw);
    expect(prepared.map((p) => p.job.camera)).toEqual([a.camera, b.camera]);
    expect(prepared[0].job.slot).toBeDefined();
    expect(prepared[0].job.slot).not.toBe(prepared[1].job.slot);          // each view writes a uniform of its own: one command encoder holds them all
    expect(prepared[0].viewState).not.toBe(prepared[1].viewState);         // and builds batches of its own, which are drawn only when the frame records
    views.renderDue(rw);
    expect(prepared[2].job.slot).toBe(prepared[0].job.slot);              // kept while the view is registered
    expect(prepared[2].viewState).toBe(prepared[0].viewState);
  });

  it('declares the prepared views as render nodes of the frame, once', () => {
    const { views, rw } = setup();
    const t1 = target(), t2 = target();
    views.addView({ target: t1, cull: 'none' }); views.addView({ target: t2, cull: 'none' });
    views.renderDue(rw);
    const g = new FrameBuilder('f');
    views.declarePasses(g);
    expect(orderOf(g)).toEqual(['view:0', 'view:1']);
    expect(g.imports.get('view-color-1')).toBe(t1.texture);
    expect(g.imports.get('view-depth-2')).toBe(t1.depthTexture);
    const again = new FrameBuilder('f');
    views.declarePasses(again);
    expect(orderOf(again)).toEqual([]);                                    // declared once per prepare
  });

  it('skips views by interval and disabled views', () => {
    const { views, prepared, rw } = setup();
    views.addView({ target: target(), cull: 'none', interval: 2 });
    views.addView({ target: target(), cull: 'none', enabled: false });
    views.renderDue(rw); views.renderDue(rw); views.renderDue(rw);
    expect(prepared).toHaveLength(2);                                      // frames 1 and 3
  });

  it('frees a removed view\'s uniforms', () => {
    const { views, rw, destroyed } = setup();
    const v = views.addView({ target: target(), cull: 'none' });
    views.renderDue(rw);
    views.removeView(v);
    expect(destroyed).toContain('scene');
    views.renderDue(rw);                                                   // nothing registered any more
  });
});

describe('ViewScene', () => {
  it('writes the main view\'s scene uniform with clusters and fog switched off, into its own buffer', () => {
    const src = new ArrayBuffer(176);
    new Uint32Array(src).fill(7);
    const writes: { buffer: unknown; words: Uint32Array }[] = [];
    const buffer = { label: 'own' } as unknown as GPUBuffer;
    const scene = new ViewScene(buffer, { bytes: () => src, epoch: () => 0, bindGroup: () => ({}) as GPUBindGroup, destroy() {} });
    scene.write({ writeBuffer: (b: unknown, _o: number, data: ArrayBuffer) => writes.push({ buffer: b, words: new Uint32Array(data) }) } as unknown as GPUQueue);
    expect(writes[0].buffer).toBe(buffer);
    expect(writes[0].words[7]).toBe(0);
    expect(new Float32Array(writes[0].words.buffer)[43]).toBe(0);
    expect(writes[0].words[6]).toBe(7);                                    // the rest is the main view's
    expect(new Uint32Array(src)[7]).toBe(7);                               // the source is not touched
  });

  it('rebuilds its bind group only after the scene resources changed', () => {
    let epoch = 0, made = 0;
    const scene = new ViewScene({} as GPUBuffer, { bytes: () => new ArrayBuffer(176), epoch: () => epoch, bindGroup: () => (made++, {}) as GPUBindGroup, destroy() {} });
    const first = scene.bindGroup;
    expect(scene.bindGroup).toBe(first);
    epoch++;
    expect(scene.bindGroup).not.toBe(first);
    expect(made).toBe(2);
  });
});
