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
