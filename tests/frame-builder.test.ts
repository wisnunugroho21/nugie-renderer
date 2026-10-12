import { describe, it, expect } from 'vitest';
import { FrameBuilder, FrameGraph } from '../src/rendering/graph/FrameGraph';
import { technique } from '../src/rendering/graph/TechniqueBuilder';
import { frameHost, orderOf } from './helpers/frameGraph';
import { installGPUGlobals } from './helpers/fakeGPU';

installGPUGlobals();
(globalThis as Record<string, unknown>).GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };

const encoder = { clearBuffer() {} } as unknown as GPUCommandEncoder;

/** A texture-like object with everything a frame import is declared from. */
const fakeTexture = (o: { w?: number; h?: number; layers?: number; format?: string; samples?: number; mips?: number; dimension?: string } = {}) => ({
  width: o.w ?? 64, height: o.h ?? 32, depthOrArrayLayers: o.layers ?? 1, format: o.format ?? 'rgba8unorm', sampleCount: o.samples ?? 1, mipLevelCount: o.mips ?? 1, dimension: o.dimension ?? '2d',
  usage: 0xff, createView: () => ({}),
}) as unknown as GPUTexture;
const fakeBuffer = (size = 256) => ({ size, usage: 0xffff }) as unknown as GPUBuffer;

describe('FrameBuilder imports', () => {
  it('declares an imported texture from the object itself, once', () => {
    const g = new FrameBuilder('f'), a = fakeTexture({ w: 128, h: 64, layers: 6, format: 'rgba16float', mips: 3 });
    const handle = g.importTexture('cube', a);
    expect(g.importTexture('cube', a)).toBe(handle);
    expect(g.imports.get('cube')).toBe(a);
    expect(() => g.importTexture('cube', fakeTexture())).toThrow(/different textures/);
    const decl = g.build().resources!.find((r) => r.name === 'cube')!;
    expect(decl).toMatchObject({ kind: 'texture', format: 'rgba16float', size: [128, 64, 6], dimension: '2d-array', mips: 3, visibility: 'imported' });
  });
  it('declares a multisampled texture with its sample count', () => {
    const g = new FrameBuilder('f');
    g.importTexture('msaa', fakeTexture({ samples: 4 }));
    expect(g.build().resources![0]).toMatchObject({ samples: 4 });
  });
  it('declares an imported buffer once', () => {
    const g = new FrameBuilder('f'), b = fakeBuffer();
    g.importBuffer('lights', b, 'u32');
    g.importBuffer('lights', b, 'u32');
    expect(() => g.importBuffer('lights', fakeBuffer(), 'u32')).toThrow(/different buffers/);
  });
});

describe('FrameBuilder.include', () => {
  /** A stand-in for an engine pass: one imported buffer and texture, one variable, a node that writes the buffer (a callback could not be included: see the last test). */
  const stand = () => {
    const t = technique('stand');
    t.uint('count', 1);
    const buf = t.importedBuffer('data', 'u32'), tex = t.texture('target', { format: 'rgba8unorm', size: [64, 32], visibility: 'imported' });
    void tex;
    t.clear('work', buf);
    return t.build();
  };

  it('declares the imports and variables, supplies their values and publishes what scene passes wait for', () => {
    const g = new FrameBuilder('f'), data = fakeBuffer(), target = fakeTexture();
    g.include('stand', stand(), { imports: { data, target: { as: 'sceneColor', resource: target } }, variables: { count: 7 }, publish: ['sceneColor'] });
    expect(g.imports.get('stand/data')).toBe(data);
    expect(g.imports.get('sceneColor')).toBe(target);
    expect(g.values.get('stand/count')).toBe(7);
    expect([...g.published]).toEqual(['sceneColor']);
    expect(orderOf(g)).toEqual(['stand/work']);
    expect(() => g.include('other', stand(), { imports: { data } })).toThrow(/no object was given.*target/);
  });

  it('two nodes can share a frame resource and are ordered by what they do to it', () => {
    const g = new FrameBuilder('f'), target = fakeTexture(), data = fakeBuffer();
    const tech = stand();
    g.include('a', tech, { imports: { data: { as: 'shared', resource: data }, target: { as: 'sceneColor', resource: target } } });
    g.include('b', tech, { imports: { data: { as: 'shared', resource: data }, target: { as: 'sceneColor', resource: target } } });
    expect(orderOf(g)).toEqual(['a/work', 'b/work']);
    expect(g.imports.size).toBe(2);
  });

  it('keeps one compiled plan while the same technique is included, whatever the values, and hands over each frame\'s imports and values', () => {
    const frame = new FrameGraph(frameHost), tech = stand();
    const declare = (count: number, data: GPUBuffer, target: GPUTexture) => {
      const g = frame.begin();
      g.include('stand', tech, { imports: { data, target }, variables: { count } });
      return g;
    };
    const a = fakeBuffer(), b = fakeBuffer(), t1 = fakeTexture(), t2 = fakeTexture();
    const first = frame.run(declare(1, a, t1), encoder);
    expect(first.getVariable('stand/count')).toBe(1);
    const second = frame.run(declare(5, b, t2), encoder);
    expect(second).toBe(first);
    expect(second.compileCount).toBe(1);
    expect(second.getVariable('stand/count')).toBe(5);
    const third = frame.run(declare(5, b, fakeTexture({ w: 128 })), encoder);   // another size is another plan
    expect(third).not.toBe(first);
  });

  it('a different technique object is a different plan', () => {
    const frame = new FrameGraph(frameHost), data = fakeBuffer(), target = fakeTexture();
    const run = (tech: ReturnType<typeof stand>) => { const g = frame.begin(); g.include('stand', tech, { imports: { data, target } }); return frame.run(g, encoder); };
    const t1 = stand();
    const first = run(t1);
    expect(run(t1)).toBe(first);
    expect(run(stand())).not.toBe(first);
  });
});

describe('FrameBuilder.include and host code', () => {
  it('refuses a technique with a callback or render node: a reused plan could not swap its code', () => {
    const t = technique('code');
    t.callback('cb', { keep: true, execute: () => {} });
    const g = new FrameBuilder('f');
    expect(() => g.include('code', t.build())).toThrow(/cannot be swapped in/);
    const outer = technique('outer');
    outer.subgraph('inner', t.build());
    expect(() => g.include('outer', outer.build())).toThrow(/callback node 'cb'/);
  });
});

describe('FrameBuilder.structureKey', () => {
  const tech = () => { const t = technique('k'); t.uint('n', 1); t.clear('work', t.importedBuffer('data', 'u32')); return t.build(); };
  const declare = (t: ReturnType<typeof tech>, n: number, frame = 'f', target = 'sceneColor') => {
    const g = new FrameBuilder(frame);
    g.include('k', t, { imports: { data: { as: target, resource: fakeBuffer() } }, variables: { n } });
    g.callback('cb', { reads: [target], keep: true, execute: () => {} });
    return g.structureKey();
  };

  it('ignores variable values and the host functions', () => {
    const t = tech();
    expect(declare(t, 1)).toBe(declare(t, 99));
  });
  it('follows the technique object and the wiring of resources', () => {
    const t = tech();
    expect(declare(t, 1)).not.toBe(declare(tech(), 1));
    expect(declare(t, 1)).not.toBe(declare(t, 1, 'f', 'other'));
  });
});

describe('FrameGraph run', () => {
  it('swaps in the latest render-node code, including its segments', () => {
    const log: string[] = [];
    const encoderWithPass = { beginRenderPass: () => ({ end() {} }) } as unknown as GPUCommandEncoder;
    const frame = new FrameGraph(frameHost), target = fakeTexture(), depth = fakeTexture({ format: 'depth32float' });
    const declare = (tag: string) => {
      const g = frame.begin();
      const color = g.importTexture('color', target), z = g.importTexture('depth', depth);
      g.renderPass('main', { colorTargets: [color], depthTarget: { resource: z }, record: () => log.push(`record${tag}`), segments: [{ name: 'seg', record: () => log.push(`segment${tag}`) }] });
      return g;
    };
    const first = frame.run(declare('1'), encoderWithPass);
    expect(frame.run(declare('2'), encoderWithPass)).toBe(first);
    expect(log).toEqual(['record1', 'segment1', 'record2', 'segment2']);
  });

  it('timestamps go to the node whose path matches, else the nearest path above it', () => {
    const g = new FrameBuilder('f');
    expect(g.timestampSource()).toBeUndefined();
    g.timestamps('fog', () => ({ querySet: 'fog' } as unknown as GPUComputePassTimestampWrites));
    g.timestamps('fog/inner', () => ({ querySet: 'inner' } as unknown as GPUComputePassTimestampWrites));
    const source = g.timestampSource()!;
    const set = (path: string) => (source(path) as unknown as { querySet: string } | undefined)?.querySet;
    expect(set('fog')).toBe('fog');
    expect(set('fog/volume')).toBe('fog');
    expect(set('fog/inner/deep')).toBe('inner');
    expect(set('foggy')).toBeUndefined();
    expect(set('main')).toBeUndefined();
  });

  it('names a variable once and takes its latest value', () => {
    const g = new FrameBuilder('f');
    g.value('n', 'uint', 1); g.value('n', 'uint', 2);
    expect(g.values.get('n')).toBe(2);
    expect(g.hasVariable('n')).toBe(true);
  });
});
