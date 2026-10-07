import { describe, it, expect } from 'vitest';
import { WorkerPool, type WorkerLike } from '../src/workers/WorkerPool';
import { FrameBudgetQueue } from '../src/workers/FrameBudgetQueue';
import { generateLODChainAsync } from '../src/workers/GeometryJobs';
import { createUVSphere } from '../src/rendering/primitives';

/** Fake worker: echoes `value * 2` after `delay` ms, or an error for value < 0. */
function fakeWorker(log: number[]): WorkerLike {
  const w: WorkerLike = {
    onmessage: null, onerror: null, terminate() {},
    postMessage(msg) {
      const { value } = msg as { value: number };
      setTimeout(() => { log.push(value); w.onmessage?.({ data: value < 0 ? { error: 'negative' } : { result: value * 2 } }); }, 5);
    },
  };
  return w;
}

describe('WorkerPool', () => {
  it('runs jobs concurrently up to the pool size and resolves each with its own reply', async () => {
    const log: number[] = [];
    const pool = new WorkerPool(() => fakeWorker(log), 2);
    const rs = await Promise.all([1, 2, 3, 4, 5].map((v) => pool.run<{ result: number }>({ value: v })));
    expect(rs.map((r) => r.result)).toEqual([2, 4, 6, 8, 10]);
    expect(pool.peakBusy).toBe(2);
    expect(pool.completed).toBe(5);
  });
  it('honours priority for queued jobs and propagates worker errors', async () => {
    const log: number[] = [];
    const pool = new WorkerPool(() => fakeWorker(log), 1);
    const first = pool.run({ value: 1 });                  // starts immediately
    const low = pool.run({ value: 2 }, [], 0);
    const high = pool.run({ value: 3 }, [], 10);
    await Promise.all([first, low, high]);
    expect(log).toEqual([1, 3, 2]);
    await expect(pool.run({ value: -1 })).rejects.toThrow('negative');
    expect(await pool.run<{ result: number }>({ value: 7 })).toEqual({ result: 14 });   // still usable afterwards
  });
});

describe('FrameBudgetQueue', () => {
  it('runs by priority within the budget, always progresses, and supports cancellation', () => {
    let t = 0;
    const q = new FrameBudgetQueue(() => t);
    const order: string[] = [];
    const slow = (name: string, cost: number) => () => { order.push(name); t += cost; };
    q.enqueue(slow('low', 1), 0);
    q.enqueue(slow('high', 4), 5);
    const cancelled = q.enqueue(slow('never', 1), 9);
    q.enqueue(slow('mid', 4), 2);
    cancelled.cancel();
    expect(q.runFrame(5)).toBe(2);              // high (4ms) then mid starts at 4 < 5 -> runs; budget exhausted after
    expect(order).toEqual(['high', 'mid']);
    expect(q.runFrame(0)).toBe(1);              // at least one task per frame even with no budget
    expect(order).toEqual(['high', 'mid', 'low']);
    expect(q.length).toBe(0);
    expect(order).not.toContain('never');
  });
  it('rejects the task promise when a task throws, without breaking the queue', async () => {
    const q = new FrameBudgetQueue();
    const bad = q.enqueue(() => { throw new Error('boom'); });
    const good = q.enqueue(() => {});
    q.runFrame(100);
    await expect(bad.done).rejects.toThrow('boom');
    await expect(good.done).resolves.toBeUndefined();
  });
});

describe('geometry jobs', () => {
  it('falls back to synchronous generation when no Worker exists (Node)', async () => {
    const levels = await generateLODChainAsync(createUVSphere(16, 8), [0.5]);
    expect(levels.length).toBe(2);
    expect(levels[1].triangles).toBeLessThan(levels[0].triangles);
  });
});
