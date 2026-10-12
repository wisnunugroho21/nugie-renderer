import { describe, expect, it } from 'vitest';
import { makeFakeGPU } from './helpers/fakeGPU';
import { PostProcessor, DEFAULT_POST_SETTINGS } from '../src/rendering/post/PostProcessor';
import { RenderGraph } from '../src/rendering/RenderGraph';
import { compileTechnique } from '../src/rendering/graph/Compile';
import type { GPUContext } from '../src/gpu/GPUContext';

/** A PostProcessor on the recording fake device (plus the few device methods it needs), with a texture creation counter. */
function setup() {
  const g = makeFakeGPU();
  const created: { label: string; format: string; sampleCount: number; size: number[] }[] = [];
  const dev = g.device as unknown as Record<string, unknown>;
  dev.createBindGroupLayout = () => ({});
  dev.createPipelineLayout = () => ({});
  dev.createTexture = (d: { label: string; format: string; sampleCount?: number; size: number[] }) => {
    created.push({ label: d.label, format: d.format, sampleCount: d.sampleCount ?? 1, size: d.size });
    return { createView: () => ({}), destroy() {} };
  };
  const gpu = { device: g.device, resources: g.res, format: 'bgra8unorm', queue: g.device.queue } as unknown as GPUContext;
  const post = new PostProcessor(gpu);
  created.length = 0;                                    // ignore the 1x1 dummy the constructor makes
  return { post, created };
}

import { Mat4 } from '../src/math/Mat4';

const PROJ = Mat4.perspective(Mat4.create(), Math.PI / 3, 16 / 9, 0.1, 100);

function passOrder(post: PostProcessor): string[] {
  const graph = new RenderGraph();
  graph.addPass({ name: 'main', writes: ['sceneColor'], sideEffect: true, execute: () => {} });
  if (post.needsAux) graph.addPass({ name: 'aux', reads: ['sceneColor'], writes: ['auxTex'], execute: () => {} });
  post.addChainPasses(graph, { projection: PROJ, depthView: {} as GPUTextureView, depthTexture: {} as GPUTexture, depthSamples: 1 });
  graph.compile();
  return graph.order;
}

/** The nodes of the chain technique in execution order. */
function chainSteps(post: PostProcessor): string[] {
  return compileTechnique(post.chainPlan(1).technique).steps.map((s) => s.node.path);
}

describe('PostProcessor settings', () => {
  it('starts disabled with defaults and does not mutate the shared defaults', () => {
    const { post } = setup();
    expect(post.enabled).toBe(false);
    expect(post.settings).toEqual(DEFAULT_POST_SETTINGS);
    post.configure({ bloom: { intensity: 0.9 } });
    expect(DEFAULT_POST_SETTINGS.bloom.intensity).not.toBe(0.9);
  });

  it('configure enables the chain, merges bloom and accepts a boolean bloom shorthand', () => {
    const { post } = setup();
    post.configure({ fxaa: true, bloom: { threshold: 2 } });
    expect(post.enabled).toBe(true);
    expect(post.settings.bloom).toMatchObject({ enabled: true, threshold: 2, intensity: DEFAULT_POST_SETTINGS.bloom.intensity });
    post.configure({ bloom: false });
    expect(post.settings.bloom.enabled).toBe(false);
    expect(post.settings.fxaa).toBe(true);
    post.configure({ enabled: false });
    expect(post.enabled).toBe(false);
  });

  it('validates msaa, clamps bloom levels, and bumps structureVersion only on structural change', () => {
    const { post } = setup();
    expect(() => post.configure({ msaa: 2 as unknown as 4 })).toThrow(/msaa/);
    expect(post.settings.msaa).toBe(1);                    // a rejected value leaves the settings untouched
    const v0 = post.structureVersion;
    post.configure({ exposure: 2 });                       // enables the chain: structural
    expect(post.structureVersion).toBe(v0 + 1);
    post.configure({ exposure: 3, vignette: 0.2 });        // cosmetic
    expect(post.structureVersion).toBe(v0 + 1);
    post.configure({ msaa: 4 });
    expect(post.structureVersion).toBe(v0 + 2);
    post.configure({ bloom: { levels: 99 } });
    expect(post.settings.bloom.levels).toBe(8);
    post.disable();
    expect(post.enabled).toBe(false);
    post.reset();
    expect(post.settings).toEqual(DEFAULT_POST_SETTINGS);
  });
});

describe('PostProcessor targets and passes', () => {
  it('allocates only what the host needs, and not again while nothing changes', () => {
    const { post, created } = setup();
    post.ensureTargets(640, 360, 1);
    expect(created).toHaveLength(0);                       // disabled, single sample: nothing offscreen

    post.configure({ msaa: 4, enabled: false });
    post.ensureTargets(640, 360, 4);
    expect(created.map((t) => t.label)).toEqual(['post-msaa']);
    expect(created[0]).toMatchObject({ format: 'bgra8unorm', sampleCount: 4 });   // direct MSAA keeps the swap chain format

    created.length = 0;
    post.configure({ enabled: true, msaa: 4, fxaa: true, bloom: true });
    post.ensureTargets(640, 360, 4);
    // the chain's own targets (bloom levels, the pre-FXAA image ...) belong to the chain technique, not to the host
    expect(created.map((t) => t.label).sort()).toEqual(['post-msaa', 'post-scene']);
    expect(created.find((t) => t.label === 'post-scene')!.format).toBe('rgba16float');
    expect(created.find((t) => t.label === 'post-msaa')).toMatchObject({ format: 'rgba16float', sampleCount: 4 });
    const chain = compileTechnique(post.chainPlan(4).technique);
    expect(chain.resources.get('bloom0')!.resolved).toMatchObject({ format: 'rgba16float', size: [320, 180, 1] });
    expect(chain.resources.get('ldr')!.resolved).toMatchObject({ format: 'bgra8unorm', size: [640, 360, 1] });

    const n = created.length;
    post.ensureTargets(640, 360, 4);
    expect(created).toHaveLength(n);                       // unchanged key: no churn
    post.ensureTargets(800, 450, 4);
    expect(created.length).toBeGreaterThan(n);             // resize re-creates
    expect(compileTechnique(post.chainPlan(4).technique).resources.get('bloom0')!.resolved).toMatchObject({ size: [400, 225, 1] });
  });

  it('limits bloom levels to what fits on a small screen', () => {
    const { post } = setup();
    post.configure({ bloom: { levels: 8 } });
    post.ensureTargets(64, 64, 1);
    const names = [...compileTechnique(post.chainPlan(1).technique).resources.keys()].filter((n) => n.startsWith('bloom'));
    expect(names).toEqual(['bloom0', 'bloom1', 'bloom2']);   // log2(64) - 3
  });

  it('merges ssao / ssr settings, clamps them, and keeps them off by default', () => {
    const { post } = setup();
    expect(post.settings.ssao.enabled).toBe(false);
    expect(post.settings.ssr.enabled).toBe(false);
    expect(post.needsAux).toBe(false);
    post.configure({ ssao: { radius: 1.2, samples: 99 }, ssr: true });
    expect(post.settings.ssao).toMatchObject({ enabled: true, radius: 1.2, samples: 32, power: DEFAULT_POST_SETTINGS.ssao.power });
    expect(post.settings.ssr.enabled).toBe(true);
    expect(post.needsAux).toBe(true);
    post.configure({ ssao: false, ssr: { steps: 1 } });
    expect(post.settings.ssao.enabled).toBe(false);
    expect(post.settings.ssr.steps).toBe(8);
    post.disable();
    expect(post.needsAux).toBe(false);                       // the screen-space effects need the chain
  });

  it('allocates the aux target for the screen-space effects, and the chain declares the rest', () => {
    const { post, created } = setup();
    post.configure({ ssao: true });
    post.ensureTargets(640, 360, 1);
    const labels = created.map((t) => t.label);
    expect(labels).toEqual(expect.arrayContaining(['post-scene', 'post-aux']));
    expect(labels).not.toContain('post-aux-msaa');
    const ao = compileTechnique(post.chainPlan(1).technique);
    expect(ao.resources.get('viewDepth')!.resolved).toMatchObject({ format: 'r32float' });
    expect(ao.resources.get('ao0')!.resolved).toMatchObject({ format: 'r8unorm' });
    expect(ao.resources.has('ssr')).toBe(false);

    created.length = 0;
    post.configure({ ssao: false, ssr: true, msaa: 4 });
    post.ensureTargets(640, 360, 4);
    expect(created.map((t) => t.label)).toEqual(expect.arrayContaining(['post-aux', 'post-aux-msaa']));
    expect(created.find((t) => t.label === 'post-aux-msaa')).toMatchObject({ format: 'rgba16float', sampleCount: 4 });
    const ssr = compileTechnique(post.chainPlan(4).technique);
    expect(ssr.resources.has('ssr')).toBe(true);
    expect(ssr.resources.has('ao0')).toBe(false);
    expect(ssr.resources.get('depth')!.resolved).toMatchObject({ format: 'depth24plus', samples: 4 });   // the main depth buffer is sampled as multisampled
  });

  it('is one pass of the engine render graph, after main and aux', () => {
    const { post } = setup();
    post.configure({ ssao: true });
    post.ensureTargets(512, 512, 1);
    expect(passOrder(post)).toEqual(['main', 'aux', 'post-chain']);
    post.disable();
    post.ensureTargets(512, 512, 1);
    expect(passOrder(post)).toEqual(['main']);
  });

  it('orders view depth -> ssao(+blur) / ssr -> composite -> fxaa inside the chain', () => {
    const { post } = setup();
    post.configure({ ssao: true, ssr: true, fxaa: true });
    post.ensureTargets(512, 512, 1);
    expect(chainSteps(post)).toEqual(['post-depth', 'post-ssao', 'post-ssao-blur-h', 'post-ssao-blur-v', 'post-ssr', 'post-composite', 'post-fxaa']);

    post.configure({ ssao: false, fxaa: false });
    post.ensureTargets(512, 512, 1);
    expect(chainSteps(post)).toEqual(['post-depth', 'post-ssr', 'post-composite']);
  });

  it('chains bloom: prefilter, down the mips, up again, then composite; unused stages are absent', () => {
    const { post } = setup();
    post.configure({ bloom: { levels: 3 }, fxaa: true });
    post.ensureTargets(512, 512, 1);
    expect(chainSteps(post)).toEqual(['bloom-prefilter', 'bloom-down-1', 'bloom-down-2', 'bloom-up-2', 'bloom-up-1', 'post-composite', 'post-fxaa']);

    post.configure({ bloom: false, fxaa: false });
    post.ensureTargets(512, 512, 1);
    expect(chainSteps(post)).toEqual(['post-composite']);
  });

  it('keeps the same technique while nothing structural changes, and rebuilds it for a new size or effect set', () => {
    const { post } = setup();
    post.configure({ bloom: true });
    post.ensureTargets(512, 512, 1);
    const a = post.chainPlan(1).technique;
    post.configure({ exposure: 2, vignette: 0.4 });
    expect(post.chainPlan(1).technique).toBe(a);              // cosmetic settings are variables, not structure
    post.configure({ bloom: { levels: 2 } });
    post.ensureTargets(512, 512, 1);
    expect(post.chainPlan(1).technique).not.toBe(a);
  });
});
