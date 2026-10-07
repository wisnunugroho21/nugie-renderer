import { describe, expect, it } from 'vitest';
import { EMITTER_BYTES, EMITTER_FLOATS, EmitterRuntime, packEmitter, resolveEmitter } from '../src/particles/EmitterConfig';

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const run = (e: EmitterRuntime, frames: number, dt: number) => { let n = 0; for (let i = 0; i < frames; i++) n += e.tick(dt); return n; };

describe('EmitterRuntime spawn scheduling', () => {
  it('rate emission accumulates fractional particles across frames (no drift, independent of frame rate)', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 144, 0.0137]) {
      const e = new EmitterRuntime({ rate: 50 });
      const frames = Math.round(2 / dt);
      const n = run(e, frames, dt);
      expect(Math.abs(n - 50 * frames * dt)).toBeLessThan(1.0001);
    }
  });

  it('a rate below one particle per frame still emits (fractions carry over)', () => {
    const e = new EmitterRuntime({ rate: 5 });
    expect(run(e, 60, 1 / 60)).toBe(5);
  });

  it('bursts fire exactly once at their time (including time 0 on the first tick)', () => {
    const e = new EmitterRuntime({ bursts: [{ time: 0, count: 10 }, { time: 0.5, count: 20 }] });
    expect(e.tick(0.016)).toBe(10);                       // burst at t=0
    let total = 10;
    for (let i = 0; i < 100; i++) total += e.tick(0.016);
    expect(total).toBe(30);                               // the 0.5s burst fired once, nothing repeats (endless emitter)
  });

  it('a burst fires on the frame that crosses its time', () => {
    const e = new EmitterRuntime({ bursts: [{ time: 0.1, count: 7 }] });
    expect(e.tick(0.05)).toBe(0); expect(e.tick(0.04)).toBe(0);
    expect(e.tick(0.02)).toBe(7);
    expect(e.tick(0.5)).toBe(0);
  });

  it('looping emitters repeat bursts every loop; rate emission continues across the wrap', () => {
    const e = new EmitterRuntime({ duration: 1, loop: true, rate: 10, bursts: [{ time: 0, count: 100 }] });
    let total = 0; for (let i = 0; i < 300; i++) total += e.tick(0.01);   // 3.0 s = 3 loops
    expect(total).toBe(3 * 100 + 30);
  });

  it('non-looping emitters stop at their duration and report finished', () => {
    const e = new EmitterRuntime({ duration: 0.5, loop: false, rate: 100, bursts: [{ time: 0.25, count: 5 }] });
    let total = 0; for (let i = 0; i < 200; i++) total += e.tick(0.01);
    expect(e.finished).toBe(true);
    expect(total).toBe(50 + 5);
    expect(e.tick(1)).toBe(0);
  });

  it('a huge timestep spanning several loops fires every burst of every loop', () => {
    const e = new EmitterRuntime({ duration: 0.5, loop: true, bursts: [{ time: 0.1, count: 3 }, { time: 0.3, count: 4 }] });
    expect(e.tick(2.0)).toBe(4 * (3 + 4));                // 4 loops
  });

  it('disabled emitters spawn nothing; restart() rewinds', () => {
    const e = new EmitterRuntime({ bursts: [{ time: 0, count: 9 }] });
    e.enabled = false; expect(e.tick(1)).toBe(0);
    e.enabled = true; expect(e.tick(0.1)).toBe(9);
    e.restart(); expect(e.tick(0.1)).toBe(9);
  });

  it('zero / negative dt is a no-op', () => {
    const e = new EmitterRuntime({ rate: 100, bursts: [{ time: 0, count: 5 }] });
    expect(e.tick(0)).toBe(0); expect(e.tick(-1)).toBe(0);
    expect(e.tick(0.01)).toBe(5 + 1);
  });
});

describe('emitter GPU packing (must mirror struct Emitter in particles_common.wgsl)', () => {
  const pack = (cfg: Parameters<typeof packEmitter>[0], world: number[] = I) => {
    const out = new Float32Array(EMITTER_FLOATS);
    packEmitter(cfg, world, out, 0);
    return out;
  };

  it('struct size is 240 bytes (60 floats), a multiple of 16', () => {
    expect(EMITTER_BYTES).toBe(240);
    expect(EMITTER_BYTES % 16).toBe(0);
  });

  it('world matrix, velocities, acceleration/drag, lifetime/size, rotation, colors land in their slots', () => {
    const world = [...I]; world[12] = 3; world[13] = 4; world[14] = 5;
    const o = pack({
      shape: 'sphere', radius: 2, surfaceOnly: true, velocityMin: [1, 2, 3], velocityMax: [4, 5, 6], radialSpeed: [7, 8], acceleration: [0, -9.8, 0], drag: 0.5,
      lifetime: [1, 2], size: [0.1, 0.2], sizeEndScale: 3, rotation: [0, 1], angularVelocity: [-1, 1], colorStart: [1, 0.5, 0.25, 1], colorEnd: [0, 0, 0, 0], space: 'local', seed: 77,
    }, world);
    expect(Array.from(o.subarray(12, 15))).toEqual([3, 4, 5]);                 // translation column
    expect(Array.from(o.subarray(16, 20))).toEqual([2, 1, 0, 0]);              // shapeParams: radius, surfaceOnly
    expect(Array.from(o.subarray(20, 24))).toEqual([1, 2, 3, 7]);              // velMin + radialMin
    expect(Array.from(o.subarray(24, 28))).toEqual([4, 5, 6, 8]);
    expect(o[28]).toBeCloseTo(0); expect(o[29]).toBeCloseTo(-9.8); expect(o[31]).toBeCloseTo(0.5);
    expect(Array.from(o.subarray(32, 36)).map((v) => +v.toFixed(4))).toEqual([1, 2, 0.1, 0.2]);
    expect(Array.from(o.subarray(36, 40))).toEqual([0, 1, -1, 1]);
    expect(Array.from(o.subarray(40, 44))).toEqual([1, 0.5, 0.25, 1]);
    expect(Array.from(o.subarray(44, 48))).toEqual([0, 0, 0, 0]);
    expect(Array.from(o.subarray(48, 52))).toEqual([3, 1, 2, 1]);              // endScale, dir mode (outward), shape (sphere), local space
    expect(new Uint32Array(o.buffer)[56]).toBe(77);                            // seed (as u32)
  });

  it('shape-specific parameters', () => {
    expect(Array.from(pack({ shape: 'box', box: [1, 2, 3] }).subarray(16, 20))).toEqual([1, 2, 3, 0]);
    const cone = pack({ shape: 'cone', radius: 0.4, coneAngle: 0.5 });
    expect(cone[16]).toBeCloseTo(0.4); expect(cone[19]).toBeCloseTo(0.5);
    expect(cone[48 + 1]).toBe(2);   // cone shape defaults to cone-axis direction
    expect(pack({ shape: 'point' })[48 + 2]).toBe(0);
  });

  it('flipbook parameters and defaults', () => {
    const o = pack({ flipbook: { columns: 4, rows: 2, frames: 8, fps: 12 } });
    expect(Array.from(o.subarray(52, 56))).toEqual([4, 2, 8, 12]);
    expect(Array.from(pack({}).subarray(52, 56))).toEqual([1, 1, 1, 0]);
  });

  it('defaults are concrete (resolveEmitter)', () => {
    const r = resolveEmitter({});
    expect(r.shape).toBe('point'); expect(r.lifetime).toEqual([1, 1]); expect(r.space).toBe('world'); expect(r.loop).toBe(true);
    expect(r.bursts).toEqual([]);
  });

  it('bursts are sorted by time', () => {
    expect(resolveEmitter({ bursts: [{ time: 2, count: 1 }, { time: 1, count: 2 }] }).bursts.map((b) => b.time)).toEqual([1, 2]);
  });
});

import { beamPoints } from '../src/particles/RibbonSystem';

describe('beamPoints (lightning / beam control points)', () => {
  const a: [number, number, number] = [0, 1, 0], b: [number, number, number] = [10, 1, 5];
  it('keeps the endpoints exactly and produces segments + 1 points', () => {
    const p = beamPoints(a, b, 12, 0.5, 7);
    expect(p.length).toBe(13 * 3);
    expect(Array.from(p.subarray(0, 3))).toEqual(a);
    expect(Array.from(p.subarray(36, 39)).map((v) => +v.toFixed(5))).toEqual(b);
  });
  it('is deterministic for a seed and differs for another', () => {
    expect(Array.from(beamPoints(a, b, 8, 0.4, 3))).toEqual(Array.from(beamPoints(a, b, 8, 0.4, 3)));
    expect(Array.from(beamPoints(a, b, 8, 0.4, 3))).not.toEqual(Array.from(beamPoints(a, b, 8, 0.4, 4)));
  });
  it('jitter is bounded, perpendicular to the beam and tapers to zero at both ends', () => {
    const jitter = 0.6, p = beamPoints(a, b, 20, jitter, 11);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d), u = d.map((v) => v / L);
    for (let i = 0; i <= 20; i++) {
      const rel = [p[i * 3] - a[0], p[i * 3 + 1] - a[1], p[i * 3 + 2] - a[2]];
      const along = rel[0] * u[0] + rel[1] * u[1] + rel[2] * u[2];
      expect(along).toBeCloseTo((i / 20) * L, 4);                       // displacement is purely perpendicular
      const off = Math.hypot(rel[0] - u[0] * along, rel[1] - u[1] * along, rel[2] - u[2] * along);
      expect(off).toBeLessThanOrEqual(jitter * Math.SQRT2 + 1e-4);
    }
  });
  it('zero jitter gives a straight evenly spaced line', () => {
    const p = beamPoints(a, b, 4, 0, 1);
    for (let i = 0; i <= 4; i++) expect(Array.from(p.subarray(i * 3, i * 3 + 3)).map((v) => +v.toFixed(5))).toEqual([a[0] + (b[0] - a[0]) * i / 4, a[1], a[2] + (b[2] - a[2]) * i / 4].map((v) => +v.toFixed(5)));
  });
  it('degenerate beams (a == b, vertical) do not produce NaN', () => {
    for (const [s, e] of [[[1, 1, 1], [1, 1, 1]], [[0, 0, 0], [0, 5, 0]]] as [number[], number[]][]) {
      for (const v of beamPoints(s as [number, number, number], e as [number, number, number], 6, 0.3, 2)) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
