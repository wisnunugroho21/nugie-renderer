import { beforeAll, describe, expect, it } from 'vitest';
import { installGPUGlobals } from './helpers/fakeGPU';
import { FrameUniform, FRAME_FLOATS } from '../src/rendering/FrameUniform';
import { LegacySceneLights, DEFAULT_SCENE, type SceneSettings } from '../src/rendering/lighting/LegacySceneLights';
import { GPULodIndex } from '../src/rendering/GPULodIndex';
import { StreamingDriver } from '../src/streaming/StreamingDriver';
import { Camera } from '../src/rendering/Camera';
import { LODLibrary } from '../src/visibility/LODSystem';
import type { GPUContext } from '../src/gpu/GPUContext';
import type { BindLayouts } from '../src/gpu/BindLayouts';
import type { MaterialManager } from '../src/rendering/materials/MaterialManager';
import type { RenderWorld } from '../src/rendering/RenderWorld';
import type { TextureStreamer } from '../src/streaming/TextureStreamer';

beforeAll(() => installGPUGlobals());

/** A GPUContext that records the contents of every queue.writeBuffer call. */
function recordingGPU() {
  const writes: { offset: number; floats: number[] }[] = [];
  const gpu = {
    queue: { writeBuffer: (_b: unknown, offset: number, data: Float32Array, dataOffset = 0, size?: number) => {
      const n = size ?? data.length - dataOffset;
      writes.push({ offset, floats: Array.from(data.subarray(dataOffset, dataOffset + n)) });
    } },
    device: { createBindGroup: () => ({}) },
    resources: { buffers: { create: (label: string, size: number) => ({ label, size }) } },
  } as unknown as GPUContext;
  return { gpu, writes };
}

describe('FrameUniform', () => {
  const camera = () => {
    const c = new Camera();
    c.setMatrices(Float32Array.from({ length: 16 }, (_, i) => i + 1), Float32Array.from({ length: 16 }, (_, i) => 100 + i), 0.5, 80);
    return c;
  };

  it('writeView lays the camera, time, viewport and flags out where the shaders read them', () => {
    const { gpu, writes } = recordingGPU();
    const u = new FrameUniform(gpu, {} as BindLayouts);
    const c = camera();
    u.writeView(c, 3.5, 640, 360, true);
    const f = writes[0].floats;
    expect(f.length).toBe(FRAME_FLOATS);
    expect(Array.from(f.slice(16, 32))).toEqual(Array.from(c.view));            // view
    expect(Array.from(f.slice(32, 48))).toEqual(Array.from(c.projection));      // projection
    expect(Array.from(f.slice(0, 16))).toEqual(Array.from(c.viewProjection));   // view * projection
    expect([f[51], f[52], f[53], f[54], f[55]]).toEqual([3.5, 640, 360, 0.5, 80]);
    expect([f[56], f[57], f[58], f[59]]).toEqual([1, 0, 0, 0]);
    u.writeView(c, 0, 8, 8, false);
    expect(writes[1].floats[56]).toBe(0);
  });

  it('setTransmission uploads only the three flag floats', () => {
    const { gpu, writes } = recordingGPU();
    const u = new FrameUniform(gpu, {} as BindLayouts);
    u.writeView(camera(), 0, 1, 1, true);
    u.setTransmission(true, 9);
    expect(writes[1]).toEqual({ offset: 57 * 4, floats: [1, 9, 0] });
    u.setTransmission(false, 9);
    expect(writes[2].floats).toEqual([0, 0, 0]);
  });

  it('snapshot / restore bring the main view back after an off-screen view overwrote it', () => {
    const { gpu, writes } = recordingGPU();
    const u = new FrameUniform(gpu, {} as BindLayouts);
    u.writeView(camera(), 7, 1024, 768, false);
    const saved = u.snapshot();
    u.writeView(camera(), 1, 64, 64, true);
    u.restore(saved);
    const last = writes[writes.length - 1].floats;
    expect([last[51], last[52], last[53], last[56]]).toEqual([7, 1024, 768, 0]);
  });
});

describe('LegacySceneLights', () => {
  it('builds a sun plus a hemisphere ambient light, and caches the set until the settings change', () => {
    const l = new LegacySceneLights();
    const a = l.get(DEFAULT_SCENE);
    expect(a.count).toBe(1);                                 // the sun; the hemisphere light is folded into the ambient terms
    expect(a.globalCount).toBe(1);
    expect(Array.from(a.ambientSky)).toEqual(DEFAULT_SCENE.ambientSky.map(Math.fround));
    expect(Array.from(a.ambientGround)).toEqual(DEFAULT_SCENE.ambientGround.map(Math.fround));
    const version = a.version;
    expect(l.get({ ...DEFAULT_SCENE })).toBe(a);        // equal settings: the same set, nothing rebuilt
    expect(a.version).toBe(version);
    const changed: SceneSettings = { ...DEFAULT_SCENE, sunColor: [1, 0, 0] };
    expect(l.get(changed)).toBe(a);
    expect(a.version).toBeGreaterThan(version);
  });
});

describe('GPULodIndex', () => {
  it('maps every level mesh to its group and picks up groups created later', () => {
    const meshes = { get: (id: number) => ({ id, name: 'm' + id, deformMask: 0, morphTargetCount: 0 }) } as never;
    const lib = new LODLibrary(meshes);
    const idx = new GPULodIndex(lib);
    expect(idx.groupOf(1)).toBeNull();
    lib.create({ levels: [{ meshId: 1, minScreenSize: 0.2 }, { meshId: 2, minScreenSize: 0.05 }] });
    expect(idx.groupOf(1)).toBe(lib.groups[0]);
    expect(idx.groupOf(2)).toBe(lib.groups[0]);
    expect(idx.groupOf(3)).toBeNull();
    lib.create({ levels: [{ meshId: 3, minScreenSize: 0.2 }] });
    expect(idx.groupOf(3)).toBe(lib.groups[1]);
  });
});

describe('StreamingDriver', () => {
  it('reports the largest on-screen size per material and rebuilds a material when a streamed texture changes', () => {
    const tex = { id: 't0' };
    const touched: [unknown, number][] = [];
    let changed: unknown = null;
    const streamer = {
      textures: [tex], onViewChanged: null as ((t: unknown) => void) | null,
      beginFrame() {}, touch: (t: unknown, px: number) => touched.push([t, px]), update() {},
    } as unknown as TextureStreamer;
    const materials = { get: () => ({ textures: [tex, null] }), textureChanged: (t: unknown) => { changed = t; } } as unknown as MaterialManager;
    const d = new StreamingDriver(materials);
    d.attach(streamer);
    (streamer as unknown as { onViewChanged: (t: unknown) => void }).onViewChanged(tex);
    expect(changed).toBe(tex);

    // two objects share material 0: a near one (sphere radius 1 at distance 2 -> about 0.87 of the height) and a far one
    const cam = new Camera(); cam.fovY = Math.PI / 2; cam.position.set([0, 0, 0]);
    const rw = { camera: cam, materialId: Int32Array.from([0, 0]), boundsSphere: Float32Array.from([0, 0, -2, 1, 0, 0, -50, 1]) } as unknown as RenderWorld;
    d.update(rw, null, 2, 1000);
    expect(touched.length).toBe(1);
    expect(touched[0][0]).toBe(tex);
    expect(touched[0][1]).toBeCloseTo(500, 0);          // r / (d * tan(fov / 2)) * height = 1 / 2 * 1000
  });
});
