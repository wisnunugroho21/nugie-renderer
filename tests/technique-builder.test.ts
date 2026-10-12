import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { technique, wgsl, sizeOf, bindings, TechniqueBuilder } from '../src/rendering/graph/TechniqueBuilder';
import { compileTechnique } from '../src/rendering/graph/Compile';
import { parseTechnique, techniqueToJSON } from '../src/rendering/graph/TechniqueJSON';
import type { ComputeNode, Technique } from '../src/rendering/graph/TechniqueTypes';

const fixture = (name: string) => parseTechnique(JSON.parse(readFileSync(new URL(`./fixtures/${name}.technique.json`, import.meta.url), 'utf8')));
const codeOf = (t: Technique, node: string) => (t.nodes.find((n) => n.name === node) as ComputeNode).shader.code;

describe('TechniqueBuilder', () => {
  /** The blur sub-technique and its parent, written with the builder: they must equal the JSON files exactly. */
  function blurPass() {
    const file = fixture('blur-pass');
    const g = technique('blur-pass');
    const radius = g.int('radius', 4);
    const image = g.texture('image', { format: 'rgba8unorm', visibility: 'imported' });
    const mid = g.texture('mid', { format: 'rgba8unorm', like: image });
    const result = g.texture('result', { format: 'rgba8unorm', like: image, visibility: 'exported' });
    g.compute('horizontal', { workgroupSize: [8, 8], reads: [image], writes: [mid], dispatch: { like: mid }, shader: codeOf(file, 'horizontal') });
    g.compute('vertical', { workgroupSize: [8, 8], reads: [mid], writes: [result], dispatch: { like: result }, shader: codeOf(file, 'vertical') });
    return { g, file, radius };
  }

  it('builds exactly what the JSON files describe', () => {
    const { g, file } = blurPass();
    expect(g.build()).toEqual(file);

    const parentFile = fixture('blur');
    const p = technique('separable-blur-twice');
    const width = p.uint('width', 256, 'host'), height = p.uint('height', 256, 'host'), radius = p.int('radius', 4);
    const source = p.texture('source', { format: 'rgba8unorm', visibility: 'imported', size: [width, height] });
    const temp = p.texture('temp', { format: 'rgba8unorm', like: source });
    const blurred = p.texture('blurred', { format: 'rgba8unorm', like: source, visibility: 'exported' });
    p.subgraph('first', 'blur-pass', { inputs: { image: source }, outputs: { result: temp }, variables: { radius } });
    p.subgraph('second', 'blur-pass', { inputs: { image: temp }, outputs: { result: blurred }, variables: { radius: 2 } });
    expect(p.build()).toEqual(parentFile);
    // handing the builder itself inlines its technique; the result compiles to the same steps
    const inline = technique('inline');
    const src = inline.texture('source', { format: 'rgba8unorm', size: [8, 8], visibility: 'imported' }), dst = inline.texture('blurred', { format: 'rgba8unorm', like: src, visibility: 'exported' });
    inline.subgraph('only', g, { inputs: { image: src }, outputs: { result: dst } });
    expect((inline.build().nodes[0] as { technique: Technique }).technique).toEqual(file);
    expect(compileTechnique(p.build(), { registry: { 'blur-pass': file } }).steps.map((s) => s.node.path)).toEqual(['first/horizontal', 'first/vertical', 'second/horizontal', 'second/vertical']);
  });

  it('handles print as shader tokens and names, and the wgsl tag rejects missing values', () => {
    const g = technique('t');
    const level = g.float('level', 0.5), src = g.texture('src', { format: 'rgba8unorm', size: [4, 4] });
    expect(wgsl`${bindings} let a = ${level}; let b = textureLoad(${src}); let s = ${sizeOf(src)};`).toBe('/*$(Bindings)*/ let a = /*$(Variable:level)*/; let b = textureLoad(src); let s = /*$(Size:src)*/;');
    expect(`${level}`).toBe('/*$(Variable:level)*/');
    expect(() => wgsl`x ${undefined} y`).toThrow(/placeholder 1 is undefined/);
  });

  it('turns variable handles into size entries, conditions, bindings and loops', () => {
    const g = technique('t');
    const n = g.uint('n', 3), q = g.int('quality', 1);
    const a = g.texture('a', { format: 'rgba8unorm', size: [n, n.times(0.5), n.plus(1), n.scaled(2, 3)] });
    const b = g.texture('b', { format: 'rgba8unorm', like: a, scale: 0.5, visibility: 'exported', lifetime: 'persistent' });
    g.compute('c', { shader: '', workgroupSize: [1], writes: [b], reads: [{ resource: a, name: 'input', sampler: 'linear' }], dispatch: { threads: [n, 4] }, when: q.ge(1), keep: true });
    g.subgraph('s', 'sub', { loop: n, inputs: { x: a } });
    const t = g.build();
    expect(t.resources![0]).toMatchObject({ size: [{ variable: 'n' }, { variable: 'n', scale: 0.5 }, { variable: 'n', offset: 1 }, { variable: 'n', scale: 2, offset: 3 }] });
    expect(t.resources![1]).toMatchObject({ like: 'a', scale: 0.5, lifetime: 'persistent', visibility: 'exported' });
    expect(t.nodes[0]).toMatchObject({
      bindings: [{ resource: 'a', access: 'read', name: 'input', sampler: 'linear' }, { resource: 'b', access: 'write' }],
      dispatch: { threads: [{ variable: 'n' }, 4] }, condition: { variable: 'quality', op: 'ge', value: 1 }, sideEffect: true,
    });
    expect(t.nodes[1]).toMatchObject({ loop: { variable: 'n' }, inputs: { x: 'a' } });
  });

  it('rejects mistakes at the call that made them, naming the technique and node', () => {
    const g = technique('mine'), other = technique('other');
    const mine = g.texture('mine', { format: 'rgba8unorm', size: [1, 1] }), theirs = other.texture('theirs', { format: 'rgba8unorm', size: [1, 1] });
    const foreignVar = other.uint('v', 1);
    expect(() => g.texture('mine')).toThrow(/resource 'mine' is already declared/);
    expect(() => { g.uint('u'); g.int('u'); }).toThrow(/variable 'u' is already declared/);
    expect(() => g.copy('c', mine, theirs)).toThrow(/technique 'mine', node 'c': resource 'theirs' belongs to another technique builder/);
    expect(() => g.copy('c2', mine, 'ghost')).toThrow(/resource 'ghost' is not declared/);
    expect(() => g.texture('x', { size: [foreignVar] })).toThrow(/variable 'v' belongs to another technique builder/);
    expect(() => g.texture('y', { like: 'ghost' })).toThrow(/'ghost' is not declared/);
    expect(() => g.compute('k', { shader: '', dispatch: { threads: [1] }, when: { variable: 'nope', op: 'eq', value: 1 } })).toThrow(/variable 'nope' is not declared/);
    g.copy('dup', mine, mine);
    expect(() => g.copy('dup', mine, mine)).toThrow(/node 'dup' is already declared/);
    expect(() => new TechniqueBuilder('')).toThrow(/needs a name/);
    expect(() => g.variableNamed('zzz')).toThrow(/no variable/);
    expect(() => g.resourceNamed('zzz')).toThrow(/no resource/);
  });

  it('a failed call leaves the builder usable', () => {
    const g = technique('t');
    const a = g.texture('a', { format: 'rgba8unorm', size: [1, 1] });
    expect(() => g.copy('bad', a, 'ghost')).toThrow();
    g.texture('b', { format: 'rgba8unorm', size: [1, 1], visibility: 'exported' });
    g.copy('bad', a, 'b');                               // the name was not consumed by the failed call
    expect(g.build().nodes).toHaveLength(1);
  });

  it('draw nodes take vertex buffers and MSAA targets with handles', () => {
    const g = technique('msaa');
    const verts = g.buffer('verts', { element: 'vec4<f32>', count: 6, visibility: 'imported' });
    const msaa = g.texture('msaa', { format: 'rgba8unorm', size: [32, 32], samples: 4 });
    const out = g.texture('out', { like: msaa, visibility: 'exported' });
    g.draw('tri', { shader: '', vertexBuffers: [{ resource: verts, attributes: [{ location: 0, format: 'float32x4', offset: 0 }] }], colorTargets: [{ resource: msaa, resolve: out, storeOp: 'discard' }] });
    const t = g.build();
    expect(t.resources![1]).toMatchObject({ samples: 4 });
    expect(t.nodes[0]).toMatchObject({ vertexBuffers: [{ resource: 'verts' }], colorTargets: [{ resource: 'msaa', resolve: 'out', storeOp: 'discard' }] });
    expect('vertexCount' in t.nodes[0]).toBe(false);
    expect(() => g.compile()).not.toThrow();
    const h = technique('x');
    h.texture('a', { format: 'rgba8unorm', size: [4, 4] });
    expect(() => h.draw('d', { shader: '', colorTargets: ['a'], vertexBuffers: [{ resource: 'ghost', attributes: [] }] })).toThrow(/ghost/);
  });

  it('draw and callback nodes keep their options', () => {
    const g = technique('t');
    const rt = g.texture('rt', { format: 'rgba8unorm', size: [8, 8], visibility: 'exported' }), depth = g.texture('depth', { format: 'depth32float', size: [8, 8] });
    const count = g.uint('count', 3);
    g.draw('d', { shader: '', colorTargets: [rt, { resource: 'rt', loadOp: 'load', blend: 'alpha' }], depthTarget: { resource: depth, compare: 'less', write: false }, vertices: count, instances: 2, topology: 'line-list', cullMode: 'back', vertexEntry: 'v', fragmentEntry: 'f' });
    g.callback('cb', { reads: [rt], writes: ['rt'], execute: () => {} });
    const [d, cb] = g.build().nodes;
    expect(d).toMatchObject({ type: 'draw', colorTargets: [{ resource: 'rt' }, { resource: 'rt', loadOp: 'load', blend: 'alpha' }], depthTarget: { resource: 'depth', write: false }, vertexCount: { variable: 'count' }, instanceCount: 2, topology: 'line-list', cullMode: 'back', vertexEntry: 'v', fragmentEntry: 'f' });
    expect(cb).toMatchObject({ type: 'callback', reads: ['rt'], writes: ['rt'] });
  });

  it('build() returns a copy; compile() validates now; toJSON round-trips; registerIn shares it by name', () => {
    const { g, file } = blurPass();
    const built = g.build();
    (built.resources![0] as { name: string }).name = 'changed';
    expect(g.build()).toEqual(file);
    const broken = technique('broken');
    const t = broken.texture('t', { format: 'rgba8unorm', size: [0, 4] });
    broken.compute('k', { shader: '', workgroupSize: [1], writes: [t], dispatch: { threads: [1] } });
    expect(() => broken.compile()).toThrow(/at least 1/);
    expect(parseTechnique(JSON.parse(g.toJSON()))).toEqual(file);
    const registry: Record<string, Technique> = {};
    g.registerIn(registry);
    expect(registry['blur-pass']).toEqual(file);
    const cbTechnique = technique('cb'); cbTechnique.callback('x', { execute: () => {} });
    expect(() => cbTechnique.toJSON()).toThrow(/callback node/);
    expect(parseTechnique(JSON.parse(techniqueToJSON(file)))).toEqual(parseTechnique(JSON.parse(g.toJSON())));   // key order may differ, content may not
  });
});
