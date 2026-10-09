import { describe, expect, it } from 'vitest';
import { FeatureRegistry, overlayFeature, particleFeature, ribbonFeature, type FeatureFrame, type RenderFeature } from '../src/rendering/RenderFeature';
import { RenderGraph } from '../src/rendering/RenderGraph';
import type { Overlay } from '../src/rendering/overlay/Overlay';
import type { ParticleSystem } from '../src/particles/ParticleSystem';
import type { RibbonSystem } from '../src/particles/RibbonSystem';

const frame = (hasCamera = true) => ({ hasCamera, time: 1, frameBindGroup: { id: 'frame' } } as unknown as FeatureFrame);
const pass = {} as GPURenderPassEncoder;

describe('FeatureRegistry', () => {
  it('keeps features sorted by drawOrder, registration order for equal orders, and ignores duplicates', () => {
    const r = new FeatureRegistry();
    const a: RenderFeature = { name: 'a', drawOrder: 300 }, b: RenderFeature = { name: 'b' }, c: RenderFeature = { name: 'c', drawOrder: 50 }, d: RenderFeature = { name: 'd' };
    [a, b, c, d, b].forEach((f) => r.add(f));
    expect(r.all.map((f) => f.name)).toEqual(['c', 'b', 'd', 'a']);   // default order is 100
  });

  it('calls only the hooks a feature has, in draw order, and skips drawMain without a camera', () => {
    const r = new FeatureRegistry(), log: string[] = [];
    r.add({ name: 'late', drawOrder: 200, prepare: () => log.push('late.prepare'), drawMain: () => log.push('late.draw'), endFrame: () => log.push('late.end') });
    r.add({ name: 'early', drawOrder: 10, prepare: () => log.push('early.prepare'), drawMain: () => log.push('early.draw'), retarget: () => log.push('early.retarget') });
    r.add({ name: 'bare' });                                       // no hooks at all
    r.prepare(frame()); r.drawMain(pass, frame()); r.drawMain(pass, frame(false)); r.retarget(); r.endFrame();
    expect(log).toEqual(['early.prepare', 'late.prepare', 'early.draw', 'late.draw', 'early.retarget', 'late.end']);
  });

  it('remove unregisters, and the produced resources are the union of the features', () => {
    const r = new FeatureRegistry();
    const a: RenderFeature = { name: 'a', produces: ['x', 'y'] }, b: RenderFeature = { name: 'b', produces: ['y', 'z'] };
    r.add(a); r.add(b);
    expect([...r.producedResources].sort()).toEqual(['x', 'y', 'z']);
    expect(r.remove(a)).toBe(true);
    expect(r.remove(a)).toBe(false);
    expect([...r.producedResources].sort()).toEqual(['y', 'z']);
  });

  it("a feature's compute pass is ordered before a pass that reads what it produces", () => {
    const r = new FeatureRegistry(), g = new RenderGraph();
    r.add({ name: 'sim', produces: ['sim'], addPasses: (graph) => graph.addPass({ name: 'sim-pass', writes: ['sim'], execute: () => {} }) });
    g.addPass({ name: 'main', reads: ['depth', ...r.producedResources], writes: ['backbuffer'], sideEffect: true, execute: () => {} });   // declared first on purpose
    g.addPass({ name: 'depth', writes: ['depth'], execute: () => {} });
    r.addPasses(g, frame());
    expect(g.compile()).toEqual(['depth', 'sim-pass', 'main']);
  });
});

describe('post-processing features', () => {
  it("a read-modify-write of 'sceneColor' runs after the scene and the aux pass, before the built-in composite", () => {
    const r = new FeatureRegistry(), g = new RenderGraph();
    r.add({ name: 'grade', addPostPasses: (graph) => graph.addPass({ name: 'grade', reads: ['sceneColor'], writes: ['sceneColor'], execute: () => {} }) });
    // the renderer declares: main, aux, features' post passes, then the post chain
    g.addPass({ name: 'main', writes: ['sceneColor'], execute: () => {} });
    g.addPass({ name: 'aux', reads: ['sceneColor'], writes: ['auxTex'], execute: () => {} });
    r.addPostPasses(g, { ...frame(), sceneTexture: {} as GPUTexture, width: 4, height: 4 });
    g.addPass({ name: 'post-composite', reads: ['sceneColor', 'auxTex'], writes: ['backbuffer'], sideEffect: true, execute: () => {} });
    expect(g.compile()).toEqual(['main', 'aux', 'grade', 'post-composite']);
  });
});

describe('built-in features', () => {
  it('overlay: flush before the frame, draw with the frame bind group, clear after when autoClear', () => {
    const log: string[] = [];
    const o = { autoClear: true, flush: () => log.push('flush'), encodeDraw: (_p: unknown, bg: unknown) => log.push('draw:' + (bg as { id: string }).id), retarget: () => log.push('retarget'), clear: () => log.push('clear') } as unknown as Overlay;
    const f = overlayFeature(o);
    f.prepare!(frame()); f.drawMain!(pass, frame()); f.retarget!(); f.endFrame!();
    expect(log).toEqual(['flush', 'draw:frame', 'retarget', 'clear']);
    (o as { autoClear: boolean }).autoClear = false;
    log.length = 0; f.endFrame!();
    expect(log).toEqual([]);
  });

  it('particles: simulate in a graph pass, draw only when pools exist', () => {
    const log: string[] = [];
    const ps = { pools: [] as unknown[], encodeCompute: () => log.push('compute'), encodeDraw: () => log.push('draw'), retarget: () => log.push('retarget') } as unknown as ParticleSystem;
    const f = particleFeature(ps), g = new RenderGraph();
    f.addPasses!(g, frame());
    g.addPass({ name: 'reader', reads: ['particles'], sideEffect: true, execute: () => {} });
    expect(g.compile()).toEqual(['particles-sim', 'reader']);
    g.execute({} as GPUCommandEncoder);
    f.drawMain!(pass, frame());
    (ps.pools as unknown[]).push({});
    f.drawMain!(pass, frame());
    expect(log).toEqual(['compute', 'draw']);
  });

  it('ribbons: one update pass per system, in registration order', () => {
    const made = [0, 1].map((i) => ribbonFeature({ encodeCompute: () => {}, encodeDraw: () => {}, retarget: () => {} } as unknown as RibbonSystem, i));
    const g = new RenderGraph();
    for (const f of made) f.addPasses!(g, frame());
    g.addPass({ name: 'reader', reads: ['ribbons'], sideEffect: true, execute: () => {} });
    expect(g.compile()).toEqual(['ribbons-update:0', 'ribbons-update:1', 'reader']);
  });
});
