import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Arena, ArenaCapacityError } from '../src/gpu/Arena';
import { BufferManager } from '../src/gpu/BufferManager';
import { GPUStats } from '../src/gpu/GPUStats';

beforeAll(() => {
  (globalThis as any).GPUBufferUsage = { COPY_DST: 8, COPY_SRC: 4, VERTEX: 32, INDEX: 16, UNIFORM: 64, STORAGE: 128 };
});

function setup(limits?: { maxBufferSize: number; maxStorageBufferBindingSize: number }) {
  const created: number[] = [];
  const device = {
    limits,
    queue: { writeBuffer() {}, submit() {} },
    createBuffer: (d: any) => { created.push(d.size); return { size: d.size, destroy() {} }; },
    createCommandEncoder: () => ({ copyBufferToBuffer() {}, finish: () => ({}) }),
  } as unknown as GPUDevice;
  return { device, buffers: new BufferManager(device, new GPUStats()), created };
}

describe('Arena size guard', () => {
  it('has no limit when the device reports none (fake devices, older runtimes)', () => {
    const { device, buffers } = setup();
    const a = new Arena(device, buffers, 'free', GPUBufferUsage.STORAGE, 16, 4);
    expect(a.maxBytes).toBe(Infinity);
    expect(a.alloc(1000)).toBe(0);
  });

  it('storage arenas are limited by the binding size, other arenas only by maxBufferSize', () => {
    const { device, buffers } = setup({ maxBufferSize: 1000, maxStorageBufferBindingSize: 400 });
    expect(new Arena(device, buffers, 's', GPUBufferUsage.STORAGE, 4, 4).maxBytes).toBe(400);
    expect(new Arena(device, buffers, 'v', GPUBufferUsage.VERTEX, 4, 4).maxBytes).toBe(1000);
  });

  it('throws a descriptive error instead of growing past the limit, and stays usable', () => {
    const { device, buffers } = setup({ maxBufferSize: 1 << 30, maxStorageBufferBindingSize: 1600 });
    const a = new Arena(device, buffers, 'deform', GPUBufferUsage.STORAGE, 16, 8);   // 128 B now, max 100 elements
    expect(a.alloc(60)).toBe(0);
    expect(() => a.alloc(41)).toThrow(ArenaCapacityError);   // 60 + 41 = 101 elements > 100
    expect(() => a.alloc(41)).toThrow(/deform/);
    expect(a.used).toBe(60);            // failed allocation did not consume space
    expect(a.alloc(40)).toBe(60);       // exactly the limit still works
    expect(a.used).toBe(100);
  });

  it('never doubles beyond the limit and warns once when above 80%', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { device, buffers, created } = setup({ maxBufferSize: 1 << 30, maxStorageBufferBindingSize: 16 * 100 });
    const a = new Arena(device, buffers, 'x', GPUBufferUsage.STORAGE, 16, 8);
    a.alloc(50);                         // doubles 8 -> 64 (fits)
    a.alloc(40);                         // 90 elements: needs 128 but capped at 100; > 80% -> warn
    expect(a.capacityElements).toBe(100);
    expect(Math.max(...created)).toBeLessThanOrEqual(1600);
    a.alloc(5);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
