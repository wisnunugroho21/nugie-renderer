import { afterEach, describe, expect, it, vi } from 'vitest';
import { Application } from '../src/app/Application';

function setup() {
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  const app = new Application({} as HTMLCanvasElement);
  const tick = () => {
    const [frame, callback] = frames.entries().next().value!;
    frames.delete(frame);
    callback(performance.now() + 16);
  };
  return { app, frames, tick };
}

afterEach(() => vi.unstubAllGlobals());

describe('Application frame loop', () => {
  it('keeps exactly one scheduled loop when a frame callback stops and restarts', () => {
    const s = setup();
    s.app.onFrame = () => { s.app.stop(); s.app.start(); };
    s.app.start(); s.app.start();
    for (let i = 0; i < 5; i++) {
      s.tick();
      expect(s.frames.size).toBe(1);
    }
    expect(s.app.frame).toBe(5);
    s.app.dispose();
    expect(s.frames.size).toBe(0);
  });
  it('does not reschedule after a callback stops the loop', () => {
    const s = setup();
    s.app.onFrame = () => s.app.stop();
    s.app.start(); s.tick();
    expect(s.frames.size).toBe(0);
  });
  it('can restart after an exception and passes the animation-frame timestamp', () => {
    const s = setup();
    s.app.onFrame = () => { throw new Error('frame failed'); };
    s.app.start();
    expect(s.tick).toThrow('frame failed');
    const callback = vi.fn();
    s.app.onFrame = callback;
    s.app.start(); s.tick();
    expect(callback).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
    expect(s.frames.size).toBe(1);
    s.app.dispose();
  });
});
