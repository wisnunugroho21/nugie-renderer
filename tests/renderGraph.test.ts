import { describe, it, expect } from 'vitest';
import { RenderGraph } from '../src/rendering/RenderGraph';

const noop = () => {};
describe('RenderGraph', () => {
  it('orders producers before consumers regardless of declaration order', () => {
    const g = new RenderGraph();
    g.addPass({ name: 'main', reads: ['shadow', 'depth'], writes: ['backbuffer'], sideEffect: true, execute: noop });
    g.addPass({ name: 'prepass', writes: ['depth'], execute: noop });
    g.addPass({ name: 'shadows', writes: ['shadow'], execute: noop });
    const order = g.compile();
    expect(order.indexOf('main')).toBe(2);
    expect(order).toEqual(['prepass', 'shadows', 'main']);   // stable among independent passes
  });
  it('culls passes nobody consumes, keeps side-effect passes and their inputs', () => {
    const g = new RenderGraph();
    g.addPass({ name: 'unused', writes: ['x'], execute: noop });
    g.addPass({ name: 'a', writes: ['y'], execute: noop });
    g.addPass({ name: 'out', reads: ['y'], sideEffect: true, execute: noop });
    expect(g.compile()).toEqual(['a', 'out']);
    expect(g.culled).toEqual(['unused']);
  });
  it('keeps write-after-read ordering', () => {
    const g = new RenderGraph();
    g.addPass({ name: 'produce', writes: ['buf'], execute: noop });
    g.addPass({ name: 'read', reads: ['buf'], writes: ['o'], execute: noop });
    g.addPass({ name: 'overwrite', writes: ['buf'], execute: noop });
    g.addPass({ name: 'out', reads: ['o', 'buf'], sideEffect: true, execute: noop });
    const order = g.compile();
    expect(order.indexOf('read')).toBeLessThan(order.indexOf('overwrite'));
    expect(order.indexOf('overwrite')).toBeLessThan(order.indexOf('out'));
  });
  it('executes in compiled order and detects cycles', () => {
    const g = new RenderGraph();
    const log: string[] = [];
    g.addPass({ name: 'b', reads: ['r'], sideEffect: true, execute: () => log.push('b') });
    g.addPass({ name: 'a', writes: ['r'], execute: () => log.push('a') });
    g.compile(); g.execute(null as unknown as GPUCommandEncoder);
    expect(log).toEqual(['a', 'b']);
    // cycle: p reads what q writes and q reads what p writes
    const c = new RenderGraph();
    c.addPass({ name: 'p', reads: ['q1'], writes: ['p1'], sideEffect: true, execute: noop });
    c.addPass({ name: 'q', reads: ['p1'], writes: ['q1'], sideEffect: true, execute: noop });
    expect(() => c.compile()).toThrow(/cycle/);
  });
});

describe('RenderGraph regression cases', () => {
  const encoder = null as unknown as GPUCommandEncoder;
  it('supports an external resource being read and overwritten by the first pass', () => {
    const graph = new RenderGraph();
    graph.addPass({ name: 'first', reads: ['history'], writes: ['history'], execute: noop });
    graph.addPass({ name: 'second', reads: ['history'], writes: ['history'], sideEffect: true, execute: noop });
    expect(graph.compile()).toEqual(['first', 'second']);
  });
  it('invalidates execution after mutation or a failed recompile', () => {
    const graph = new RenderGraph();
    const log: string[] = [];
    graph.addPass({ name: 'first', reads: ['future'], writes: ['first'], sideEffect: true, execute: () => log.push('first') });
    graph.compile();
    graph.execute(encoder);
    graph.addPass({ name: 'cycle', reads: ['first'], writes: ['future'], execute: noop });
    expect(() => graph.execute(encoder)).toThrow(/compile/);
    expect(() => graph.compile()).toThrow(/cycle/);
    expect(() => graph.execute(encoder)).toThrow(/compile/);
    expect(graph.order).toEqual([]);
    expect(log).toEqual(['first']);
  });
  it('handles deep dependency chains without overflowing the call stack', () => {
    const graph = new RenderGraph();
    for (let i = 0; i < 15000; i++) {
      graph.addPass({ name: String(i), reads: i ? [String(i - 1)] : [], writes: [String(i)], sideEffect: i === 14999, execute: noop });
    }
    expect(graph.compile()).toHaveLength(15000);
    expect(graph.order[0]).toBe('0');
    expect(graph.order[14999]).toBe('14999');
  });
});
