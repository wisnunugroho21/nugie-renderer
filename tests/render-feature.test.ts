import type { TrackedRenderPass } from '../src/rendering/graph/TrackedRenderPass';
import { describe, expect, it } from 'vitest';
import { FeatureOrder, FeatureRegistry, type FeatureFrame, type PostFeatureFrame, type RenderFeature } from '../src/rendering/RenderFeature';
import { addPass, newFrame, orderOf } from './helpers/frameGraph';
import { technique } from '../src/rendering/graph/TechniqueBuilder';
import type { FrameBuilder } from '../src/rendering/graph/FrameGraph';
import { OverlaySystem } from '../src/rendering/overlay/Overlay';
import { ParticleSystem } from '../src/particles/ParticleSystem';
import { RibbonSystem } from '../src/particles/RibbonSystem';
import { ShadowSystem } from '../src/rendering/shadows/ShadowSystem';
import { ClusterGrid } from '../src/rendering/lighting/ClusterGrid';
import { VolumetricFog } from '../src/rendering/lighting/VolumetricFog';
import { Skybox } from '../src/rendering/Skybox';
import { StreamingDriver } from '../src/streaming/StreamingDriver';

const frame = (hasCamera = true) => ({ hasCamera, time: 1, frameBindGroup: { id: 'frame' } } as unknown as FeatureFrame);
const pass = {} as TrackedRenderPass;
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
    const r = new FeatureRegistry(), g = newFrame().begin();
    r.add({ name: 'sim', produces: ['sim'], addPasses: (graph) => addPass(graph, { name: 'sim-pass', writes: ['sim'], execute: () => {} }) });
    addPass(g, { name: 'main', reads: ['depth', ...r.producedResources], writes: ['backbuffer'], sideEffect: true, execute: () => {} });   // declared first on purpose
    addPass(g, { name: 'depth', writes: ['depth'], execute: () => {} });
    r.addPasses(g, frame());
    expect(orderOf(g)).toEqual(['depth', 'sim-pass', 'main']);
  });
});

describe('post-processing features', () => {
  it("a read-modify-write of 'sceneColor' runs after the scene and the aux pass, before the built-in composite", () => {
    const r = new FeatureRegistry(), g = newFrame().begin();
    r.add({ name: 'grade', addPostPasses: (graph) => addPass(graph, { name: 'grade', reads: ['sceneColor'], writes: ['sceneColor'], execute: () => {} }) });
    // the renderer declares: main, aux, features' post passes, then the post chain
    addPass(g, { name: 'main', writes: ['sceneColor'], execute: () => {} });
    addPass(g, { name: 'aux', reads: ['sceneColor'], writes: ['auxTex'], execute: () => {} });
    r.addPostPasses(g, { ...frame(), sceneTexture: {} as GPUTexture } as PostFeatureFrame);
    addPass(g, { name: 'post-composite', reads: ['sceneColor', 'auxTex'], writes: ['backbuffer'], sideEffect: true, execute: () => {} });
    expect(orderOf(g)).toEqual(['main', 'aux', 'grade', 'post-composite']);
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
      encodeDraw(_p: TrackedRenderPass, bg: GPUBindGroup) { log.push('draw:' + (bg as unknown as { id: string }).id); }
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

  it('particles: each pool declares its simulation in the frame, draws only when pools exist', () => {
    const log: string[] = [];
    const pool = { addToFrame: (g: FrameBuilder) => { log.push('declare'); g.callback('pool-sim', { writes: [g.logical('pool-buffers')], execute: () => log.push('compute') }); }, encodeDraw: () => log.push('draw') };
    const ps = bare(ParticleSystem, { pools: [] as unknown[], encodeDraw: () => log.push('draw') });
    const g = newFrame().begin();
    ps.addPasses(g);
    expect(orderOf(g)).toEqual([]);                  // no pools: nothing to simulate
    (ps.pools as unknown[]).push(pool);
    ps.addPasses(g);
    g.callback('reader', { reads: ['pool-buffers'], keep: true, execute: () => {} });
    expect(orderOf(g)).toEqual(['pool-sim', 'reader']);
    newFrame().run(g, {} as GPUCommandEncoder);
    ps.drawMain(pass, frame());
    expect(log).toEqual(['declare', 'compute', 'draw']);
  });

  it('ribbons: one update node per system, below the system name', () => {
    // a stand-in for the trail-update technique with the same imports and variables (the real one needs a GPU to compile its shader)
    const tb = technique('ribbon-stand-in');
    tb.float('time'); tb.uint('ribbonCount');
    const ribbons = tb.importedBuffer('ribbons', 'u32'), segments = tb.importedBuffer('segments', 'u32');
    void segments;
    tb.clear('update-trails', ribbons);
    const tech = tb.build(), buffers = { desc: { id: 'desc' }, segments: { id: 'segments' } } as unknown as Record<string, GPUBuffer>;
    const made = [0, 1].map((i) => bare(RibbonSystem, { name: `ribbons:${i}`, count: i + 1, updateTime: 0.5, updateTechnique: () => tech, descBuf: buffers.desc, segmentBuf: buffers.segments }));
    const g = newFrame().begin();
    for (const rs of made) rs.addPasses(g);
    expect(orderOf(g)).toEqual(['ribbons:0:update/update-trails', 'ribbons:1:update/update-trails']);
    expect(g.values.get('ribbons:1:update/ribbonCount')).toBe(2);
    expect([...g.published]).toContain('ribbons:0:update/ribbons');
    const empty = bare(RibbonSystem, { name: 'ribbons:9', count: 0 });
    empty.addPasses(g);                              // no ribbons: no pass
    expect(orderOf(g)).toHaveLength(2);
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
    const resized: number[][] = [], g = newFrame().begin();
    // a stand-in for the light-assignment technique with the same imports (the real one needs a GPU to compile its shader)
    const tb = technique('cluster-stand-in');
    const lightsRes = tb.importedBuffer('lights', 'u32'), gridRes = tb.importedBuffer('clusterGrid', 'u32'), indicesRes = tb.importedBuffer('clusterIndices', 'u32'), overflow = tb.importedBuffer('overflow', 'u32');
    tb.clear('clear-overflow', overflow);
    void indicesRes;
    tb.copy('cluster-cull', lightsRes, gridRes);
    const buffers = { lights: { id: 'lights' }, grid: { id: 'grid' }, indices: { id: 'indices' }, overflow: { id: 'overflow' } } as unknown as Record<string, GPUBuffer>;
    const grid = bare(ClusterGrid, {
      enabled: true, active: false, resize: (w: number, h: number) => resized.push([w, h]), encode: () => {}, tech: tb.build(), grid: buffers.grid, indices: buffers.indices, overflowBuf: buffers.overflow,
      scene: { lightBuffer: buffers.lights }, dims: [10, 6, 24], width: 640, height: 360, config: { tileSize: 64, slices: 24, maxLightsPerCluster: 256 }, dispatches: 0,
    });
    const lights = { count: 5, globalCount: 5 };
    const f = { ...frame(), lights, width: 640, height: 360, camera: { view: new Float32Array(16), projection: new Float32Array(16), near: 0.1, far: 100 }, profiler: { writes: () => undefined } } as unknown as FeatureFrame;
    grid.beginFrame(f);
    expect(grid.active).toBe(false);                // every light is global: nothing to cluster
    grid.addPasses(g, f);
    expect(orderOf(g)).toEqual([]);
    lights.count = 40;
    grid.beginFrame(f);
    expect(grid.active).toBe(true);
    expect(resized).toEqual([[640, 360]]);
    grid.addPasses(g, f);
    expect(g.imports.get('lights')).toBe(buffers.lights);   // the scene's light buffer is the frame's 'lights' resource
    g.callback('reader', { reads: ['clusterGrid'], keep: true, execute: () => {} });
    expect(orderOf(g)).toEqual(['clusters/clear-overflow', 'clusters/cluster-cull', 'reader']);
    grid.enabled = false;
    grid.beginFrame(f);
    expect(grid.active).toBe(false);
  });

  it('shadows: slots are assigned in beginFrame, casters are built only with a camera, one depth pass (render node) per layer', () => {
    const log: string[] = [], writes: string[] = [];
    const map = { format: 'depth32float', width: 1024, height: 1024, depthOrArrayLayers: 4, dimension: '2d', mipLevelCount: 1, sampleCount: 1 } as unknown as GPUTexture;
    const shadows = bare(ShadowSystem, {
      layers: [], assign: () => log.push('assign'), buildCasterBatches: () => log.push('casters'), texture: map, frameData: new Float32Array(64), config: { mapSize: 1024 },
      frameBuffers: [{ label: 'f0' }, { label: 'f1' }], gpu: { device: { queue: { writeBuffer: (b: { label: string }) => writes.push(b.label) } } },
    });
    shadows.beginFrame(frame());
    shadows.buildInstances(frame(false));
    shadows.buildInstances(frame());
    const g = newFrame().begin();
    shadows.addPasses(g, frame());
    expect(g.hasResource('shadowMap')).toBe(false);   // no layers: no depth pass, nothing declared
    (shadows.layers as unknown[]).push({ index: 0, vp: new Float32Array(16) }, { index: 1, vp: new Float32Array(16) });
    const g2 = newFrame().begin();
    shadows.addPasses(g2, { ...frame(), objectBindGroup: () => ({}) as GPUBindGroup, profiler: { writes: () => undefined } } as unknown as FeatureFrame);
    g2.callback('reader', { reads: ['shadowMap'], keep: true, execute: () => {} });
    expect(orderOf(g2)).toEqual(['shadow-layer-0', 'shadow-layer-1', 'reader']);
    expect(writes).toEqual(['f0', 'f1']);             // each layer's frame uniforms are written when the passes are declared
    expect(log).toEqual(['assign', 'casters']);
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
    const g = newFrame().begin();
    fog.enabled = false;
    fog.addPasses(g, { ...frame(), camera: { view: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), projection: [], near: 0.1 } } as unknown as FeatureFrame);
    expect(orderOf(g)).toEqual([]);
  });
});
