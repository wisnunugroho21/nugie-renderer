import { describe, expect, it } from 'vitest';
import { makeFakeGPU } from './helpers/fakeGPU';
import { PostProcessor, DEFAULT_POST_SETTINGS } from '../src/rendering/post/PostProcessor';
import { RenderGraph } from '../src/rendering/RenderGraph';
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
  post.addPasses(graph, { projection: PROJ, depthView: {} as GPUTextureView, depthSamples: 1 });
  graph.compile();
  return graph.order;
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
  it('allocates only what is needed, and not again while nothing changes', () => {
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
    const labels = created.map((t) => t.label);
    expect(labels).toEqual(expect.arrayContaining(['post-scene', 'post-ldr', 'post-msaa', 'post-bloom-0']));
    expect(created.find((t) => t.label === 'post-scene')!.format).toBe('rgba16float');
    expect(created.find((t) => t.label === 'post-msaa')).toMatchObject({ format: 'rgba16float', sampleCount: 4 });
    expect(created.find((t) => t.label === 'post-bloom-0')!.size).toEqual([320, 180]);

    const n = created.length;
    post.ensureTargets(640, 360, 4);
    expect(created).toHaveLength(n);                       // unchanged key: no churn
    post.ensureTargets(800, 450, 4);
    expect(created.length).toBeGreaterThan(n);             // resize re-creates
  });

  it('limits bloom levels to what fits on a small screen', () => {
    const { post, created } = setup();
    post.configure({ bloom: { levels: 8 } });
    post.ensureTargets(64, 64, 1);
    expect(created.filter((t) => t.label.startsWith('post-bloom')).length).toBe(3);   // log2(64) - 3
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

  it('allocates the aux, depth, AO and reflection targets only for the effects that are on', () => {
    const { post, created } = setup();
    post.configure({ ssao: true });
    post.ensureTargets(640, 360, 1);
    const labels = created.map((t) => t.label);
    expect(labels).toEqual(expect.arrayContaining(['post-aux', 'post-view-depth', 'post-ao-0', 'post-ao-1']));
    expect(labels).not.toContain('post-ssr');
    expect(labels).not.toContain('post-aux-msaa');
    expect(created.find((t) => t.label === 'post-view-depth')!.format).toBe('r32float');
    expect(created.find((t) => t.label === 'post-ao-0')!.format).toBe('r8unorm');

    created.length = 0;
    post.configure({ ssao: false, ssr: true, msaa: 4 });
    post.ensureTargets(640, 360, 4);
    const l2 = created.map((t) => t.label);
    expect(l2).toEqual(expect.arrayContaining(['post-aux', 'post-aux-msaa', 'post-view-depth', 'post-ssr']));
    expect(l2).not.toContain('post-ao-0');
    expect(created.find((t) => t.label === 'post-aux-msaa')).toMatchObject({ format: 'rgba16float', sampleCount: 4 });
  });

  it('orders aux -> depth -> ssao(+blur) / ssr -> composite', () => {
    const { post } = setup();
    post.configure({ ssao: true, ssr: true, fxaa: true });
    post.ensureTargets(512, 512, 1);
    const order = passOrder(post);
    expect(order).toEqual(['main', 'aux', 'post-depth', 'post-ssao', 'post-ssao-blur-h', 'post-ssao-blur-v', 'post-ssr', 'post-composite', 'post-fxaa']);

    post.configure({ ssao: false, fxaa: false });
    post.ensureTargets(512, 512, 1);
    expect(passOrder(post)).toEqual(['main', 'aux', 'post-depth', 'post-ssr', 'post-composite']);
  });

  it('declares bloom -> composite -> fxaa in dependency order, skipping unused stages', () => {
    const { post } = setup();
    post.configure({ bloom: true, fxaa: true });
    post.ensureTargets(512, 512, 1);
    expect(passOrder(post)).toEqual(['main', 'post-bloom', 'post-composite', 'post-fxaa']);

    post.configure({ bloom: false, fxaa: false });
    post.ensureTargets(512, 512, 1);
    expect(passOrder(post)).toEqual(['main', 'post-composite']);

    post.disable();
    post.ensureTargets(512, 512, 1);
    expect(passOrder(post)).toEqual(['main']);
  });
});
