import { describe, expect, it } from 'vitest';
import { FeatureOrder, FeatureRegistry, type FeatureFrame, type PostFeatureFrame, type RenderFeature } from '../src/rendering/RenderFeature';
import { RenderGraph } from '../src/rendering/RenderGraph';
import { OverlaySystem } from '../src/rendering/overlay/Overlay';
import { ParticleSystem } from '../src/particles/ParticleSystem';
import { RibbonSystem } from '../src/particles/RibbonSystem';
import { ShadowSystem } from '../src/rendering/shadows/ShadowSystem';
import { ClusterGrid } from '../src/rendering/lighting/ClusterGrid';
import { VolumetricFog } from '../src/rendering/lighting/VolumetricFog';
import { Skybox } from '../src/rendering/Skybox';
import { StreamingDriver } from '../src/streaming/StreamingDriver';

const frame = (hasCamera = true) => ({ hasCamera, time: 1, frameBindGroup: { id: 'frame' } } as unknown as FeatureFrame);
const pass = {} as GPURenderPassEncoder;
/** A feature object of a built-in class without running its (GPU) constructor: only the fields a hook reads need to exist. */
const bare = <T extends object>(cls: { prototype: T }, fields: object): T => Object.assign(Object.create(cls.prototype), fields);

describe('FeatureRegistry', () => {
  it('keeps features sorted by order, registration order for equal orders, and ignores duplicates', () => {
    const r = new FeatureRegistry();
    const a: RenderFeature = { name: 'a', order: 300 }, b: RenderFeature = { name: 'b' }, c: RenderFeature = { name: 'c', order: 50 }, d: RenderFeature = { name: 'd' };
    [a, b, c, d, b].forEach((f) => r.add(f));
    expect(r.all.map((f) => f.name)).toEqual(['c', 'b', 'd', 'a']);   // default order is 100
  });

  it('calls only the hooks a feature has, in order, and skips the drawing hooks without a camera', () => {
    const r = new FeatureRegistry(), log: string[] = [];
    r.add({ name: 'late', order: 200, beginFrame: () => log.push('late.begin'), prepare: () => log.push('late.prepare'), drawMain: () => log.push('late.draw'), endFrame: () => log.push('late.end') });
    r.add({ name: 'early', order: 10, beginFrame: () => log.push('early.begin'), buildInstances: () => log.push('early.instances'), prepare: () => log.push('early.prepare'),
      drawBackdrop: () => log.push('early.backdrop'), drawMain: () => log.push('early.draw'), retarget: () => log.push('early.retarget') });
    r.add({ name: 'bare' });                                       // no hooks at all
    r.beginFrame(frame()); r.buildInstances(frame()); r.prepare(frame());
    r.drawBackdrop(pass, frame()); r.drawMain(pass, frame()); r.drawBackdrop(pass, frame(false)); r.drawMain(pass, frame(false));
    r.retarget(); r.endFrame();
    expect(log).toEqual(['early.begin', 'late.begin', 'early.instances', 'early.prepare', 'late.prepare', 'early.backdrop', 'early.draw', 'late.draw', 'early.retarget', 'late.end']);
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
    r.addPostPasses(g, { ...frame(), sceneTexture: {} as GPUTexture } as PostFeatureFrame);
    g.addPass({ name: 'post-composite', reads: ['sceneColor', 'auxTex'], writes: ['backbuffer'], sideEffect: true, execute: () => {} });
    expect(g.compile()).toEqual(['main', 'aux', 'grade', 'post-composite']);
  });
});

describe('built-in features', () => {
  it('FeatureOrder puts the scene-lighting features first, user features in the middle and the post chain last', () => {
    const o = FeatureOrder;
    expect([o.streaming, o.shadows, o.clusters, o.fog, o.default, o.particles, o.ribbons, o.overlays, o.postChain])
      .toEqual([...[o.streaming, o.shadows, o.clusters, o.fog, o.default, o.particles, o.ribbons, o.overlays, o.postChain]].sort((x, y) => x - y));
    expect(o.default).toBe(o.particles);            // user features draw with the particles unless they pick an order
    expect(o.shadows).toBeLessThan(o.clusters);     // the fog pass reads the shadow map and the cluster grid
    expect(o.clusters).toBeLessThan(o.fog);
  });

  it('overlays: flush before the frame, draw with the frame bind group, clear after when autoClear', () => {
    const log: string[] = [];
    class TestOverlay extends OverlaySystem {
      flush() { log.push('flush'); }
      encodeDraw(_p: GPURenderPassEncoder, bg: GPUBindGroup) { log.push('draw:' + (bg as unknown as { id: string }).id); }
      retarget() { log.push('retarget'); }
      clear() { log.push('clear'); }
    }
    const o = new TestOverlay('test');
    o.autoClear = true;
    o.prepare(); o.drawMain(pass, frame()); o.retarget(); o.endFrame();
    expect(log).toEqual(['flush', 'draw:frame', 'retarget', 'clear']);
    o.autoClear = false;
    log.length = 0; o.endFrame();
    expect(log).toEqual([]);
  });

  it('particles: simulate in a graph pass, draw only when pools exist', () => {
    const log: string[] = [];
    const ps = bare(ParticleSystem, { pools: [] as unknown[], encodeCompute: () => log.push('compute'), encodeDraw: () => log.push('draw') });
    const g = new RenderGraph();
    ps.addPasses(g);
    g.addPass({ name: 'reader', reads: ['particles'], sideEffect: true, execute: () => {} });
    expect(g.compile()).toEqual(['particles-sim', 'reader']);
    g.execute({} as GPUCommandEncoder);
    ps.drawMain(pass, frame());
    (ps.pools as unknown[]).push({});
    ps.drawMain(pass, frame());
    expect(log).toEqual(['compute', 'draw']);
  });

  it('ribbons: one update pass per system, named after the system', () => {
    const made = [0, 1].map(() => bare(RibbonSystem, { name: `ribbons:${Math.random()}`, encodeCompute: () => {} }));
    const g = new RenderGraph();
    for (const rs of made) rs.addPasses(g);
    g.addPass({ name: 'reader', reads: ['ribbons'], sideEffect: true, execute: () => {} });
    expect(g.compile()).toEqual([`${made[0].name}:update`, `${made[1].name}:update`, 'reader']);
  });

  it('the sky draws only when visible and an environment is bound', () => {
    const drew: string[] = [];
    const scene = { env: { enabled: false } };
    const sky = bare(Skybox, { visible: true, scene, draw: () => drew.push('sky') });
    const f = { ...frame(), target: {}, sceneBindGroup: {} } as FeatureFrame;
    sky.drawBackdrop(pass, f);
    expect(drew).toEqual([]);                      // no environment
    scene.env.enabled = true;
    sky.drawBackdrop(pass, f);
    sky.visible = false;
    sky.drawBackdrop(pass, f);
    expect(drew).toEqual(['sky']);
  });

  it('clusters: active only when enabled and there are ranged lights; the grid pass is declared only then', () => {
    const resized: number[][] = [], g = new RenderGraph();
    const grid = bare(ClusterGrid, { enabled: true, active: false, resize: (w: number, h: number) => resized.push([w, h]), encode: () => {} });
    const lights = { count: 5, globalCount: 5 };
    const f = { ...frame(), lights, width: 640, height: 360, camera: { view: [], projection: [], near: 0.1, far: 100 }, profiler: { writes: () => undefined } } as unknown as FeatureFrame;
    grid.beginFrame(f);
    expect(grid.active).toBe(false);                // every light is global: nothing to cluster
    grid.addPasses(g, f);
    expect(g.compile()).toEqual([]);
    lights.count = 40;
    grid.beginFrame(f);
    expect(grid.active).toBe(true);
    expect(resized).toEqual([[640, 360]]);
    grid.addPasses(g, f);
    g.addPass({ name: 'reader', reads: ['clusterGrid'], sideEffect: true, execute: () => {} });
    expect(g.compile()).toEqual(['clusters', 'reader']);
    grid.enabled = false;
    grid.beginFrame(f);
    expect(grid.active).toBe(false);
  });

  it('shadows: slots are assigned in beginFrame, casters are built only with a camera, the depth pass only with layers', () => {
    const log: string[] = [];
    const shadows = bare(ShadowSystem, { layers: [], assign: () => log.push('assign'), buildCasterBatches: () => log.push('casters'), encode: () => log.push('encode') });
    shadows.beginFrame(frame());
    shadows.buildInstances(frame(false));
    shadows.buildInstances(frame());
    const g = new RenderGraph();
    shadows.addPasses(g, frame());
    g.addPass({ name: 'reader', reads: ['shadowMap'], sideEffect: true, execute: () => {} });
    expect(g.compile()).toEqual(['reader']);        // no layers: no depth pass
    (shadows.layers as unknown[]).push({});
    const g2 = new RenderGraph();
    shadows.addPasses(g2, { ...frame(), objectBindGroup: () => ({}) as GPUBindGroup, profiler: {} } as unknown as FeatureFrame);
    g2.addPass({ name: 'reader', reads: ['shadowMap'], sideEffect: true, execute: () => {} });
    expect(g2.compile()).toEqual(['shadows', 'reader']);
    g2.execute({} as GPUCommandEncoder);
    expect(log).toEqual(['assign', 'casters', 'encode']);
  });

  it('texture streaming reports coverage in beginFrame, only with a streamer and a camera', () => {
    const calls: number[] = [];
    const driver = bare(StreamingDriver, { streamer: null, update: (_rw: unknown, _v: unknown, n: number, h: number) => calls.push(n, h) });
    const f = { ...frame(), rw: {}, visible: null, visibleCount: 7, height: 360 } as unknown as FeatureFrame;
    driver.beginFrame(f);
    expect(calls).toEqual([]);
    (driver as { streamer: unknown }).streamer = {};
    driver.beginFrame(f);
    driver.beginFrame({ ...f, hasCamera: false } as FeatureFrame);
    expect(calls).toEqual([7, 360]);
  });

  it('fog: sizes the volume in beginFrame and declares its pass only when enabled', () => {
    const log: string[] = [];
    const fog = bare(VolumetricFog, { enabled: true, resize: () => log.push('resize'), applySettings: () => log.push('apply') });
    fog.beginFrame({ ...frame(), width: 4, height: 4 } as FeatureFrame);
    fog.beginFrame({ ...frame(false), width: 4, height: 4 } as FeatureFrame);
    expect(log).toEqual(['resize', 'apply']);
    const g = new RenderGraph();
    fog.enabled = false;
    fog.addPasses(g, { ...frame(), camera: { view: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), projection: [], near: 0.1 } } as unknown as FeatureFrame);
    expect(g.compile()).toEqual([]);
  });
});
