import { describe, expect, it } from 'vitest';
import { TrackedRenderPass } from '../src/rendering/graph/TrackedRenderPass';

/** A render pass encoder that logs the calls that reach it. */
function recorder() {
  const calls: unknown[][] = [];
  const log = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
  const encoder = {
    setPipeline: log('setPipeline'), setBindGroup: log('setBindGroup'), setVertexBuffer: log('setVertexBuffer'), setIndexBuffer: log('setIndexBuffer'),
    draw: log('draw'), drawIndexed: log('drawIndexed'), drawIndirect: log('drawIndirect'), drawIndexedIndirect: log('drawIndexedIndirect'),
  } as unknown as GPURenderPassEncoder;
  return { calls, pass: new TrackedRenderPass(encoder) };
}
const obj = (name: string) => ({ name }) as never;

describe('TrackedRenderPass', () => {
  it('skips a pipeline that is already set', () => {
    const { calls, pass } = recorder();
    const a = obj('a'), b = obj('b');
    pass.setPipeline(a); pass.setPipeline(a); pass.setPipeline(b); pass.setPipeline(a);
    expect(calls.map((c) => [c[0], (c[1] as { name: string }).name])).toEqual([['setPipeline', 'a'], ['setPipeline', 'b'], ['setPipeline', 'a']]);
    expect(pass.switches.pipeline).toBe(3);
    expect(pass.skipped.pipeline).toBe(1);
  });

  it('tracks bind groups per group index', () => {
    const { calls, pass } = recorder();
    const g1 = obj('g1'), g2 = obj('g2');
    pass.setBindGroup(0, g1); pass.setBindGroup(1, g1); pass.setBindGroup(0, g1); pass.setBindGroup(0, g2); pass.setBindGroup(1, g1);
    expect(calls.map((c) => [c[1], (c[2] as { name: string }).name])).toEqual([[0, 'g1'], [1, 'g1'], [0, 'g2']]);
    expect(pass.skipped.bindGroup).toBe(2);
  });

  it('always forwards a bind group with dynamic offsets, and forgets that group so the next plain set is not skipped', () => {
    const { calls, pass } = recorder();
    const g = obj('g');
    pass.setBindGroup(2, g);
    pass.setBindGroup(2, g, [0]); pass.setBindGroup(2, g, [256]);
    pass.setBindGroup(2, g);
    expect(calls.map((c) => c[3])).toEqual([undefined, [0], [256], undefined]);
    expect(pass.skipped.bindGroup).toBe(0);
  });

  it('skips unchanged vertex and index buffers, but not a changed offset, size or format', () => {
    const { calls, pass } = recorder();
    const v = obj('v'), i = obj('i');
    pass.setVertexBuffer(0, v); pass.setVertexBuffer(0, v); pass.setVertexBuffer(0, v, 16); pass.setVertexBuffer(0, v, 16, 64); pass.setVertexBuffer(1, v);
    pass.setIndexBuffer(i, 'uint32'); pass.setIndexBuffer(i, 'uint32'); pass.setIndexBuffer(i, 'uint16'); pass.setIndexBuffer(i, 'uint16', 4);
    expect(calls.filter((c) => c[0] === 'setVertexBuffer')).toHaveLength(4);
    expect(calls.filter((c) => c[0] === 'setIndexBuffer')).toHaveLength(3);
    expect(pass.skipped).toMatchObject({ vertexBuffer: 1, indexBuffer: 1 });
  });

  it('forwards every draw and counts them', () => {
    const { calls, pass } = recorder();
    pass.draw(3); pass.drawIndexed(6, 2, 1, -4, 3); pass.drawIndirect(obj('b'), 0); pass.drawIndexedIndirect(obj('b'), 20);
    expect(calls.map((c) => c[0])).toEqual(['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect']);
    expect(calls[0].slice(1)).toEqual([3, 1, 0, 0]);
    expect(calls[1].slice(1)).toEqual([6, 2, 1, -4, 3]);
    expect(pass.drawCalls).toBe(4);
  });
});
