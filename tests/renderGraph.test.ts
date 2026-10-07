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
