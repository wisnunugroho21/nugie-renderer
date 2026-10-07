import { beforeAll, describe, expect, it } from 'vitest';
import { GPUResources } from '../src/gpu/GPUResources';
import { DynamicBufferAllocator } from '../src/gpu/DynamicBufferAllocator';

beforeAll(() => {
  (globalThis as any).GPUBufferUsage = { COPY_DST: 8, VERTEX: 32, UNIFORM: 64, STORAGE: 128 };
});

function setup(capacity = 1024) {
  const writes: { offset: number; size: number }[] = [];
  let created = 0;
  const device = {
    queue: { writeBuffer: (_b: any, offset: number, _d: any, _o: number, size: number) => writes.push({ offset, size }) },
    createBuffer: (d: any) => { created++; return { size: d.size, destroy() {} }; },
  } as unknown as GPUDevice;
  const res = new GPUResources(device);
  const alloc = new DynamicBufferAllocator(device, res.buffers, { label: 't', usage: 128, capacity, frames: 3 });
  return { alloc, res, writes, created: () => created };
}

describe('DynamicBufferAllocator', () => {
  it('5000 objects use a single GPU buffer', () => {
    const { alloc, res } = setup(64 * 5000);
    alloc.beginFrame();
    for (let i = 0; i < 5000; i++) alloc.allocate(64, 16);
    alloc.flush();
    expect(res.stats.buffers).toBe(1);
    expect(alloc.growths).toBe(0);
  });
  it('ring: each frame uses its own region, wrapping after N frames', () => {
    const { alloc } = setup(1024);
    const offs: number[] = [];
    for (let f = 0; f < 4; f++) { alloc.beginFrame(); offs.push(alloc.allocate(16)); }
    expect(offs).toEqual([0, 1024, 2048, 0]);
  });
  it('aligns allocations', () => {
    const { alloc } = setup(4096);
    alloc.beginFrame();
    expect(alloc.allocate(10, 16)).toBe(0);
    expect(alloc.allocate(10, 256)).toBe(256);
    expect(alloc.allocate(4, 4)).toBe(268);
  });
  it('flush uploads only the used range, one write per frame', () => {
    const { alloc, writes } = setup(4096);
    alloc.beginFrame();
    alloc.write(new Float32Array(16));
    alloc.write(new Float32Array(16));
    alloc.flush();
    expect(writes.length).toBe(1);
    expect(writes[0].size).toBe(256 + 64);
    expect(alloc.bytesUploadedThisFrame).toBe(320);
  });
  it('grows in place preserving data and bumping generation', () => {
    const { alloc, res } = setup(256);
    alloc.beginFrame();
    const o = alloc.write(new Float32Array([1, 2, 3, 4]));
    const gen = alloc.generation;
    alloc.allocate(1000);
    expect(alloc.generation).toBe(gen + 1);
    expect(alloc.float32[alloc.localOffset(o) / 4 + 2]).toBe(3);
    expect(res.stats.buffers).toBe(1); // old buffer destroyed
  });
  it('write copies data', () => {
    const { alloc } = setup(1024);
    alloc.beginFrame();
    const o = alloc.write(new Float32Array([7, 8, 9]));
    expect(Array.from(alloc.float32.subarray(o / 4, o / 4 + 3))).toEqual([7, 8, 9]);
  });
});

describe('instance buffer alignment (48-byte records in a ring)', () => {
  it('every frame region starts on a multiple of the record size, including after growth', () => {
    const { alloc } = setup(768 * 4);
    const RECORD = 48;
    const a = new DynamicBufferAllocator(
      { queue: { writeBuffer() {} }, createBuffer: (d: any) => ({ size: d.size, destroy() {} }) } as unknown as GPUDevice,
      (alloc as any).buffers, { label: 'inst', usage: 128, capacity: 768 * 4, frames: 3, alignment: 768 },
    );
    for (let f = 0; f < 7; f++) {
      a.beginFrame();
      expect(a.allocate(10 * RECORD) % RECORD).toBe(0);
    }
    a.beginFrame();
    expect(a.allocate(100000 * RECORD) % RECORD).toBe(0); // forces growth (capacity doubles)
    a.beginFrame();
    expect(a.allocate(RECORD) % RECORD).toBe(0);
  });
});
