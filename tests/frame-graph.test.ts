import { describe, it, expect } from 'vitest';
import { FrameGraph, FRAME_RESOURCES } from '../src/rendering/graph/FrameGraph';
import { addPass, frameHost, newFrame, orderOf } from './helpers/frameGraph';

const encoder = null as unknown as GPUCommandEncoder;

describe('frame graph ordering', () => {
  it('orders producers before consumers regardless of declaration order', () => {
    const g = newFrame().begin();
    addPass(g, { name: 'main', reads: ['shadow', 'depth'], writes: ['backbuffer'], sideEffect: true });
    addPass(g, { name: 'prepass', writes: ['depth'] });
    addPass(g, { name: 'shadows', writes: ['shadow'] });
    expect(orderOf(g)).toEqual(['prepass', 'shadows', 'main']);   // stable among independent passes
  });
  it('culls passes nobody consumes, keeps side-effect passes and their inputs', () => {
    const g = newFrame().begin();
    addPass(g, { name: 'unused', writes: ['x'] });
    addPass(g, { name: 'a', writes: ['y'] });
    addPass(g, { name: 'out', reads: ['y'], sideEffect: true });
    const plan = g.compile();
    expect(plan.steps.map((s) => s.node.path)).toEqual(['a', 'out']);
    expect(plan.culled).toEqual(['unused']);
  });
  it('keeps write-after-read ordering', () => {
    const g = newFrame().begin();
    addPass(g, { name: 'produce', writes: ['buf'] });
    addPass(g, { name: 'read', reads: ['buf'], writes: ['o'] });
    addPass(g, { name: 'overwrite', writes: ['buf'] });
    addPass(g, { name: 'out', reads: ['o', 'buf'], sideEffect: true });
    const order = orderOf(g);
    expect(order.indexOf('read')).toBeLessThan(order.indexOf('overwrite'));
    expect(order.indexOf('overwrite')).toBeLessThan(order.indexOf('out'));
  });
  it('executes in compiled order and detects cycles', () => {
    const frame = newFrame(), g = frame.begin(), log: string[] = [];
    addPass(g, { name: 'b', reads: ['r'], sideEffect: true, execute: () => log.push('b') });
    addPass(g, { name: 'a', writes: ['r'], execute: () => log.push('a') });
    frame.run(g, encoder);
    expect(log).toEqual(['a', 'b']);
    // cycle: p reads what q writes and q reads what p writes
    const c = newFrame().begin();
    addPass(c, { name: 'p', reads: ['q1'], writes: ['p1'], sideEffect: true });
    addPass(c, { name: 'q', reads: ['p1'], writes: ['q1'], sideEffect: true });
    expect(() => orderOf(c)).toThrow(/cycle/);
  });
  it('a read-modify-write of a resource nobody produced orders the passes by declaration', () => {
    const g = newFrame().begin();
    addPass(g, { name: 'first', reads: ['history'], writes: ['history'] });
    addPass(g, { name: 'second', reads: ['history'], writes: ['history'], sideEffect: true });
    expect(orderOf(g)).toEqual(['first', 'second']);
  });
  it('handles deep dependency chains without overflowing the call stack', () => {
    const g = newFrame().begin();
    for (let i = 0; i < 3000; i++) addPass(g, { name: String(i), reads: i ? [String(i - 1)] : [], writes: [String(i)], sideEffect: i === 2999 });
    const order = orderOf(g);
    expect(order).toHaveLength(3000);
    expect(order[0]).toBe('0');
    expect(order[2999]).toBe('2999');
  });
});

describe('logical resources', () => {
  it('are declared once, can be asked for again, and cannot shadow real resources', () => {
    const g = newFrame().begin();
    expect(g.logical('sceneColor')).toBe(g.logical('sceneColor'));
    g.buffer('real', { count: 4 });
    expect(() => g.logical('real')).toThrow(/real resource/);
    expect(() => g.callback('x', { reads: ['undeclared'], execute: () => {} })).toThrow(/not declared/);
    for (const name of FRAME_RESOURCES) expect(() => g.logical(name)).not.toThrow();
  });
  it('allocate nothing, and only callback nodes may use them', () => {
    const g = newFrame().begin();
    g.callback('c', { writes: ['depth'], keep: true, execute: () => {} });
    const plan = g.compile();
    expect(plan.slots).toEqual([]);
    expect(plan.diagnostics).toEqual([]);
    const bad = newFrame().begin();
    bad.compute('k', { shader: '@compute @workgroup_size(1) fn main() {}', workgroupSize: [1], dispatch: { threads: [1] }, writes: ['depth'] });
    expect(() => bad.compile()).toThrow(/logical resource/);
  });
});

describe('FrameGraph plan reuse', () => {
  it('reuses the compiled plan while the passes stay the same and runs the latest closures', () => {
    const frame = new FrameGraph(frameHost), log: string[] = [];
    const declare = (tag: string) => {
      const g = frame.begin();
      addPass(g, { name: 'a', writes: ['x'], execute: () => log.push(`a${tag}`) });
      addPass(g, { name: 'b', reads: ['x'], sideEffect: true, execute: () => log.push(`b${tag}`) });
      return g;
    };
    const first = frame.run(declare('1'), encoder);
    const second = frame.run(declare('2'), encoder);
    expect(second).toBe(first);
    expect(second.compileCount).toBe(1);
    expect(log).toEqual(['a1', 'b1', 'a2', 'b2']);
  });
  it('rebuilds when the passes or their dependencies change', () => {
    const frame = new FrameGraph(frameHost), log: string[] = [];
    const g1 = frame.begin();
    addPass(g1, { name: 'a', writes: ['x'], sideEffect: true, execute: () => log.push('a') });
    const first = frame.run(g1, encoder);
    const g2 = frame.begin();
    addPass(g2, { name: 'a', writes: ['x'], sideEffect: true, execute: () => log.push('a') });
    addPass(g2, { name: 'b', reads: ['x'], sideEffect: true, execute: () => log.push('b') });
    const second = frame.run(g2, encoder);
    expect(second).not.toBe(first);
    expect(frame.last).toBe(second);
    const g3 = frame.begin();
    addPass(g3, { name: 'b', reads: ['x'], sideEffect: true, execute: () => log.push('b') });
    addPass(g3, { name: 'a', writes: ['x'], sideEffect: true, execute: () => log.push('a') });   // same names, other declaration order: a reader declared first sees the incoming contents
    log.length = 0;
    frame.run(g3, encoder);
    expect(log.sort()).toEqual(['a', 'b']);
  });
  it('a failed compile leaves no stale plan behind', () => {
    const frame = new FrameGraph(frameHost);
    const ok = frame.begin();
    addPass(ok, { name: 'a', writes: ['x'], sideEffect: true });
    frame.run(ok, encoder);
    const cyc = frame.begin();
    addPass(cyc, { name: 'p', reads: ['q1'], writes: ['p1'], sideEffect: true });
    addPass(cyc, { name: 'q', reads: ['p1'], writes: ['q1'], sideEffect: true });
    expect(() => frame.run(cyc, encoder)).toThrow(/cycle/);
    expect(frame.last).toBeNull();
  });
  it('names passed to begin() are declared', () => {
    const g = newFrame().begin(['sim']);
    expect(() => g.callback('x', { writes: ['sim'], keep: true, execute: () => {} })).not.toThrow();
  });
});
