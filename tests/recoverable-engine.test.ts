import { describe, expect, it, vi } from 'vitest';
import { runRecoverable } from '../src/app/RecoverableEngine';
import type { Engine } from '../src/app/Engine';

/** A stand-in engine that only exposes what runRecoverable touches. */
function fakeEngine() {
  const engine = { onDeviceLost: null as ((i: GPUDeviceLostInfo) => void) | null, stop: vi.fn() };
  return engine as unknown as Engine & typeof engine;
}
const lost = (reason: GPUDeviceLostReason) => ({ reason, message: 'x' }) as GPUDeviceLostInfo;
const canvas = {} as HTMLCanvasElement;
const flush = () => new Promise((r) => setTimeout(r, 20));

describe('runRecoverable', () => {
  it('runs setup on the first engine and again on a replacement after a loss', async () => {
    const engines = [fakeEngine(), fakeEngine()];
    const create = vi.fn(async () => engines[create.mock.calls.length - 1]);
    const setup = vi.fn();
    const onRecovered = vi.fn();
    const game = await runRecoverable(canvas, {}, setup, { create, onRecovered, retryDelayMs: 1 });
    expect(game.engine).toBe(engines[0]);
    engines[0].onDeviceLost!(lost('unknown'));
    await flush();
    expect(setup).toHaveBeenCalledTimes(2);
    expect(game.engine).toBe(engines[1]);
    expect(onRecovered).toHaveBeenCalledWith(engines[1]);
  });
  it('does not recover from an intentional destroy', async () => {
    const e = fakeEngine();
    const create = vi.fn(async () => e);
    await runRecoverable(canvas, {}, () => {}, { create });
    e.onDeviceLost!(lost('destroyed'));
    await flush();
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('retries failed rebuilds, then reports failure', async () => {
    const first = fakeEngine();
    let calls = 0;
    const create = vi.fn(async () => { if (calls++ === 0) return first; throw new Error('no adapter'); });
    const onFailed = vi.fn();
    await runRecoverable(canvas, {}, () => {}, { create, onFailed, maxAttempts: 3, retryDelayMs: 1 });
    first.onDeviceLost!(lost('unknown'));
    await flush();
    expect(create).toHaveBeenCalledTimes(4);
    expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ message: 'no adapter' }));
  });
  it('stops recovering after dispose', async () => {
    const e = fakeEngine();
    const create = vi.fn(async () => e);
    const game = await runRecoverable(canvas, {}, () => {}, { create });
    game.dispose();
    e.onDeviceLost!(lost('unknown'));
    await flush();
    expect(create).toHaveBeenCalledTimes(1);
    expect(e.stop).toHaveBeenCalled();
  });
});
