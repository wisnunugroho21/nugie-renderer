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
        setBindGroup: (i: number, bg: unknown) => (pass.bindGroups as [number, unknown][]).push([i, bg]),
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
