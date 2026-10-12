import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileTechnique } from '../src/rendering/graph/Compile';
import { flatten } from '../src/rendering/graph/Flatten';
import { expandShader } from '../src/rendering/graph/ShaderTokens';
import { parseTechnique, techniqueToJSON } from '../src/rendering/graph/TechniqueJSON';
import { techniqueToDot } from '../src/rendering/graph/Dot';
import { RenderGraph } from '../src/rendering/RenderGraph';
import { TechniqueError, type ComputeNode, type NodeDecl, type ResourceDecl, type Technique, type VariableDecl } from '../src/rendering/graph/TechniqueTypes';

const tex = (name: string, extra: Partial<Extract<ResourceDecl, { kind: 'texture' }>> = {}): ResourceDecl => ({ kind: 'texture', name, format: 'rgba8unorm', size: [64, 64], ...extra });
/** A compute node that reads `reads` and writes `writes` (textures). */
const pass = (name: string, reads: string[], writes: string[], extra: Partial<ComputeNode> = {}): ComputeNode => ({
  type: 'compute', name, shader: { code: '@compute @workgroup_size(8, 8) fn main() {}' },
  bindings: [...reads.map((r) => ({ resource: r, access: 'read' as const })), ...writes.map((r) => ({ resource: r, access: 'write' as const }))],
  dispatch: { threads: [64, 64] }, ...extra,
});
const technique = (nodes: NodeDecl[], resources: ResourceDecl[], variables: VariableDecl[] = [], name = 't'): Technique => ({ name, variables, resources, nodes });
const names = (t: ReturnType<typeof compileTechnique>) => t.steps.map((s) => s.node.path);

describe('compile: order, culling, roots', () => {
  it('orders by dependency regardless of declaration order and keeps what feeds an exported resource', () => {
    const t = compileTechnique(technique(
      [pass('shade', ['depth', 'shadow'], ['out']), pass('depth', [], ['depth']), pass('shadow', [], ['shadow']), pass('unused', [], ['scratch'])],
      [tex('depth'), tex('shadow'), tex('scratch'), tex('out', { visibility: 'exported' })],
    ));
    expect(names(t)).toEqual(['depth', 'shadow', 'shade']);
    expect(t.culled).toEqual(['unused']);
    expect(t.unused).toEqual(['scratch']);
  });
  it('lets a node read the incoming contents of an imported or persistent resource that a later node overwrites', () => {
    // e.g. an effect that reads the host's scene texture into a scratch image, then a copy writes the result back over the scene
    for (const extra of [{ visibility: 'imported' as const }, { lifetime: 'persistent' as const }]) {
      const copy: NodeDecl = { type: 'copy', name: 'write-back', source: 'scratch', dest: 'scene' };
      const t = compileTechnique(technique([pass('effect', ['scene'], ['scratch']), copy], [tex('scene', extra), tex('scratch')]));
      expect(names(t)).toEqual(['effect', 'write-back']);
    }
    // an internal transient resource read before any write still waits for its producer
    const forward = compileTechnique(technique([pass('use', ['late'], ['out']), pass('make', [], ['late'])], [tex('late'), tex('out', { visibility: 'exported' })]));
    expect(names(forward)).toEqual(['make', 'use']);
  });
  it('treats writes to imported and persistent resources as outputs', () => {
    const t = compileTechnique(technique(
      [pass('a', [], ['host']), pass('b', [], ['history']), pass('c', [], ['tmp'])],
      [tex('host', { visibility: 'imported' }), tex('history', { lifetime: 'persistent' }), tex('tmp')],
    ));
    expect(names(t)).toEqual(['a', 'b']);
    expect(t.culled).toEqual(['c']);
  });
  it('warns when a transient resource is read before anything writes it', () => {
    const t = compileTechnique(technique([pass('use', ['never'], ['out'])], [tex('never'), tex('out', { visibility: 'exported' })]));
    expect(t.diagnostics.some((d) => d.level === 'warning' && /never.*before any node writes/.test(d.message))).toBe(true);
    const persistent = compileTechnique(technique([pass('use', ['hist'], ['out'])], [tex('hist', { lifetime: 'persistent' }), tex('out', { visibility: 'exported' })]));
    expect(persistent.diagnostics).toEqual([]);
  });
  it('detects dependency cycles', () => {
    const cyc = technique([pass('p', ['b'], ['a'], { sideEffect: true }), pass('q', ['a'], ['b'], { sideEffect: true })], [tex('a'), tex('b')]);
    expect(() => compileTechnique(cyc)).toThrow(/cycle/);
  });
});

describe('compile: lifetimes and memory aliasing', () => {
  // a -> b -> c -> d chain: a and c never live at once, b overlaps both
  const chain = (extra: Partial<Parameters<typeof tex>[1]> = {}) => technique(
    [pass('n1', [], ['a']), pass('n2', ['a'], ['b']), pass('n3', ['b'], ['c']), pass('n4', ['c'], ['out'])],
    [tex('a', extra), tex('b'), tex('c'), tex('out', { visibility: 'exported' })],
  );
  it('records first / last use per resource', () => {
    const t = compileTechnique(chain());
    expect([t.resources.get('a')!.first, t.resources.get('a')!.last]).toEqual([0, 1]);
    expect([t.resources.get('c')!.first, t.resources.get('c')!.last]).toEqual([2, 3]);
  });
  it('lets transient resources with disjoint lifetimes share one allocation', () => {
    const t = compileTechnique(chain());
    expect(t.resources.get('a')!.slot).toBe(t.resources.get('c')!.slot);
    expect(t.resources.get('b')!.slot).not.toBe(t.resources.get('a')!.slot);
    const each = 64 * 64 * 4;
    expect(t.stats.bytes).toBe(4 * each);
    expect(t.stats.bytesAliased).toBe(3 * each);   // a+c share, b and out are separate
    expect(t.stats.slots).toBe(3);
    expect(new Set(t.slots.map((x) => x.key)).size).toBe(t.slots.length);   // equal descriptions, different slots: the keys must differ
  });
  it('never aliases persistent, exported or differently described resources, and can be switched off', () => {
    expect(compileTechnique(chain({ lifetime: 'persistent' })).resources.get('a')!.slot).not.toBe(compileTechnique(chain({ lifetime: 'persistent' })).resources.get('c')!.slot);
    expect(compileTechnique(chain({ format: 'rgba16float' })).stats.slots).toBe(4);
    expect(compileTechnique(chain(), { alias: false }).stats.slots).toBe(4);
  });
  it('does not alias a resource read by the node that first writes the other (no in-place hazard)', () => {
    const t = compileTechnique(technique([pass('n1', [], ['a']), pass('n2', ['a'], ['b']), pass('n3', ['b'], ['out'])], [tex('a'), tex('b'), tex('out', { visibility: 'exported' })]));
    expect(t.resources.get('a')!.slot).not.toBe(t.resources.get('b')!.slot);
  });
  it('records how resources are used, for the GPU usage flags', () => {
    const t = compileTechnique(chain());
    expect([...t.resources.get('a')!.uses].sort()).toEqual(['sampled', 'storage']);
    expect(t.resources.get('out')!.uses.has('copy-src')).toBe(true);   // exported: the host may read it back or sample it
    expect(t.resources.get('out')!.uses.has('sampled')).toBe(true);
  });
});

describe('variables and sizes', () => {
  const base = (width: number) => compileTechnique(technique(
    [pass('a', [], ['half'])], [tex('full', { size: [{ variable: 'width' }, { variable: 'height' }] }), tex('half', { like: 'full', scale: 0.5, size: undefined, visibility: 'exported' })],
    [{ name: 'width', type: 'uint', value: width }, { name: 'height', type: 'uint', value: 90 }],
  ));
  it('sizes resources from variables and from other resources', () => {
    const t = base(160);
    expect(t.resources.get('full')!.resolved).toMatchObject({ size: [160, 90, 1] });
    expect(t.resources.get('half')!.resolved).toMatchObject({ size: [80, 45, 1], format: 'rgba8unorm' });
    expect(t.structural.has('width')).toBe(true);
  });
  it('applies scale / offset and rejects sizes below one', () => {
    const t = compileTechnique(technique([pass('a', [], ['x'])], [tex('x', { size: [{ variable: 'n', scale: 2, offset: 1 }, 4], visibility: 'exported' })], [{ name: 'n', type: 'float', value: 3.6 }]));
    expect((t.resources.get('x')!.resolved as { size: number[] }).size[0]).toBe(8);
    expect(() => base(0)).toThrow(/at least 1/);
  });
  it('overrides defaults through options and rejects unknown names', () => {
    const t = compileTechnique(technique([pass('a', [], ['x'])], [tex('x', { size: [{ variable: 'w' }, 2], visibility: 'exported' })], [{ name: 'w', type: 'uint', value: 4 }]), { values: { w: 32 } });
    expect((t.resources.get('x')!.resolved as { size: number[] }).size[0]).toBe(32);
    expect(() => compileTechnique(technique([], [], []), { values: { nope: 1 } })).toThrow(/no variable named 'nope'/);
  });
  it('switches nodes off with conditions and treats the variable as structural', () => {
    const tech = technique([pass('always', [], ['o']), pass('maybe', [], ['o2'], { condition: { variable: 'on', op: 'eq', value: 1 } })], [tex('o', { visibility: 'exported' }), tex('o2', { visibility: 'exported' })], [{ name: 'on', type: 'int', value: 0 }]);
    const off = compileTechnique(tech), on = compileTechnique(tech, { values: { on: 1 } });
    expect(names(off)).toEqual(['always']); expect(off.disabled).toEqual(['maybe']);
    expect(names(on)).toEqual(['always', 'maybe']);
    expect(off.structural.has('on')).toBe(true);
  });
  it('computes buffer sizes from element types', () => {
    const t = compileTechnique(technique([{ type: 'compute', name: 'fill', shader: { code: '' }, workgroupSize: [64], bindings: [{ resource: 'b', access: 'write' }], dispatch: { threads: [100] } }],
      [{ kind: 'buffer', name: 'b', element: 'vec4<f32>', count: 100, visibility: 'exported' }]));
    expect(t.resources.get('b')!.bytes).toBe(1600);
    expect(() => compileTechnique(technique([], [{ kind: 'buffer', name: 'b', element: 'MyStruct', count: 4 }]))).toThrow(/stride/);
  });
});

describe('sub-graphs', () => {
  // one blur step: reads `src`, writes `dst`; `radius` is a variable, `loopIndex` is filled in per iteration
  const blur: Technique = technique(
    [pass('h', ['src'], ['tmp']), pass('v', ['tmp'], ['dst'])],
    [tex('src', { visibility: 'imported' }), tex('tmp'), tex('dst', { visibility: 'exported' })],
    [{ name: 'radius', type: 'float', value: 1 }, { name: 'loopIndex', type: 'uint', value: 0, visibility: 'internal' }], 'blur',
  );
  const parent = (loop?: number | { variable: string }, extra: Partial<NodeDecl> = {}): Technique => technique(
    [pass('make', [], ['scene']), { type: 'subgraph', name: 'blur', technique: blur, inputs: { src: 'scene' }, outputs: { dst: 'result' }, variables: { radius: { bind: 'strength' } }, ...(loop !== undefined ? { loop } : {}), ...extra } as NodeDecl],
    [tex('scene'), tex('result', { visibility: 'exported' })], [{ name: 'strength', type: 'float', value: 2 }], 'parent',
  );
  it('inlines the sub-graph, mapping imports and exports to the parent resources', () => {
    const f = flatten(parent());
    expect(f.nodes.map((n) => n.path)).toEqual(['make', 'blur/h', 'blur/v']);
    expect([...f.resources.keys()].sort()).toEqual(['blur/tmp', 'result', 'scene']);
    expect(f.variables.has('blur/radius')).toBe(false);   // bound to the parent's 'strength'
    const c = compileTechnique(parent());
    expect(names(c)).toEqual(['make', 'blur/h', 'blur/v']);
  });
  it('unrolls loops; every iteration gets its own internals and loopIndex', () => {
    const f = flatten(parent(3));
    expect(f.nodes.map((n) => n.path)).toEqual(['make', 'blur#0/h', 'blur#0/v', 'blur#1/h', 'blur#1/v', 'blur#2/h', 'blur#2/v']);
    expect(f.variables.get('blur#2/loopIndex')!.value).toBe(2);
    expect(f.resources.has('blur#1/tmp')).toBe(true);
  });
  it('takes loop counts from variables (structural) and bounds them', () => {
    const tech = { ...parent({ variable: 'passes' }), variables: [{ name: 'strength', type: 'float' as const, value: 2 }, { name: 'passes', type: 'uint' as const, value: 2 }] };
    expect(flatten(tech).nodes).toHaveLength(5);
    expect(compileTechnique(tech).structural.has('passes')).toBe(true);
    expect(() => flatten(parent(100000))).toThrow(/loop count/);
  });
  it('applies value overrides, and conditions of the sub-graph node to everything inside it', () => {
    const tech: Technique = { ...parent(undefined, { variables: { radius: { value: 5 } }, condition: { variable: 'strength', op: 'gt', value: 10 } }) };
    expect(flatten(tech).variables.get('blur/radius')!.value).toBe(5);
    expect(names(compileTechnique(tech))).toEqual([]);   // 'make' only feeds the blur, which is switched off: nothing is kept
  });
  it('resolves registry names and rejects missing inputs, bad names and recursion', () => {
    const byName = technique([{ type: 'subgraph', name: 'b', technique: 'blur', inputs: { src: 'scene' }, outputs: { dst: 'result' } }, pass('make', [], ['scene'])], [tex('scene'), tex('result', { visibility: 'exported' })]);
    expect(names(compileTechnique(byName, { registry: { blur } }))).toEqual(['make', 'b/h', 'b/v']);
    expect(() => compileTechnique(byName)).toThrow(/no technique named 'blur'/);
    expect(() => compileTechnique({ ...byName, nodes: [{ type: 'subgraph', name: 'b', technique: blur }] })).toThrow(/no input/);
    expect(() => compileTechnique({ ...byName, nodes: [{ type: 'subgraph', name: 'b', technique: blur, inputs: { nope: 'scene' } }] })).toThrow(/no resource 'nope'/);
    const loopy: Technique = { name: 'loopy', nodes: [] };
    loopy.nodes.push({ type: 'subgraph', name: 'again', technique: loopy });
    expect(() => compileTechnique(loopy)).toThrow(/contains itself/);
  });
  it('checks that mapped resources have the same kind and format', () => {
    const bad = technique([{ type: 'subgraph', name: 'b', technique: { ...blur, resources: [tex('src', { visibility: 'imported', format: 'r32float' }), ...(blur.resources ?? []).slice(1)] }, inputs: { src: 'scene' }, outputs: { dst: 'result' } }], [tex('scene'), tex('result', { visibility: 'exported' })]);
    expect(() => compileTechnique(bad)).toThrow(/expects r32float/);
  });
});

describe('validation', () => {
  const run = (nodes: NodeDecl[], resources: ResourceDecl[]) => () => compileTechnique(technique(nodes, resources));
  it('rejects undeclared resources and variables, duplicates and bad binding names', () => {
    expect(run([pass('a', ['ghost'], [])], [])).toThrow(/'ghost' is not declared/);
    expect(run([pass('a', [], []), pass('a', [], [])], [])).toThrow(/declared twice/);
    expect(run([], [tex('x'), tex('x')])).toThrow(/declared twice/);
    expect(run([pass('a', [], ['x'], { condition: { variable: 'v', op: 'eq', value: 1 } })], [tex('x')])).toThrow(/variable 'v' is not declared/);
    expect(run([{ ...pass('a', [], []), bindings: [{ resource: 'x', access: 'read', name: 'bad name' }] }], [tex('x')])).toThrow(/valid WGSL identifier/);
  });
  it('rejects bindings WebGPU would refuse', () => {
    expect(run([pass('a', [], ['x'])], [tex('x', { format: 'rgba8unorm-srgb' })])).toThrow(/cannot be bound for write/);
    expect(run([{ ...pass('a', [], []), bindings: [{ resource: 'x', access: 'readwrite' }] }], [tex('x')])).toThrow(/'write' but not 'readwrite'/);
    expect(run([{ ...pass('a', [], []), bindings: [{ resource: 'x', access: 'read' }, { resource: 'x', access: 'write', name: 'x2' }] }], [tex('x')])).toThrow(/conflicting usage/);
    expect(run([{ ...pass('a', [], []), bindings: [{ resource: 'x', access: 'write', sampler: 'linear' }] }], [tex('x')])).toThrow(/only sampled/);
  });
  it('validates copies and draws', () => {
    expect(run([{ type: 'copy', name: 'c', source: 'a', dest: 'b' }], [tex('a'), tex('b', { size: [32, 32] })])).toThrow(/same format and size/);
    expect(run([{ type: 'copy', name: 'c', source: 'a', dest: 'b' }], [tex('a'), { kind: 'buffer', name: 'b', count: 4 }])).toThrow(/cannot copy a texture to a buffer/);
    const draw = (targets: string[], depth?: string): NodeDecl => ({ type: 'draw', name: 'd', shader: { code: '' }, bindings: [], colorTargets: targets.map((resource) => ({ resource })), ...(depth ? { depthTarget: { resource: depth } } : {}), vertexCount: 3 });
    expect(run([draw(['a', 'b'])], [tex('a'), tex('b', { size: [8, 8] })])).toThrow(/differ in size/);
    expect(run([draw(['d'])], [tex('d', { format: 'depth32float' })])).toThrow(/depth format/);
    expect(run([draw([], 'a')], [tex('a')])).toThrow(/depth format/);
    expect(run([draw([])], [])).toThrow(/at least one/);
  });
  describe('draw: vertex buffers', () => {
    const vb = (extra: Record<string, unknown> = {}) => ({ resource: 'verts', attributes: [{ location: 0, format: 'float32x3', offset: 0 }, { location: 1, format: 'float32x2', offset: 12 }], ...extra });
    const verts = (extra: Partial<Extract<ResourceDecl, { kind: 'buffer' }>> = {}): ResourceDecl => ({ kind: 'buffer', name: 'verts', stride: 20, count: 8, visibility: 'imported', ...extra });
    const draw = (extra: Record<string, unknown> = {}): NodeDecl => ({ type: 'draw', name: 'd', shader: { code: 'x' }, bindings: [], colorTargets: [{ resource: 'rt' }], ...extra } as NodeDecl);
    const rt = tex('rt', { visibility: 'exported' });
    it('derives the vertex count from the buffer and tracks the vertex usage', () => {
      const t = compileTechnique(technique([draw({ vertexBuffers: [vb()] })], [rt, verts()]));
      expect(t.resources.get('verts')!.uses.has('vertex')).toBe(true);
      expect(t.steps[0].accesses.find((a) => a.resource === 'verts')).toMatchObject({ usage: 'vertex', read: true, write: false });
    });
    it('requires a count when nothing per-vertex supplies one', () => {
      expect(() => compileTechnique(technique([draw()], [rt]))).toThrow(/set vertexCount/);
      expect(() => compileTechnique(technique([draw({ vertexBuffers: [vb({ stepMode: 'instance' })] })], [rt, verts()]))).toThrow(/set vertexCount/);
      expect(() => compileTechnique(technique([draw({ vertexBuffers: [vb({ stepMode: 'instance' })], vertexCount: 3 })], [rt, verts()]))).not.toThrow();
    });
    it('validates attributes against WebGPU rules', () => {
      const bad = (v: Record<string, unknown>) => () => compileTechnique(technique([draw({ vertexBuffers: [vb(v)] })], [rt, verts()]));
      expect(bad({ attributes: [] })).toThrow(/at least one attribute/);
      expect(bad({ attributes: [{ location: 0, format: 'float32x4', offset: 8 }] })).toThrow(/does not fit in a 20-byte/);
      expect(bad({ attributes: [{ location: 0, format: 'float32x2', offset: 0 }, { location: 0, format: 'float32', offset: 8 }] })).toThrow(/@location\(0\) is used by two/);
      expect(bad({ attributes: [{ location: 0, format: 'float32x2', offset: 2 }] })).toThrow(/not aligned/);
      expect(bad({ attributes: [{ location: 0, format: 'float99', offset: 0 }] })).toThrow(/unknown vertex format/);
      expect(bad({ attributes: [{ location: 16, format: 'float32', offset: 0 }] })).toThrow(/from 0 to 15/);
      expect(bad({ arrayStride: 6 })).toThrow(/multiple of 4/);
    });
    it('needs a buffer, and conflicts with a storage binding of the same buffer', () => {
      expect(() => compileTechnique(technique([draw({ vertexBuffers: [vb({ resource: 'rt' })] })], [rt]))).toThrow(/must be a buffer/);
      expect(() => compileTechnique(technique([draw({ vertexBuffers: [vb()], bindings: [{ resource: 'verts', access: 'read' }] })], [rt, verts()]))).toThrow(/conflicting usage/);
    });
    it('keeps work that feeds a vertex buffer alive', () => {
      const gen: NodeDecl = { type: 'compute', name: 'gen', shader: { code: '' }, workgroupSize: [8], bindings: [{ resource: 'verts', access: 'write' }], dispatch: { threads: [8] } };
      const t = compileTechnique(technique([gen, draw({ vertexBuffers: [vb()] })], [rt, verts({ visibility: 'internal' })]));
      expect(names(t)).toEqual(['gen', 'd']);
    });
    it('round-trips through JSON and rejects unknown keys', () => {
      const t = technique([draw({ vertexBuffers: [vb()] })], [rt, verts()]);
      expect(parseTechnique(JSON.parse(techniqueToJSON(t)))).toEqual(t);
      const j = JSON.parse(techniqueToJSON(t));
      j.nodes[0].vertexBuffers[0].stride = 4;
      expect(() => parseTechnique(j)).toThrow(/vertexBuffers\[0\]\.stride: unknown field/);
    });
  });

  describe('draw: index buffers', () => {
    const rt = tex('rt', { visibility: 'exported' });
    const idx = (extra: Partial<Extract<ResourceDecl, { kind: 'buffer' }>> = {}): ResourceDecl => ({ kind: 'buffer', name: 'idx', count: 6, visibility: 'imported', ...extra });
    const draw = (extra: Record<string, unknown> = {}): NodeDecl => ({ type: 'draw', name: 'd', shader: { code: 'x' }, bindings: [], colorTargets: [{ resource: 'rt' }], ...extra } as NodeDecl);
    it('needs no vertexCount, tracks the index usage', () => {
      const t = compileTechnique(technique([draw({ indexBuffer: { resource: 'idx', format: 'uint16' } })], [rt, idx()]));
      expect(t.resources.get('idx')!.uses.has('index')).toBe(true);
      expect(t.steps[0].accesses.find((a) => a.resource === 'idx')).toMatchObject({ usage: 'index', read: true, write: false });
    });
    it('validates the binding', () => {
      expect(() => compileTechnique(technique([draw({ indexBuffer: { resource: 'rt' } })], [rt]))).toThrow(/must be a buffer/);
      expect(() => compileTechnique(technique([draw({ indexBuffer: { resource: 'idx', format: 'uint16', offset: 3 } })], [rt, idx()]))).toThrow(/multiple of 2/);
      expect(() => compileTechnique(technique([draw({ indexBuffer: { resource: 'idx', offset: 2 } })], [rt, idx()]))).toThrow(/multiple of 4/);
      expect(() => compileTechnique(technique([draw({ indexBuffer: { resource: 'idx', format: 'uint8' } })], [rt, idx()]))).toThrow(/uint16 or uint32/);
      expect(() => compileTechnique(technique([draw({ indexCount: 3, vertexCount: 3 })], [rt]))).toThrow(/needs an indexBuffer/);
    });
    it('round-trips through JSON', () => {
      const t = technique([draw({ indexBuffer: { resource: 'idx', format: 'uint16', offset: 4 }, indexCount: 6 })], [rt, idx()]);
      expect(parseTechnique(JSON.parse(techniqueToJSON(t)))).toEqual(t);
    });
  });

  describe('draw: baseVertex and indirect', () => {
    const rt = tex('rt', { visibility: 'exported' });
    const buf = (name: string, extra: Partial<Extract<ResourceDecl, { kind: 'buffer' }>> = {}): ResourceDecl => ({ kind: 'buffer', name, count: 8, visibility: 'imported', ...extra });
    const draw = (extra: Record<string, unknown> = {}): NodeDecl => ({ type: 'draw', name: 'd', shader: { code: 'x' }, bindings: [], colorTargets: [{ resource: 'rt' }], ...extra } as NodeDecl);
    it('baseVertex needs an index buffer', () => {
      expect(() => compileTechnique(technique([draw({ vertexCount: 3, baseVertex: 1 })], [rt]))).toThrow(/baseVertex needs an indexBuffer/);
      expect(() => compileTechnique(technique([draw({ indexBuffer: { resource: 'idx' }, baseVertex: { variable: 'b' } })], [rt, buf('idx')], [{ name: 'b', type: 'int', value: -2 }]))).not.toThrow();
    });
    it('indirect draws need no counts, forbid explicit ones, and track the indirect usage', () => {
      const t = compileTechnique(technique([draw({ indirect: { resource: 'args', offset: 8 } })], [rt, buf('args')]));
      expect(t.resources.get('args')!.uses.has('indirect')).toBe(true);
      expect(t.steps[0].accesses.find((a) => a.resource === 'args')).toMatchObject({ usage: 'indirect', read: true, write: false });
      for (const k of ['vertexCount', 'instanceCount']) expect(() => compileTechnique(technique([draw({ indirect: { resource: 'args' }, [k]: 3 })], [rt, buf('args')]))).toThrow(/is indirect/);
      expect(() => compileTechnique(technique([draw({ indirect: { resource: 'args', offset: 6 } })], [rt, buf('args')]))).toThrow(/multiple of 4/);
      expect(() => compileTechnique(technique([draw({ indirect: { resource: 'rt' } })], [rt]))).toThrow(/must be a buffer/);
    });
    it('keeps the compute node that writes the arguments, and round-trips through JSON', () => {
      const gen: NodeDecl = { type: 'compute', name: 'gen', shader: { code: 'x' }, workgroupSize: [1], bindings: [{ resource: 'args', access: 'write' }], dispatch: { threads: [1] } };
      const t = technique([gen, draw({ indirect: { resource: 'args' }, indexBuffer: { resource: 'idx' } })], [rt, buf('args', { visibility: 'internal' }), buf('idx')]);
      expect(names(compileTechnique(t))).toEqual(['gen', 'd']);
      const withBase = technique([draw({ indexBuffer: { resource: 'idx' }, baseVertex: -4 })], [rt, buf('idx')]);
      expect(parseTechnique(JSON.parse(techniqueToJSON(t)))).toEqual(t);
      expect(parseTechnique(JSON.parse(techniqueToJSON(withBase)))).toEqual(withBase);
    });
  });

  describe('host bind groups and mip views', () => {
    const buf = (name: string): ResourceDecl => ({ kind: 'buffer', name, count: 4, visibility: 'exported' });
    const host = (extra: Partial<ComputeNode>): NodeDecl => ({ ...pass('c', [], []), bindings: [{ resource: 'b', access: 'write' }], ...extra });
    it('validates host groups', () => {
      const ok = host({ group: 2, hostGroups: [{ group: 0, layout: 'frame' }, { group: 1, layout: 'scene' }] });
      expect(() => compileTechnique(technique([ok], [buf('b')]))).not.toThrow();
      expect(() => compileTechnique(technique([host({ group: 1, hostGroups: [{ group: 1, layout: 'x' }] })], [buf('b')]))).toThrow(/@group\(1\) is used twice/);
      expect(() => compileTechnique(technique([host({ hostGroups: [{ group: 1, layout: 'x' }, { group: 1, layout: 'y' }] })], [buf('b')]))).toThrow(/used twice/);
      expect(() => compileTechnique(technique([host({ hostGroups: [{ group: 4, layout: 'x' }] })], [buf('b')]))).toThrow(/from 0 to 3/);
      expect(() => compileTechnique(technique([host({ group: 7 })], [buf('b')]))).toThrow(/from 0 to 3/);
      expect(() => compileTechnique(technique([host({ hostGroups: [{ group: 1, layout: '' }] })], [buf('b')]))).toThrow(/needs a layout name/);
    });
    it('puts the generated bindings at the node group', () => {
      const t = technique([host({ group: 2, shader: { code: '/*$(Bindings)*/' }, hostGroups: [{ group: 0, layout: 'frame' }] })], [buf('b')]);
      const plan = compileTechnique(t);
      expect(expandShader(plan.steps[0].node as never, plan).code).toContain('@group(2) @binding(0) var<storage, read_write> b: array<u32>;');
    });
    it('round-trips host groups and mip views through JSON', () => {
      const t = technique([host({ group: 1, hostGroups: [{ group: 0, layout: 'frame' }], bindings: [{ resource: 'b', access: 'write' }] })], [buf('b')]);
      expect(parseTechnique(JSON.parse(techniqueToJSON(t)))).toEqual(t);
      const tex2 = technique([pass('p', [], ['t'], { bindings: [{ resource: 't', access: 'read', mip: 1, mipCount: 2 }] })], [tex('t', { mips: 4, visibility: 'exported' })]);
      expect(parseTechnique(JSON.parse(techniqueToJSON(tex2)))).toEqual(tex2);
    });

    const pyramid = (bindings: ComputeNode['bindings']) => technique([{ ...pass('down', [], []), bindings }], [tex('hiz', { mips: 4, visibility: 'exported' })]);
    it('lets one node read mip i-1 and write mip i of the same texture', () => {
      const plan = compileTechnique(pyramid([{ resource: 'hiz', access: 'read', name: 'src', mip: 0, mipCount: 1 }, { resource: 'hiz', access: 'write', name: 'dst', mip: 1 }]));
      expect(plan.steps[0].accesses.filter((a) => a.resource === 'hiz')).toHaveLength(2);
      expect(plan.resources.get('hiz')!.uses).toEqual(new Set(['sampled', 'storage', 'copy-src']));
    });
    it('rejects overlapping or malformed mip ranges', () => {
      expect(() => compileTechnique(pyramid([{ resource: 'hiz', access: 'read', name: 'src', mip: 0, mipCount: 2 }, { resource: 'hiz', access: 'write', name: 'dst', mip: 1 }]))).toThrow(/conflicting usage/);
      expect(() => compileTechnique(pyramid([{ resource: 'hiz', access: 'read', name: 'src' }, { resource: 'hiz', access: 'write', name: 'dst', mip: 1 }]))).toThrow(/conflicting usage/);
      expect(() => compileTechnique(pyramid([{ resource: 'hiz', access: 'write', mip: 4 }]))).toThrow(/out of range/);
      expect(() => compileTechnique(pyramid([{ resource: 'hiz', access: 'write', mip: 0, mipCount: 2 }]))).toThrow(/one mip level/);
      expect(() => compileTechnique(pyramid([{ resource: 'hiz', access: 'read', mip: -1 }]))).toThrow(/level >= 0/);
    });
    it('lets a draw render into mip i while sampling mip i-1', () => {
      const blit: NodeDecl = {
        type: 'draw', name: 'blit', shader: { code: 'x' }, vertexCount: 3, bindings: [{ resource: 'chain', access: 'read', name: 'src', mip: 0, mipCount: 1, sampler: 'linear' }],
        colorTargets: [{ resource: 'chain', mip: 1 }],
      };
      const plan = compileTechnique(technique([blit], [tex('chain', { mips: 3, visibility: 'exported' })]));
      expect(plan.resources.get('chain')!.uses.has('render')).toBe(true);
      const same: NodeDecl = { ...blit, colorTargets: [{ resource: 'chain', mip: 0 }] };
      expect(() => compileTechnique(technique([same], [tex('chain', { mips: 3, visibility: 'exported' })]))).toThrow(/conflicting usage/);
    });
  });

  describe('several generated bind groups, uniform buffers and dynamic offsets', () => {
    const buf = (name: string, extra: Record<string, unknown> = {}): ResourceDecl => ({ kind: 'buffer', name, element: 'vec4<f32>', count: 8, visibility: 'exported', ...extra } as ResourceDecl);
    /** A node that also writes `sink` (group 3), so it is live; `code` leaves the sink out of the way. */
    const node = (bindings: ComputeNode['bindings'], extra: Partial<ComputeNode> = {}): NodeDecl => ({
      ...pass('c', [], []), shader: { code: '/*$(Bindings)*/' }, bindings: [...bindings, { resource: 'sink', access: 'write', group: 3 }], ...extra,
    });
    const sink = buf('sink');
    const code = (t: ReturnType<typeof technique>) => {
      const plan = compileTechnique(t), out = expandShader(plan.steps[0].node as never, plan);
      return { ...out, slots: out.slots.filter((s) => s.name !== 'sink') };
    };

    it('numbers the bindings inside each group they are declared in', () => {
      const t = technique([node([
        { resource: 'a', access: 'read', group: 1 }, { resource: 'b', access: 'write' }, { resource: 'c', access: 'read', group: 1 }, { resource: 'd', access: 'readwrite', group: 2 },
      ])], [buf('a'), buf('b'), buf('c'), buf('d'), sink]);
      const out = code(t);
      expect(out.slots.map((s) => [s.name, s.group, s.binding])).toEqual([['a', 1, 0], ['b', 0, 0], ['c', 1, 1], ['d', 2, 0]]);
      expect(out.code).toContain('@group(1) @binding(1) var<storage, read> c: array<vec4<f32>>;');
      expect(out.code).toContain('@group(2) @binding(0) var<storage, read_write> d: array<vec4<f32>>;');
    });

    it('puts the variables uniform at binding 0 of the node group, and a sampler beside its texture', () => {
      const t = technique([node([{ resource: 'img', access: 'read', group: 2, sampler: 'linear' }], { group: 1, shader: { code: '/*$(Bindings)*/ let x = /*$(Variable:v)*/;' } })],
        [tex('img', { visibility: 'exported' }), sink], [{ name: 'v', type: 'float' }]);
      const out = code(t);
      expect(out.slots.map((s) => [s.name, s.group, s.binding])).toEqual([['gigi', 1, 0], ['img', 2, 0], ['img_sampler', 2, 1]]);
      expect(out.code).toContain('@group(1) @binding(0) var<uniform> gigi: GigiVariables;');
    });

    it('declares a uniform binding as a single element and tracks the uniform usage', () => {
      const t = technique([node([{ resource: 'view', access: 'read', uniform: true, group: 1 }])], [buf('view', { element: 'ViewData', stride: 256 }), sink]);
      expect(code(t).code).toContain('@group(1) @binding(0) var<uniform> view: ViewData;');
      expect(compileTechnique(t).resources.get('view')!.uses.has('uniform')).toBe(true);
    });

    it('keeps the host groups away from every group the bindings use', () => {
      const bindings: ComputeNode['bindings'] = [{ resource: 'a', access: 'read', group: 2 }, { resource: 'b', access: 'write' }];
      const res = [buf('a'), buf('b'), sink];
      expect(() => compileTechnique(technique([node(bindings, { hostGroups: [{ group: 1, layout: 'frame' }] })], res))).not.toThrow();
      expect(() => compileTechnique(technique([node(bindings, { hostGroups: [{ group: 2, layout: 'frame' }] })], res))).toThrow(/@group\(2\) is used twice \(the generated bindings use group 0, 2, 3\)/);
      expect(() => compileTechnique(technique([node([{ resource: 'a', access: 'read', group: 4 }])], res))).toThrow(/group 4 must be from 0 to 3/);
    });

    it('validates uniform, dynamicOffset and size', () => {
      const one = (b: ComputeNode['bindings'][number], r: ResourceDecl = buf('a')) => () => compileTechnique(technique([node([b])], [r, sink]));
      expect(one({ resource: 'a', access: 'write', uniform: true })).toThrow(/only buffers bound for reading can be uniform/);
      expect(one({ resource: 't', access: 'read', uniform: true }, tex('t', { visibility: 'exported' }))).toThrow(/only buffers bound for reading can be uniform/);
      expect(one({ resource: 't', access: 'read', dynamicOffset: true }, tex('t', { visibility: 'exported' }))).toThrow(/only buffers can have a dynamicOffset/);
      expect(one({ resource: 'a', access: 'read', size: 6 })).toThrow(/multiple of 4 bytes/);
      expect(one({ resource: 'a', access: 'read', dynamicOffset: true })).not.toThrow();                                         // vec4<f32>: 16 bytes
      expect(one({ resource: 'a', access: 'read', dynamicOffset: true }, buf('a', { element: 'Params', stride: 256 }))).not.toThrow();      // the window is one element
      expect(one({ resource: 'a', access: 'read', dynamicOffset: true, size: 64 }, buf('a', { element: 'Params', stride: 256 }))).not.toThrow();
    });

    it('does not let a uniform and a storage binding of one buffer share a node', () => {
      expect(() => compileTechnique(technique([node([{ resource: 'a', access: 'read', uniform: true }, { resource: 'a', access: 'read', name: 'a2' }])], [buf('a'), sink]))).toThrow(/conflicting usage/);
    });

    it('round-trips groups and dynamic offsets through JSON', () => {
      const t = technique([node([{ resource: 'a', access: 'read', uniform: true, group: 1, dynamicOffset: true, size: 64 }])], [buf('a', { element: 'ViewData', stride: 64 }), sink]);
      expect(parseTechnique(JSON.parse(techniqueToJSON(t)))).toEqual(t);
    });
  });

  describe('render nodes', () => {
    const rnode = (extra: Record<string, unknown> = {}): NodeDecl => ({ type: 'render', name: 'r', record: () => {}, colorTargets: [{ resource: 'rt' }], ...extra }) as NodeDecl;
    const rt = tex('rt', { visibility: 'exported' });

    it('validates attachments like a draw node', () => {
      expect(() => compileTechnique(technique([rnode()], [rt]))).not.toThrow();
      expect(() => compileTechnique(technique([rnode({ colorTargets: [] })], []))).toThrow(/at least one color or depth target/);
      expect(() => compileTechnique(technique([rnode({ colorTargets: [{ resource: 'rt' }, { resource: 'big' }] })], [rt, tex('big', { size: [8, 8], visibility: 'exported' })]))).toThrow(/differ in size/);
      expect(() => compileTechnique(technique([rnode({ colorTargets: [{ resource: 'rt' }], depthTarget: { resource: 'd' } })], [rt, tex('d', { format: 'depth24plus', samples: 4 })]))).toThrow(/differ in sample count/);
    });

    it('a read-only depth target reads and does not write; a layer and the MSAA resolve are accepted', () => {
      const depth = tex('d', { format: 'depth24plus', visibility: 'imported' });
      const plan = compileTechnique(technique([rnode({ depthTarget: { resource: 'd', readOnly: true } })], [rt, depth]));
      expect(plan.steps[0].accesses.find((a) => a.resource === 'd')).toMatchObject({ read: true, write: false, usage: 'depth' });
      const map = tex('map', { format: 'depth32float', dimension: '2d-array', size: [64, 64, 4], visibility: 'imported' });
      expect(() => compileTechnique(technique([rnode({ colorTargets: [], depthTarget: { resource: 'map', layer: 3 } })], [map]))).not.toThrow();
      const msaa = tex('msaa', { samples: 4 });
      expect(() => compileTechnique(technique([rnode({ colorTargets: [{ resource: 'msaa', resolve: 'rt', storeOp: 'discard' }] })], [msaa, rt]))).not.toThrow();
    });

    it('declares what the draws read through `uses`, which orders the pass after the compute that writes it', () => {
      const verts: ResourceDecl = { kind: 'buffer', name: 'verts', element: 'f32', stride: 16, count: 4 };
      const gen: NodeDecl = { type: 'compute', name: 'gen', shader: { code: 'x' }, workgroupSize: [1], dispatch: { threads: [1] }, bindings: [{ resource: 'verts', access: 'write' }] };
      const t = technique([rnode({ uses: [{ resource: 'verts', usage: 'vertex' }] }), gen], [rt, verts]);
      const plan = compileTechnique(t);
      expect(names(plan)).toEqual(['gen', 'r']);
      expect(plan.resources.get('verts')!.uses.has('vertex')).toBe(true);
      expect(() => compileTechnique(technique([rnode({ uses: [{ resource: 'rt', usage: 'vertex' }] })], [rt]))).toThrow(/can only be used as sampled or storage/);
    });

    it('cannot be stored as JSON', () => {
      expect(() => techniqueToJSON(technique([rnode()], [rt]))).toThrow(/is a render node and cannot be serialized/);
    });
  });

  describe('draw: MSAA targets', () => {
    const color = tex('color', { samples: 4 }), resolved = tex('resolved', { visibility: 'exported' });
    const draw = (target: Record<string, unknown>, depth?: string): NodeDecl => ({ type: 'draw', name: 'd', shader: { code: 'x' }, bindings: [], vertexCount: 3, colorTargets: [{ resource: 'color', ...target }], ...(depth ? { depthTarget: { resource: depth } } : {}) } as NodeDecl);
    it('resolves a multisampled target and accounts for the sample memory', () => {
      const t = compileTechnique(technique([draw({ resolve: 'resolved' })], [color, resolved]));
      expect(t.resources.get('color')!.resolved).toMatchObject({ samples: 4 });
      expect(t.resources.get('color')!.bytes).toBe(4 * t.resources.get('resolved')!.bytes);
      expect(t.steps[0].accesses.find((a) => a.resource === 'resolved')).toMatchObject({ write: true, read: false });
    });
    it('does not let `like` borrow the sample count', () => {
      const t = compileTechnique(technique([draw({ resolve: 'resolved' })], [resolved, { kind: 'texture', name: 'color', like: 'resolved', samples: 4 }]));
      expect(t.resources.get('resolved')!.resolved).toMatchObject({ samples: 1 });
      expect(t.resources.get('color')!.resolved).toMatchObject({ samples: 4, size: [64, 64, 1] });
    });
    it('rejects invalid sample counts and shapes', () => {
      expect(() => compileTechnique(technique([], [tex('x', { samples: 2 as 4 })]))).toThrow(/1 or 4/);
      expect(() => compileTechnique(technique([], [tex('x', { samples: 4, dimension: '2d-array', size: [8, 8, 2] })]))).toThrow(/plain 2d/);
      expect(() => compileTechnique(technique([], [tex('x', { samples: 4, mips: 3 })]))).toThrow(/one mip/);
    });
    it('checks the resolve target', () => {
      expect(() => compileTechnique(technique([draw({ resolve: 'resolved' })], [tex('color'), resolved]))).toThrow(/not multisampled/);
      expect(() => compileTechnique(technique([draw({ resolve: 'resolved' })], [color, tex('resolved', { samples: 4, visibility: 'exported' })]))).toThrow(/single-sample/);
      expect(() => compileTechnique(technique([draw({ resolve: 'resolved' })], [color, tex('resolved', { size: [32, 32], visibility: 'exported' })]))).toThrow(/must match/);
      expect(() => compileTechnique(technique([draw({ resolve: 'resolved' })], [color, tex('resolved', { format: 'bgra8unorm', visibility: 'exported' })]))).toThrow(/must match/);
      expect(() => compileTechnique(technique([draw({ resolve: 'color' })], [color]))).toThrow(/into itself/);
      expect(() => compileTechnique(technique([draw({ storeOp: 'discard' })], [{ ...color, visibility: 'exported' }]))).toThrow(/result would be lost/);
    });
    it('requires every attachment to agree on the sample count', () => {
      const depth = tex('depth', { format: 'depth24plus' });
      expect(() => compileTechnique(technique([draw({ resolve: 'resolved' }, 'depth')], [color, resolved, depth]))).toThrow(/differ in sample count/);
      expect(() => compileTechnique(technique([draw({ resolve: 'resolved' }, 'depth')], [color, resolved, { ...depth, samples: 4 } as ResourceDecl]))).not.toThrow();
    });
    it('rejects storage and filtered use of a multisampled texture, allows plain reads', () => {
      const out = tex('out', { visibility: 'exported' });
      expect(() => compileTechnique(technique([draw({ resolve: 'resolved' }), pass('p', [], ['color'])], [color, resolved]))).toThrow(/multisampled and cannot be a storage/);
      const read = (sampler?: 'nearest') => technique([draw({ resolve: 'resolved' }), pass('p', ['color'], ['out'], sampler ? { bindings: [{ resource: 'color', access: 'read', sampler }, { resource: 'out', access: 'write' }] } : {})], [color, resolved, out]);
      expect(() => compileTechnique(read())).not.toThrow();
      expect(() => compileTechnique(read('nearest'))).toThrow(/cannot be filtered/);
    });
    it('declares multisampled WGSL types for reads', () => {
      const out = tex('out', { visibility: 'exported' });
      const plan = compileTechnique(technique([draw({ resolve: 'resolved' }), pass('p', ['color'], ['out'])], [color, resolved, out]));
      expect(expandShader(plan.steps[1].node as never, plan).code).toContain('var color: texture_multisampled_2d<f32>;');
    });
    it('keeps multisampled textures out of single-sample aliasing slots', () => {
      const t = compileTechnique(technique([draw({ resolve: 'resolved' })], [color, resolved]));
      expect(t.slots.find((s) => s.resources.includes('color'))!.signature).toContain('x4');
    });
    it('round-trips through JSON', () => {
      const t = technique([draw({ resolve: 'resolved', storeOp: 'discard' })], [color, resolved]);
      expect(parseTechnique(JSON.parse(techniqueToJSON(t)))).toEqual(t);
      const j = JSON.parse(techniqueToJSON(t));
      j.resources[0].samples = 8;
      expect(() => parseTechnique(j)).toThrow(/samples: expected 1 or 4/);
    });
  });

  it('needs a format and size for non-imported textures and rejects like-cycles', () => {
    expect(run([], [{ kind: 'texture', name: 'x', size: [4, 4] }])).toThrow(/needs a format/);
    expect(run([], [{ kind: 'texture', name: 'x', format: 'rgba8unorm' }])).toThrow(/needs a size/);
    expect(run([], [tex('a', { like: 'b' }), tex('b', { like: 'a' })])).toThrow(/cycle/);
    expect(() => compileTechnique(technique([], [tex('i', { visibility: 'imported', size: undefined }), tex('j', { like: 'i', size: undefined })]))).toThrow(/known size/);
  });
});

describe('ordering strategies', () => {
  // two independent chains: compute-A (a1 -> a2 on texA) and copy-B; interleaved declaration order forces transitions
  const tech = technique(
    [pass('a1', [], ['ta']), { type: 'copy', name: 'b1', source: 'src', dest: 'tb' }, pass('a2', ['ta'], ['oa']), { type: 'copy', name: 'b2', source: 'tb', dest: 'ob' }],
    [tex('ta'), tex('tb'), tex('src', { visibility: 'imported' }), tex('oa', { visibility: 'exported' }), tex('ob', { visibility: 'exported' })],
  );
  it('keeps declaration order by default and can reorder to reduce kind switches without breaking dependencies', () => {
    const declared = compileTechnique(tech), tuned = compileTechnique(tech, { order: 'transitions' });
    expect(names(declared)).toEqual(['a1', 'b1', 'a2', 'b2']);
    const order = names(tuned);
    expect(order.indexOf('a1')).toBeLessThan(order.indexOf('a2'));
    expect(order.indexOf('b1')).toBeLessThan(order.indexOf('b2'));
    expect(tuned.stats.kindSwitches).toBeLessThan(declared.stats.kindSwitches);
    expect(tuned.stats.transitions).toBeLessThanOrEqual(declared.stats.transitions);
  });
});

describe('shader tokens', () => {
  const tech = technique(
    [{ type: 'compute', name: 'k', workgroupSize: [8, 8], shader: { code: 'struct P { a: u32 }\n/*$(Bindings)*/\n@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3<u32>) { let r = /*$(Variable:radius)*/; let t = /*$(Variable:tint)*/; let s = /*$(Size:img)*/; }' },
      bindings: [{ resource: 'img', access: 'read', sampler: 'linear' }, { resource: 'out', access: 'write', name: 'result' }, { resource: 'list', access: 'readwrite' }], dispatch: { like: 'out' } }],
    [tex('img', { visibility: 'imported', size: [32, 16] }), tex('out', { visibility: 'exported' }), { kind: 'buffer', name: 'list', element: 'u32', count: 8, visibility: 'exported' }],
    [{ name: 'radius', type: 'float', value: 2 }, { name: 'tint', type: 'float4', value: [1, 0.5, 0.25, 1] }],
  );
  const expanded = () => { const c = compileTechnique(tech); return expandShader(c.steps[0].node as never, c); };
  it('generates the variables uniform with WGSL alignment and replaces Variable and Size tokens', () => {
    const e = expanded();
    expect(e.uniform!.members.map((m) => [m.name, m.offset])).toEqual([['radius', 0], ['tint', 16]]);
    expect(e.uniform!.size).toBe(32);
    expect(e.code).toContain('struct GigiVariables {\n  radius: f32,\n  tint: vec4<f32>,\n}');
    expect(e.code).toContain('let r = gigi.radius; let t = gigi.tint; let s = vec3<u32>(32u, 16u, 1u);');
  });
  it('declares every binding in order, with samplers, storage textures and buffers', () => {
    const e = expanded();
    expect(e.slots.map((s) => [s.binding, s.kind, s.name])).toEqual([[0, 'variables', 'gigi'], [1, 'resource', 'img'], [2, 'sampler', 'img_sampler'], [3, 'resource', 'result'], [4, 'resource', 'list']]);
    expect(e.code).toContain('@group(0) @binding(1) var img: texture_2d<f32>;');
    expect(e.code).toContain('@group(0) @binding(2) var img_sampler: sampler;');
    expect(e.code).toContain('@group(0) @binding(3) var result: texture_storage_2d<rgba8unorm, write>;');
    expect(e.code).toContain('@group(0) @binding(4) var<storage, read_write> list: array<u32>;');
  });
  it('prepends the declarations when there is no Bindings token, and rejects unknown tokens and names', () => {
    const noToken = { ...tech, nodes: [{ ...(tech.nodes[0] as ComputeNode), shader: { code: 'fn x() {}' } }] };
    const c = compileTechnique(noToken);
    expect(expandShader(c.steps[0].node as never, c).code).toMatch(/^@group\(0\) @binding\(0\) var img/);
    for (const [code, error] of [['/*$(Frob:x)*/', /unknown shader token/], ['/*$(Variable:ghost)*/', /unknown variable/], ['/*$(Size:ghost)*/', /unknown resource/]] as const) {
      const bad = compileTechnique({ ...tech, nodes: [{ ...(tech.nodes[0] as ComputeNode), shader: { code } }] });
      expect(() => expandShader(bad.steps[0].node as never, bad)).toThrow(error);
    }
  });
  it('resolves variable names through sub-graph renames', () => {
    const sub = technique([{ type: 'compute', name: 'k', workgroupSize: [1], shader: { code: 'let x = /*$(Variable:radius)*/;' }, bindings: [{ resource: 'o', access: 'write' }], dispatch: { threads: [1] } }], [tex('o', { visibility: 'exported' })], [{ name: 'radius', type: 'float', value: 7 }], 'sub');
    const c = compileTechnique(technique([{ type: 'subgraph', name: 's', technique: sub, loop: 2, outputs: { o: 'final' } }], [tex('final', { visibility: 'exported' })]));
    const e = expandShader(c.steps[1].node as never, c);
    expect(e.uniform!.members[0]).toMatchObject({ name: 'radius', flat: 's#1/radius' });
    expect(e.code).toContain('gigi.radius');
  });
});

describe('technique files', () => {
  const sample = technique([pass('a', ['i'], ['o'])], [tex('i', { visibility: 'imported' }), tex('o', { visibility: 'exported' })], [{ name: 'k', type: 'float', value: 1 }]);
  it('round-trips through JSON', () => {
    expect(parseTechnique(JSON.parse(techniqueToJSON(sample)))).toEqual(sample);
  });
  it('names the path of the first problem', () => {
    const bad = (f: (t: Record<string, any>) => void) => { const t = JSON.parse(techniqueToJSON(sample)); f(t); return () => parseTechnique(t); };
    expect(bad((t) => { t.nodes[0].bindings[0].access = 'rw'; })).toThrow(/nodes\[0\]\.bindings\[0\]\.access: expected one of "read", "write", "readwrite"/);
    expect(bad((t) => { t.resources[0].frmat = 'x'; })).toThrow(/resources\[0\]\.frmat: unknown field/);
    expect(bad((t) => { delete t.nodes[0].dispatch; })).toThrow(/nodes\[0\]\.dispatch: required field is missing/);
    expect(bad((t) => { t.nodes[0].type = 'callback'; })).toThrow(/callback nodes hold code/);
    expect(bad((t) => { t.variables[0].type = 'double'; })).toThrow(/variables\[0\]\.type/);
    expect(bad((t) => { t.extra = 1; })).toThrow(/technique\.extra: unknown field/);
    expect(bad((t) => { t.nodes[0].dispatch = { threads: ['x'] }; })).toThrow(/dispatch/);
  });
  it('validates inline sub-techniques and refuses to store callbacks', () => {
    const outer = technique([{ type: 'subgraph', name: 's', technique: sample, inputs: { i: 'x' }, loop: { variable: 'k' } }], [tex('x')]);
    expect(parseTechnique(JSON.parse(techniqueToJSON(outer)))).toEqual(outer);
    expect(() => techniqueToJSON(technique([{ type: 'callback', name: 'cb', execute: () => {} }], []))).toThrow(/callback node/);
  });
});

describe('conditional nodes and GPU usage', () => {
  // `out` is written by a compute node while mode is 0 and by a copy while mode is 1
  const tech = technique([
    pass('compute-out', [], ['out'], { condition: { variable: 'mode', op: 'eq', value: 0 } }),
    { type: 'copy', name: 'copy-out', source: 'src', dest: 'out', condition: { variable: 'mode', op: 'eq', value: 1 } },
  ], [tex('src', { visibility: 'imported' }), tex('out', { visibility: 'exported' })], [{ name: 'mode', type: 'int', value: 0 }]);
  it('allocates for every way a switched-off node could use a resource, so toggling never reallocates', () => {
    const uses = (mode: number) => [...compileTechnique(tech, { values: { mode } }).resources.get('out')!.uses].sort();
    expect(uses(0)).toEqual(uses(1));
    expect(uses(0)).toEqual(['copy-dst', 'copy-src', 'sampled', 'storage']);
    expect(names(compileTechnique(tech, { values: { mode: 1 } }))).toEqual(['copy-out']);
  });
  it('does not allocate resources that only switched-off nodes use', () => {
    const t = technique([pass('a', [], ['o'], { condition: { variable: 'on', op: 'eq', value: 1 } }), pass('b', [], ['p'])], [tex('o', { visibility: 'exported' }), tex('p', { visibility: 'exported' })], [{ name: 'on', type: 'int', value: 0 }]);
    const c = compileTechnique(t);
    expect(c.resources.get('o')!.slot).toBe(-1);
    expect(c.unused).toContain('o');
  });
});

describe('example technique files', () => {
  const load = (name: string) => parseTechnique(JSON.parse(readFileSync(new URL(`./fixtures/${name}.technique.json`, import.meta.url), 'utf8')));
  const registry = () => ({ 'blur-pass': load('blur-pass') });
  it('parse and compile: a blur sub-technique used twice, the second time with its own radius', () => {
    const t = compileTechnique(load('blur'), { registry: registry() });
    expect(names(t)).toEqual(['first/horizontal', 'first/vertical', 'second/horizontal', 'second/vertical']);
    expect(t.variables.has('second/radius')).toBe(true);    // overridden with a value instead of bound to the parent's
    expect(t.variables.has('first/radius')).toBe(false);
    // the two 'mid' textures are never alive together: they share memory, so source + temp + blurred + one mid
    expect(t.resources.get('first/mid')!.slot).toBe(t.resources.get('second/mid')!.slot);
    expect(t.stats.slots).toBe(3);
    expect(compileTechnique(load('blur'), { registry: registry(), values: { width: 512, height: 128 } }).resources.get('blurred')!.resolved).toMatchObject({ size: [512, 128, 1] });
  });
});

describe('visualisation and RenderGraph integration', () => {
  it('exports DOT with execution order, resource kinds and shared-memory clusters', () => {
    const t = compileTechnique(technique([pass('n1', [], ['a']), pass('n2', ['a'], ['b']), pass('n3', ['b'], ['c']), pass('n4', ['c'], ['out'])], [tex('a'), tex('b'), tex('c'), tex('out', { visibility: 'exported' })]));
    const dot = techniqueToDot(t);
    expect(dot).toContain('"0. n1\\n(compute)"');
    expect(dot).toContain('shared memory (slot');
    expect(dot).toContain('"r:a" -> "n:n2"');
  });
  it('RenderGraph reports resource spans and transition statistics', () => {
    const g = new RenderGraph();
    const noop = () => {};
    g.addPass({ name: 'depth', writes: ['depth'], execute: noop });
    g.addPass({ name: 'main', reads: ['depth'], writes: ['color'], sideEffect: true, execute: noop });
    g.compile();
    expect(g.spans.get('depth')).toEqual({ first: 0, last: 1 });
    expect(g.stats.transitions).toBe(0);
  });
  it('RenderGraph can reorder independent passes to reduce switches', () => {
    const g = new RenderGraph();
    const noop = () => {};
    g.addPass({ name: 'a', writes: ['x'], sideEffect: true, execute: noop });
    g.addPass({ name: 'b', reads: ['x'], writes: ['y'], sideEffect: true, execute: noop });
    g.strategy = 'transitions';
    expect(g.compile()).toEqual(['a', 'b']);
  });
  it('TechniqueError is a normal Error subclass', () => { expect(new TechniqueError('x')).toBeInstanceOf(Error); });
});
