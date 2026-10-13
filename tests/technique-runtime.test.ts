import { beforeEach, describe, expect, it } from 'vitest';
import { makeFakeGPU } from './helpers/fakeGPU';
import { TechniqueInstance } from '../src/rendering/graph/TechniqueInstance';
import { hizPassTimestamps } from '../src/rendering/HiZ';
import type { GPUContext } from '../src/gpu/GPUContext';
import type { Technique } from '../src/rendering/graph/TechniqueTypes';

/** Every WebGPU usage flag the runtime reads (the shared fake only defines a few). */
function installFlags(): void {
  const g = globalThis as Record<string, unknown>;
  g.GPUBufferUsage = { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256 };
  g.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
  g.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
}

type Entry = Record<string, unknown>;

/** A recording device: enough of the GPUDevice surface for TechniqueInstance to build and execute compute / draw nodes. */
function setup() {
  installFlags();
  const fake = makeFakeGPU();
  const dev = fake.device as unknown as Record<string, unknown>;
  const log: Entry[] = [];
  dev.createBindGroupLayout = (d: Entry) => ({ kind: 'layout', d });
  dev.createPipelineLayout = (d: Entry) => { log.push({ t: 'pipelineLayout', d }); return { kind: 'pipelineLayout', d }; };
  dev.createComputePipeline = () => ({});
  dev.createRenderPipeline = () => ({});
  dev.createBindGroup = (d: Entry) => { log.push({ t: 'bindGroup', d }); return { kind: 'bindGroup', d }; };
  dev.createTexture = (d: Entry) => ({ ...d, createView: (v?: Entry) => { log.push({ t: 'view', v }); return { v }; }, destroy() {} });
  dev.createBuffer = (d: Entry) => ({ ...d, destroy() {} });
  const passes: Entry[] = [];
  const encoder = {
    beginComputePass: (d: Entry) => {
      const pass: Entry = { t: 'compute', d, bindGroups: [] as [number, unknown][] };
      passes.push(pass);
      return {
        setPipeline() {}, dispatchWorkgroups() {}, end() {}, dispatchWorkgroupsIndirect() {},
        setBindGroup: (i: number, bg: unknown, offsets?: number[]) => (pass.bindGroups as unknown[]).push([i, bg, offsets]),
      };
    },
  } as unknown as GPUCommandEncoder;
  const gpu = { device: fake.device, resources: fake.res, queue: fake.device.queue, format: 'bgra8unorm' } as unknown as GPUContext;
  return { gpu, log, passes, encoder, fake };
}

const buffer = (usage: number, size = 64) => ({ usage, size, destroy() {} }) as unknown as GPUBuffer;
const computeNode = (extra: Record<string, unknown> = {}) => ({
  type: 'compute', name: 'c', shader: { code: '@compute @workgroup_size(1) fn main() {}' }, workgroupSize: [1], dispatch: { threads: [1] },
  bindings: [{ resource: 'out', access: 'write' }], ...extra,
}) as Technique['nodes'][number];
const withBuffer = (nodes: Technique['nodes'], variables: Technique['variables'] = []): Technique => ({
  name: 't', variables, nodes, resources: [{ kind: 'buffer', name: 'out', element: 'u32', count: 4, visibility: 'imported' }],
});

describe('TechniqueInstance runtime', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  describe('host bind groups', () => {
    const hosted = () => withBuffer([computeNode({ group: 1, hostGroups: [{ group: 0, layout: 'frame' }, { group: 2, layout: 'scene' }] })]);

    it('puts the host layouts and the generated layout at their group indices, filling gaps', () => {
      const frame = { kind: 'host-frame' } as unknown as GPUBindGroupLayout, scene = { kind: 'host-scene' } as unknown as GPUBindGroupLayout;
      TechniqueInstance.create(ctx.gpu, hosted(), { imports: { out: buffer(128) }, hostLayouts: { frame, scene } });
      const layouts = (ctx.log.find((e) => e.t === 'pipelineLayout')!.d as { bindGroupLayouts: unknown[] }).bindGroupLayouts;
      expect(layouts).toHaveLength(3);
      expect(layouts[0]).toBe(frame);
      expect(layouts[2]).toBe(scene);
      expect((layouts[1] as { kind: string }).kind).toBe('layout');            // the technique's own, at group 1
    });

    it('fills a gap between groups with an empty layout', () => {
      const frame = { kind: 'host-frame' } as unknown as GPUBindGroupLayout;
      TechniqueInstance.create(ctx.gpu, withBuffer([computeNode({ group: 0, hostGroups: [{ group: 2, layout: 'frame' }] })]), { imports: { out: buffer(128) }, hostLayouts: { frame } });
      const layouts = (ctx.log.find((e) => e.t === 'pipelineLayout')!.d as { bindGroupLayouts: { d?: { entries: unknown[] } }[] }).bindGroupLayouts;
      expect(layouts).toHaveLength(3);
      expect(layouts[1].d!.entries).toEqual([]);
    });

    it('binds the generated group and the host groups on the pass, and says which one is missing', () => {
      const host = { frame: {} as GPUBindGroupLayout, scene: {} as GPUBindGroupLayout };
      const fx = TechniqueInstance.create(ctx.gpu, hosted(), { imports: { out: buffer(128) }, hostLayouts: host });
      expect(() => fx.execute(ctx.encoder)).toThrow(/no bind group was supplied for host layout 'frame'/);
      const frameBg = { name: 'f' } as unknown as GPUBindGroup, sceneBg = { name: 's' } as unknown as GPUBindGroup;
      fx.setHostBindGroup('frame', frameBg); fx.setHostBindGroup('scene', sceneBg);
      ctx.passes.length = 0;
      fx.execute(ctx.encoder);
      const bound = new Map(ctx.passes[0].bindGroups as [number, unknown][]);
      expect(bound.get(0)).toBe(frameBg);
      expect(bound.get(2)).toBe(sceneBg);
      expect((bound.get(1) as { kind: string }).kind).toBe('bindGroup');
    });

    it('refuses a host layout that the instance was not given', () => {
      expect(() => TechniqueInstance.create(ctx.gpu, hosted(), { imports: { out: buffer(128) }, hostLayouts: {} })).toThrow(/host layout 'frame' was not given/);
    });
  });

  describe('several generated bind groups and dynamic offsets', () => {
    /** Per-view data in group 1 (a uniform struct, one 256-byte slot per view, picked by a dynamic offset) and the output in group 0. */
    const twoGroups = (): Technique => ({
      name: 't',
      resources: [
        { kind: 'buffer', name: 'out', element: 'u32', count: 4, visibility: 'imported' },
        { kind: 'buffer', name: 'view', element: 'ViewData', stride: 256, count: 4, visibility: 'imported' },
      ],
      nodes: [computeNode({ bindings: [{ resource: 'out', access: 'write' }, { resource: 'view', access: 'read', uniform: true, dynamicOffset: true, group: 1 }] })],
    });
    const imports = () => ({ out: buffer(128), view: buffer(64 | 4, 1024) });

    it('creates a layout and a bind group per generated group, with the dynamic-offset flag and a one-element window', () => {
      TechniqueInstance.create(ctx.gpu, twoGroups(), { imports: imports() }).execute(ctx.encoder);
      const layouts = (ctx.log.find((e) => e.t === 'pipelineLayout')!.d as { bindGroupLayouts: { d: { entries: Entry[] } }[] }).bindGroupLayouts;
      expect(layouts).toHaveLength(2);
      expect(layouts[0].d.entries).toEqual([expect.objectContaining({ binding: 0, buffer: { type: 'storage' } })]);
      expect(layouts[1].d.entries).toEqual([expect.objectContaining({ binding: 0, buffer: { type: 'uniform', hasDynamicOffset: true } })]);
      const groups = ctx.log.filter((e) => e.t === 'bindGroup').map((e) => (e.d as { entries: { binding: number; resource: { size?: number } }[] }).entries);
      expect(groups).toHaveLength(2);
      expect(groups[1][0].resource.size).toBe(256);                                // the window is one element wide
      expect(groups[0][0].resource.size).toBeUndefined();                          // a plain storage binding covers the buffer
    });

    it('sets every group on the pass, with offsets only for the group that has dynamic bindings', () => {
      const fx = TechniqueInstance.create(ctx.gpu, twoGroups(), { imports: imports() });
      fx.execute(ctx.encoder);
      const calls = ctx.passes[0].bindGroups as [number, unknown, number[] | undefined][];
      expect(calls.map((c) => [c[0], c[2]])).toEqual([[0, undefined], [1, [0]]]);
    });

    it('records the offset current at each execute, so one technique can run once per view', () => {
      const fx = TechniqueInstance.create(ctx.gpu, twoGroups(), { imports: imports() });
      for (const offset of [0, 256, 768]) { fx.setDynamicOffset('c', 'view', offset); fx.execute(ctx.encoder); }
      expect(ctx.passes.map((p) => (p.bindGroups as [number, unknown, number[] | undefined][])[1][2])).toEqual([[0], [256], [768]]);
    });

    it('checks the offset and the binding it is set for', () => {
      const fx = TechniqueInstance.create(ctx.gpu, twoGroups(), { imports: imports() });
      expect(() => fx.setDynamicOffset('c', 'view', 100)).toThrow(/multiple of 256 bytes/);
      expect(() => fx.setDynamicOffset('c', 'view', -256)).toThrow(/multiple of 256 bytes/);
      expect(() => fx.setDynamicOffset('c', 'out', 0)).toThrow(/no dynamic-offset binding 'out'/);
      expect(() => fx.setDynamicOffset('nope', 'view', 0)).toThrow(/node 'nope' has no dynamic-offset binding/);
    });

    it('orders several dynamic bindings of one group by binding number', () => {
      const t: Technique = {
        name: 't',
        resources: [
          { kind: 'buffer', name: 'out', element: 'u32', count: 4, visibility: 'imported' },
          { kind: 'buffer', name: 'a', element: 'vec4<f32>', count: 16, visibility: 'imported' }, { kind: 'buffer', name: 'b', element: 'vec4<f32>', count: 16, visibility: 'imported' },
        ],
        nodes: [computeNode({ bindings: [
          { resource: 'out', access: 'write' },
          { resource: 'a', access: 'read', group: 1, dynamicOffset: true, name: 'first' }, { resource: 'b', access: 'read', group: 1, dynamicOffset: true, name: 'second' },
        ] })],
      };
      const fx = TechniqueInstance.create(ctx.gpu, t, { imports: { out: buffer(128), a: buffer(128 | 64, 1024), b: buffer(128 | 64, 1024) } });
      fx.setDynamicOffset('c', 'second', 512); fx.setDynamicOffset('c', 'first', 256);
      fx.execute(ctx.encoder);
      expect((ctx.passes[0].bindGroups as [number, unknown, number[] | undefined][])[1][2]).toEqual([256, 512]);
    });

    it('lets host groups fill the groups the generated ones do not use', () => {
      const t = twoGroups();
      (t.nodes[0] as { hostGroups?: unknown }).hostGroups = [{ group: 2, layout: 'scene' }];
      const scene = { kind: 'host-scene' } as unknown as GPUBindGroupLayout;
      const fx = TechniqueInstance.create(ctx.gpu, t, { imports: imports(), hostLayouts: { scene } });
      const layouts = (ctx.log.find((e) => e.t === 'pipelineLayout')!.d as { bindGroupLayouts: unknown[] }).bindGroupLayouts;
      expect(layouts).toHaveLength(3);
      expect(layouts[2]).toBe(scene);
      const sceneBg = {} as GPUBindGroup;
      fx.setHostBindGroup('scene', sceneBg);
      fx.execute(ctx.encoder);
      expect((ctx.passes[0].bindGroups as [number, unknown][]).map((c) => c[0])).toEqual([0, 1, 2]);
    });
  });

  describe('render nodes', () => {
    /** An encoder whose render passes log how they were begun, what was recorded in them and whether they ended. */
    const renderEncoder = () => {
      const begun: Entry[] = [], events: string[] = [];
      const encoder = {
        beginRenderPass: (d: Entry) => {
          begun.push(d); events.push('begin');
          return { setPipeline() {}, setBindGroup() {}, setVertexBuffer() {}, setIndexBuffer() {}, draw() { events.push('draw'); }, end() { events.push('end'); } };
        },
      } as unknown as GPUCommandEncoder;
      return { encoder, begun, events };
    };
    const attachmentTexture = (label: string, extra: Entry = {}) => ({
      label, usage: 16, format: 'rgba8unorm', width: 8, height: 8, sampleCount: 1, mipLevelCount: 1, destroy() {},
      createView: (v?: Entry) => ({ of: label, v }), ...extra,
    }) as unknown as GPUTexture;
    const target = (extra: Record<string, unknown> = {}): Technique['nodes'][number] => ({ type: 'render', name: 'r', record: () => {}, colorTargets: [{ resource: 'color' }], ...extra }) as never;
    const base = (nodes: Technique['nodes'], extra: Technique['resources'] = []): Technique => ({
      name: 't', nodes, resources: [{ kind: 'texture', name: 'color', format: 'rgba8unorm', size: [8, 8], visibility: 'imported' }, ...extra],
    });

    it('begins the pass, records the host draws through the tracking wrapper, then ends it', () => {
      const { encoder, events } = renderEncoder();
      let seen: unknown;
      const fx = TechniqueInstance.create(ctx.gpu, base([target({ record: (pass: { draw(n: number): void }) => { seen = pass; pass.draw(3); } })]), { imports: { color: attachmentTexture('color') } });
      fx.execute(encoder);
      expect(events).toEqual(['begin', 'draw', 'end']);
      expect(seen).toBeDefined();
    });

    it('ends the pass even when recording throws, and lets the error through', () => {
      const { encoder, events } = renderEncoder();
      const fx = TechniqueInstance.create(ctx.gpu, base([target({ record: () => { throw new Error('boom'); } })]), { imports: { color: attachmentTexture('color') } });
      expect(() => fx.execute(encoder)).toThrow('boom');
      expect(events).toEqual(['begin', 'end']);
    });

    it('builds the attachments: MSAA resolve with discard, a depth layer with its clear value, and a read-only depth', () => {
      const { encoder, begun } = renderEncoder();
      const t = base([
        target({ name: 'a', colorTargets: [{ resource: 'msaa', resolve: 'color', clearValue: [0, 0, 1, 0], storeOp: 'discard' }] }),
        target({ name: 'b', colorTargets: [], depthTarget: { resource: 'map', layer: 2, clearValue: 0.5 } }),
        target({ name: 'c', sideEffect: true, colorTargets: [], depthTarget: { resource: 'map', readOnly: true } }),
      ], [
        { kind: 'texture', name: 'msaa', format: 'rgba8unorm', size: [8, 8], samples: 4, visibility: 'imported' },
        { kind: 'texture', name: 'map', format: 'depth32float', dimension: '2d-array', size: [8, 8, 4], visibility: 'imported' },
      ]);
      const fx = TechniqueInstance.create(ctx.gpu, t, {
        imports: { color: attachmentTexture('color'), msaa: attachmentTexture('msaa', { sampleCount: 4 }), map: attachmentTexture('map', { format: 'depth32float', depthOrArrayLayers: 4 }) },
      });
      const writes = { querySet: {} as GPUQuerySet, beginningOfPassWriteIndex: 1 };
      fx.execute(encoder, { timestampWrites: (path) => (path === 'a' ? writes : undefined) });
      const [first, layered, readOnly] = begun as { colorAttachments: Entry[]; depthStencilAttachment: Entry; timestampWrites?: unknown; label: string }[];
      expect(first.label).toBe('a');
      expect(first.timestampWrites).toBe(writes);
      expect(first.colorAttachments[0]).toMatchObject({ view: { of: 'msaa' }, resolveTarget: { of: 'color' }, storeOp: 'discard', loadOp: 'clear', clearValue: [0, 0, 1, 0] });
      expect(layered.colorAttachments).toEqual([]);
      expect(layered.depthStencilAttachment).toMatchObject({ view: { of: 'map', v: { dimension: '2d', baseArrayLayer: 2, arrayLayerCount: 1 } }, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 0.5 });
      expect('timestampWrites' in layered).toBe(false);
      expect(readOnly.depthStencilAttachment).toEqual({ view: { of: 'map', v: { dimension: '2d', baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1 } }, depthReadOnly: true });
    });
  });

  describe('render pass segments and the main pass node', () => {
    const attachment = (label: string, extra: Entry = {}) => ({
      label, usage: 16 | 4, format: 'rgba8unorm', width: 8, height: 8, sampleCount: 1, mipLevelCount: 1, destroy() {},
      createView: (v?: Entry) => ({ of: label, v }), ...extra,
    }) as unknown as GPUTexture;
    const encoderWith = (events: string[]) => ({
      beginRenderPass: () => {
        events.push('begin');
        return { setPipeline() {}, setBindGroup() {}, draw() {}, end() { events.push('end'); } };
      },
    }) as unknown as GPUCommandEncoder;

    it('records the pass record, then the segments in order, through one tracking wrapper', () => {
      const events: string[] = [], wrappers = new Set<unknown>();
      const t: Technique = {
        name: 't', resources: [{ kind: 'texture', name: 'color', format: 'rgba8unorm', size: [8, 8], visibility: 'imported' }],
        nodes: [{
          type: 'render', name: 'r', colorTargets: [{ resource: 'color' }],
          record: (p: unknown) => { events.push('record'); wrappers.add(p); },
          segments: [{ name: 'a', record: (p: unknown) => { events.push('a'); wrappers.add(p); } }, { name: 'b', record: (p: unknown) => { events.push('b'); wrappers.add(p); } }],
        }] as never,
      };
      TechniqueInstance.create(ctx.gpu, t, { imports: { color: attachment('color') } }).execute(encoderWith(events));
      expect(events).toEqual(['begin', 'record', 'a', 'b', 'end']);
      expect(wrappers.size).toBe(1);
    });

    it('MainPassNode: draws its segments in order each frame with that frame\'s closures, and ends the pass', async () => {
      const { MainPassNode } = await import('../src/rendering/MainPassNode');
      const node = new MainPassNode(ctx.gpu, 'main');
      const targets = { final: attachment('final'), msaa: null, depth: attachment('depth', { format: 'depth24plus' }), clear: { r: 0, g: 0, b: 0, a: 1 } };
      const events: string[] = [];
      const frame = (tag: string) => ['scene', 'sky', 'particles'].map((name) => ({ name, record: () => { events.push(`${tag}:${name}`); } }));
      node.run(encoderWith(events), targets, { clear: true, depthLoad: false }, frame('f1'));
      node.run(encoderWith(events), targets, { clear: true, depthLoad: false }, frame('f2'));
      expect(events).toEqual(['begin', 'f1:scene', 'f1:sky', 'f1:particles', 'end', 'begin', 'f2:scene', 'f2:sky', 'f2:particles', 'end']);
    });

    it('MainPassNode: a different set of segments (a feature added) is recorded, in the new order', async () => {
      const { MainPassNode } = await import('../src/rendering/MainPassNode');
      const node = new MainPassNode(ctx.gpu, 'main');
      const targets = { final: attachment('final'), msaa: null, depth: attachment('depth', { format: 'depth24plus' }), clear: { r: 0, g: 0, b: 0, a: 1 } };
      const events: string[] = [];
      const seg = (name: string) => ({ name, record: () => { events.push(name); } });
      node.run(encoderWith(events), targets, { clear: true, depthLoad: false }, [seg('scene')]);
      node.run(encoderWith(events), targets, { clear: true, depthLoad: false }, [seg('scene'), seg('overlay'), seg('sky')]);
      expect(events.filter((e) => e !== 'begin' && e !== 'end')).toEqual(['scene', 'scene', 'overlay', 'sky']);
    });

    it('MainPassNode: draws into one face (array layer) of a cube capture and discards the depth', async () => {
      const { MainPassNode } = await import('../src/rendering/MainPassNode');
      const node = new MainPassNode(ctx.gpu, 'probe');
      const cube = attachment('cube', { depthOrArrayLayers: 6, format: 'rgba16float' });
      const targets = { final: cube, layer: 3, msaa: null, depth: attachment('depth', { format: 'depth24plus' }), clear: { r: 0.1, g: 0.2, b: 0.3, a: 1 } };
      const begun: Entry[] = [];
      const encoder = { beginRenderPass: (d: Entry) => { begun.push(d); return { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }; } } as unknown as GPUCommandEncoder;
      node.run(encoder, targets, { clear: true, depthLoad: false, depthStore: 'discard' }, [{ name: 'scene', record: () => {} }]);
      const pass = begun[0] as { colorAttachments: Entry[]; depthStencilAttachment: Entry };
      expect(pass.colorAttachments[0]).toMatchObject({ view: { of: 'cube', v: { dimension: '2d', baseArrayLayer: 3, arrayLayerCount: 1 } }, loadOp: 'clear', clearValue: [0.1, 0.2, 0.3, 1] });
      expect(pass.depthStencilAttachment).toMatchObject({ depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 1 });
    });
  });

  describe('copy and clear nodes', () => {
    /** An encoder that logs the copy / clear commands that reach it. */
    const copyEncoder = () => {
      const calls: unknown[][] = [];
      const log = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
      const encoder = { copyBufferToBuffer: log('buffer->buffer'), copyTextureToTexture: log('texture->texture'), copyTextureToBuffer: log('texture->buffer'), copyBufferToTexture: log('buffer->texture'), clearBuffer: log('clear') } as unknown as GPUCommandEncoder;
      return { encoder, calls };
    };
    const texture = (label: string, extra: Entry = {}) => ({ label, usage: 1 | 2 | 4, format: 'rgba8unorm', width: 16, height: 16, depthOrArrayLayers: 1, dimension: '2d', sampleCount: 1, mipLevelCount: 3, destroy() {}, createView: () => ({}), ...extra }) as unknown as GPUTexture;
    const buf = (size: number, usage = 4 | 8) => ({ size, usage, destroy() {} }) as unknown as GPUBuffer;
    const run = (nodes: Technique['nodes'], resources: Technique['resources'], imports: Record<string, GPUBuffer | GPUTexture>, variables: Technique['variables'] = []) => {
      const { encoder, calls } = copyEncoder();
      const fx = TechniqueInstance.create(ctx.gpu, { name: 't', variables, resources, nodes }, { imports });
      fx.execute(encoder);
      return { calls, fx, encoder };
    };
    const tex = (name: string, extra: Record<string, unknown> = {}) => ({ kind: 'texture', name, format: 'rgba8unorm', size: [16, 16], mips: 3, visibility: 'imported', ...extra }) as never;
    const buffer = (name: string) => ({ kind: 'buffer', name, element: 'u32', visibility: 'imported' }) as never;
    const node = (extra: Record<string, unknown>) => ({ type: 'copy', name: 'c', source: 'a', dest: 'b', ...extra }) as never;

    it('copies whole textures from mip 0, as before', () => {
      const { calls } = run([node({})], [tex('a'), tex('b')], { a: texture('a'), b: texture('b') });
      expect(calls).toEqual([['texture->texture', { texture: expect.anything(), mipLevel: 0, origin: { x: 0, y: 0, z: 0 } }, { texture: expect.anything(), mipLevel: 0, origin: { x: 0, y: 0, z: 0 } }, [16, 16, 1]]]);
    });

    it('copies the named mips, origins and extent between textures', () => {
      const { calls } = run([node({ from: { mip: 1, origin: [2, 1] }, to: { mip: 2 }, size: [4, 3] })], [tex('a'), tex('b')], { a: texture('a'), b: texture('b') });
      expect(calls[0].slice(1)).toEqual([
        { texture: expect.anything(), mipLevel: 1, origin: { x: 2, y: 1, z: 0 } }, { texture: expect.anything(), mipLevel: 2, origin: { x: 0, y: 0, z: 0 } }, [4, 3, 1],
      ]);
    });

    it('defaults the extent to what is left of the smaller mip from the origins', () => {
      const { calls } = run([node({ from: { mip: 1, origin: [2, 2] } })], [tex('a'), tex('b')], { a: texture('a'), b: texture('b') });
      expect(calls[0][3]).toEqual([6, 6, 1]);                                      // mip 1 of a is 8x8, minus the origin; b's mip 0 is 16x16
    });

    it('copies buffer ranges, with a size that may be a variable', () => {
      const { calls, fx } = run([node({ from: { offset: 8 }, to: { offset: 16 }, size: [{ variable: 'bytes' }] })], [buffer('a'), buffer('b')], { a: buf(256), b: buf(256) }, [{ name: 'bytes', type: 'uint', value: 64 }]);
      expect(calls[0].slice(1)).toEqual([expect.anything(), 8, expect.anything(), 16, 64]);
      fx.setVariable('bytes', 32);
      const again = copyEncoder();
      fx.execute(again.encoder);
      expect(again.calls[0][5]).toBe(32);
    });

    it('defaults a buffer copy to what the two have after their offsets', () => {
      const { calls } = run([node({ from: { offset: 16 } })], [buffer('a'), buffer('b')], { a: buf(256), b: buf(128) });
      expect(calls[0].slice(2).filter((v) => typeof v === 'number')).toEqual([16, 0, 128]);
    });

    it('reads a texture into a buffer with rows padded to 256 bytes (or the row layout given)', () => {
      const a = run([node({ size: [8, 4] })], [tex('a'), buffer('b')], { a: texture('a'), b: buf(4096) });
      expect(a.calls[0]).toEqual(['texture->buffer', { texture: expect.anything(), mipLevel: 0, origin: { x: 0, y: 0, z: 0 } }, { buffer: expect.anything(), offset: 0, bytesPerRow: 256, rowsPerImage: 4 }, [8, 4, 1]]);
      const b = run([node({ from: { mip: 1 }, to: { offset: 512, bytesPerRow: 512, rowsPerImage: 16 } })], [tex('a'), buffer('b')], { a: texture('a'), b: buf(8192) });
      expect(b.calls[0].slice(2)).toEqual([{ buffer: expect.anything(), offset: 512, bytesPerRow: 512, rowsPerImage: 16 }, [8, 8, 1]]);
    });

    it('writes a buffer into a texture with the same layout rules', () => {
      const { calls } = run([node({ source: 'a', dest: 'b', size: [8, 8] })], [buffer('a'), tex('b')], { a: buf(4096), b: texture('b') });
      expect(calls[0]).toEqual(['buffer->texture', { buffer: expect.anything(), offset: 0, bytesPerRow: 256, rowsPerImage: 8 }, { texture: expect.anything(), mipLevel: 0, origin: { x: 0, y: 0, z: 0 } }, [8, 8, 1]]);
    });

    it('copies array layers (the origin z) and keeps a 3D texture mip in depth', () => {
      const layered = (extra: Entry = {}) => texture('layered', { depthOrArrayLayers: 6, ...extra });
      const { calls } = run([node({ from: { origin: [0, 0, 2] }, to: { origin: [0, 0, 5] }, size: [16, 16, 1] })],
        [tex('a', { dimension: '2d-array', size: [16, 16, 6] }), tex('b', { dimension: '2d-array', size: [16, 16, 6] })], { a: layered(), b: layered() });
      expect(calls[0].slice(1, 3)).toEqual([{ texture: expect.anything(), mipLevel: 0, origin: { x: 0, y: 0, z: 2 } }, { texture: expect.anything(), mipLevel: 0, origin: { x: 0, y: 0, z: 5 } }]);
    });

    it('clears a buffer range: to the end by default, or a size that may be a variable', () => {
      const a = run([{ type: 'clear', name: 'z', resource: 'a', offset: 16 } as never], [buffer('a')], { a: buf(128) });
      expect(a.calls[0].slice(1)).toEqual([expect.anything(), 16, 112]);
      const b = run([{ type: 'clear', name: 'z', resource: 'a', size: { variable: 'n', scale: 4 } } as never], [buffer('a')], { a: buf(128) }, [{ name: 'n', type: 'uint', value: 5 }]);
      expect(b.calls[0].slice(1)).toEqual([expect.anything(), 0, 20]);
    });

    it('rejects an import without the copy usage the node needs', () => {
      const { fx } = run([node({})], [buffer('a'), buffer('b')], { a: buf(64), b: buf(64) });
      expect(() => fx.setImport('b', buf(64, 4))).toThrow(/lacks usage flags/);              // no COPY_DST
    });

    it('works with a device-only host (no resource managers) and refuses what needs them', () => {
      const bare = { device: ctx.gpu.device, queue: ctx.gpu.queue };
      const { encoder, calls } = copyEncoder();
      TechniqueInstance.create(bare, { name: 't', resources: [buffer('a'), buffer('b')], nodes: [node({})] }, { imports: { a: buf(64), b: buf(64) } }).execute(encoder);
      expect(calls).toHaveLength(1);
      const owns: Technique = { name: 't', resources: [{ kind: 'buffer', name: 'tmp', element: 'u32', count: 4 }, buffer('out')], nodes: [node({ source: 'tmp', dest: 'out' })] };
      expect(() => TechniqueInstance.create(bare, owns, { imports: { out: buf(64) } })).toThrow(/needs a GPUContext/);
    });
  });

  describe('execute options', () => {
    it('hands each compute node its timestamp writes by path, and skips nodes the callback ignores', () => {
      const t: Technique = {
        name: 't', resources: [{ kind: 'buffer', name: 'out', element: 'u32', count: 4, visibility: 'imported' }],
        nodes: [computeNode({ name: 'first' }), computeNode({ name: 'second', bindings: [{ resource: 'out', access: 'readwrite' }] })],
      };
      const fx = TechniqueInstance.create(ctx.gpu, t, { imports: { out: buffer(128) } });
      const writes = { querySet: {} as GPUQuerySet, beginningOfPassWriteIndex: 0 };
      fx.execute(ctx.encoder, { timestampWrites: (path) => (path === 'first' ? writes : undefined) });
      expect(ctx.passes.map((p) => (p.d as Entry).label)).toEqual(['first', 'second']);
      expect((ctx.passes[0].d as Entry).timestampWrites).toBe(writes);
      expect('timestampWrites' in (ctx.passes[1].d as Entry)).toBe(false);
    });
  });

  describe('imports', () => {
    const binds = () => ctx.log.filter((e) => e.t === 'bindGroup').length;

    it('rebuilds bind groups only when a bound import changes', () => {
      const first = buffer(128), second = buffer(128);
      const fx = TechniqueInstance.create(ctx.gpu, withBuffer([computeNode()]), { imports: { out: first } });
      fx.execute(ctx.encoder);
      const created = binds();
      fx.execute(ctx.encoder);
      expect(binds()).toBe(created);                                           // nothing changed
      fx.setImport('out', first);
      fx.execute(ctx.encoder);
      expect(binds()).toBe(created);                                           // same object: no work
      fx.setImport('out', second);
      fx.execute(ctx.encoder);
      expect(binds()).toBe(created + 1);                                       // a bound buffer was replaced
    });

    it('rebinds only the steps that bind a replaced import, and reuses bind groups for an import that cycles through a ring', () => {
      const ring = [buffer(128), buffer(128), buffer(128)];
      const t: Technique = {
        name: 't',
        resources: [{ kind: 'buffer', name: 'out', element: 'u32', count: 4, visibility: 'imported' }, { kind: 'buffer', name: 'other', element: 'u32', count: 4, visibility: 'imported' }],
        nodes: [computeNode(), computeNode({ name: 'd', bindings: [{ resource: 'other', access: 'write' }] })],
      };
      const fx = TechniqueInstance.create(ctx.gpu, t, { imports: { out: ring[0], other: buffer(128) } });
      fx.execute(ctx.encoder);
      expect(binds()).toBe(2);
      for (const b of ring.slice(1)) { fx.setImport('out', b); fx.execute(ctx.encoder); }
      expect(binds()).toBe(4);                                                 // one new set per ring slot, for the step that binds 'out' only
      for (let frame = 0; frame < 6; frame++) { fx.setImport('out', ring[frame % 3]); fx.execute(ctx.encoder); }
      expect(binds()).toBe(4);                                                 // the ring's sets are reused
      const used = ctx.passes.slice(-2).map((p) => (p.bindGroups as [number, { d: { entries: { resource: { buffer: unknown } }[] } }][])[0][1].d.entries[0].resource.buffer);
      expect(used[0]).toBe(ring[2]);                                           // and the right one is bound
    });

    it('does not rebuild bind groups when only a render target import changes (a swap chain image per frame)', () => {
      const target = (id: number) => ({ id, usage: 16, format: 'rgba8unorm', width: 4, height: 4, sampleCount: 1, mipLevelCount: 1, createView: () => ({}), destroy() {} }) as unknown as GPUTexture;
      const t: Technique = {
        name: 't', resources: [{ kind: 'texture', name: 'screen', format: 'rgba8unorm', size: [4, 4], visibility: 'imported' }],
        nodes: [{ type: 'draw', name: 'd', shader: { code: 'x' }, bindings: [], colorTargets: [{ resource: 'screen' }], vertexCount: 3 }],
      };
      const fx = TechniqueInstance.create(ctx.gpu, t, { imports: { screen: target(1) } });
      const frameEncoder = { beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }) } as unknown as GPUCommandEncoder;
      fx.execute(frameEncoder);
      const created = binds();
      fx.setImport('screen', target(2));
      fx.execute(frameEncoder);
      expect(binds()).toBe(created);
    });

    it('rejects a buffer that lacks the usage the nodes need', () => {
      const fx = TechniqueInstance.create(ctx.gpu, withBuffer([computeNode()]), { imports: { out: buffer(128) } });
      expect(() => fx.setImport('out', buffer(4))).toThrow(/lacks usage flags/);
    });
  });

  describe('mip views', () => {
    it('creates the view of the bound mip range, and one-level views for storage', () => {
      const t: Technique = {
        name: 't', resources: [{ kind: 'texture', name: 'pyramid', format: 'r32float', size: [8, 8], mips: 'full', visibility: 'exported' }],
        nodes: [{
          type: 'compute', name: 'down', shader: { code: '@compute @workgroup_size(8, 8) fn main() {}' }, workgroupSize: [8, 8], dispatch: { threads: [4, 4] },
          bindings: [{ resource: 'pyramid', access: 'read', name: 'src', mip: 1, mipCount: 1 }, { resource: 'pyramid', access: 'write', name: 'dst', mip: 2 }],
        }],
      };
      const fx = TechniqueInstance.create(ctx.gpu, t);
      fx.execute(ctx.encoder);
      const views = ctx.log.filter((e) => e.t === 'view').map((e) => e.v);
      expect(views).toContainEqual({ dimension: '2d', baseMipLevel: 1, mipLevelCount: 1 });
      expect(views).toContainEqual({ dimension: '2d', baseMipLevel: 2, mipLevelCount: 1 });
    });
  });

  describe('variables', () => {
    const fx = () => TechniqueInstance.create(ctx.gpu, withBuffer([computeNode({ shader: { code: '@compute @workgroup_size(1) fn main() { let v = /*$(Variable:tint)*/; let n = /*$(Variable:n)*/; }' } })], [
      { name: 'tint', type: 'float4', value: [0, 0, 0, 1] }, { name: 'n', type: 'uint', value: 1 },
    ]), { imports: { out: buffer(128) } });
    const uniformWrites = () => ctx.fake.writes.filter((w) => w.label.endsWith(':variables')).length;

    it('copies float4 values, so a reused scratch array is picked up again', () => {
      const f = fx();
      const scratch = [1, 0, 0, 1];
      f.setVariable('tint', scratch);
      scratch[0] = 0.5;
      f.setVariable('tint', scratch);
      expect(f.getVariable('tint')).toEqual([0.5, 0, 0, 1]);
    });

    it('writes the uniform only when a value changed, for setVariable and setVector alike', () => {
      const f = fx();
      f.execute(ctx.encoder);
      const base = uniformWrites();
      f.setVariable('tint', [0, 0, 0, 1]); f.setVector('tint', [0, 0, 0, 1]); f.setVariable('n', 1);
      f.execute(ctx.encoder);
      expect(uniformWrites()).toBe(base);                                      // all equal to the current values
      f.setVector('tint', [9, 0.25, 0.5, 1, 7], 1);                            // offset 1: (0.25, 0.5, 1, 7)
      f.execute(ctx.encoder);
      expect(f.getVariable('tint')).toEqual([0.25, 0.5, 1, 7]);
      expect(uniformWrites()).toBe(base + 1);
    });

    it('rewrites only the uniforms of the steps that read a changed variable', () => {
      const node = (name: string, variable: string) => computeNode({ name, shader: { code: `@compute @workgroup_size(1) fn main() { let v = /*$(Variable:${variable})*/; }` } });
      const f = TechniqueInstance.create(ctx.gpu, withBuffer([node('a', 'n'), node('b', 'm')], [{ name: 'n', type: 'uint' }, { name: 'm', type: 'uint' }]), { imports: { out: buffer(128) } });
      f.execute(ctx.encoder);
      const written = () => ctx.fake.writes.filter((w) => w.label.endsWith(':variables')).map((w) => w.label);
      const base = written().length;
      expect(base).toBe(2);                                                    // both written once at first
      f.setVariable('n', 3);
      f.execute(ctx.encoder);
      expect(written().slice(base)).toEqual(['a:variables']);
    });

    it('sets consecutive float4 variables from one array', () => {
      const t: Technique = { name: 't', variables: [0, 1].map((i) => ({ name: `row${i}`, type: 'float4' as const })), nodes: [], resources: [] };
      const f = TechniqueInstance.create(ctx.gpu, t);
      f.setVectors('row', [1, 2, 3, 4, 5, 6, 7, 8], 2);
      expect(f.getVariable('row0')).toEqual([1, 2, 3, 4]);
      expect(f.getVariable('row1')).toEqual([5, 6, 7, 8]);
    });

    it('names the unknown variable', () => {
      expect(() => fx().setVariable('nope', 1)).toThrow(/no variable 'nope'/);
    });
  });
});

describe('hizPassTimestamps', () => {
  const whole = { querySet: {} as GPUQuerySet, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 };

  it('gives the first pass the start and the last pass the end of the whole build', () => {
    expect(hizPassTimestamps('hiz-init', 4, whole)).toEqual({ querySet: whole.querySet, beginningOfPassWriteIndex: 2 });
    expect(hizPassTimestamps('hiz-down-1', 4, whole)).toBeUndefined();
    expect(hizPassTimestamps('hiz-down-3', 4, whole)).toEqual({ querySet: whole.querySet, endOfPassWriteIndex: 3 });
  });

  it('puts both on the only pass of a one-level pyramid', () => {
    expect(hizPassTimestamps('hiz-init', 1, whole)).toEqual({ querySet: whole.querySet, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 });
  });
});
