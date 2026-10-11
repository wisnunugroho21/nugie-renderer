/**
 * nugie-renderer vs Three.js `WebGPURenderer` on an identical scene (`/bench-three.html`).
 *
 * What is identical for every contender
 *  - Geometry: Three.js `BufferGeometry` objects are built from the very same vertex / index arrays as nugie's meshes.
 *  - Materials: metallic-roughness PBR, same base colours and roughness, no textures. Linear base colours, no ambient / IBL / fog / shadows.
 *  - Lights: same positions, colours and units. Both engines use radiometric units (directional = irradiance, point = I / d^2 with the
 *    Karis `(1 - (d/range)^4)^2` window), so intensities are passed through unchanged.
 *  - Camera: same position, orientation, vertical FOV 60 deg, near / far; 960 x 540, pixel ratio 1, no MSAA, no post-processing chain,
 *    black clear colour. Output transform: nugie's direct path applies the Narkowicz ACES fit + sRGB encode in the material shader, so
 *    that exact curve is installed as Three.js' custom tone mapping (Three.js applies it in its output pass).
 *  - Static scene: no transform updates during the measurement in either engine, no culling (everything is in view).
 *  - Same GPU: both engines request the default adapter; the adapter each device actually runs on is recorded.
 *
 * Scenarios (`?scenario=`)
 *  - `objects`: N objects (8 materials x 2 meshes: cube + 8x6 sphere), one directional light. Draw-submission bound.
 *      nugie `unsorted` (one draw per object) and `instanced` (state-sorted instancing);
 *      Three.js `Mesh` default settings, `Mesh` tuned (frozen matrices, no frustum culling, no sorting),
 *      `InstancedMesh` tuned (16 draws), `BatchedMesh` tuned (8 draws, both geometries in one batch per material).
 *  - `lights`: 400 instanced spheres + floor under N point lights. Fragment bound.
 *      nugie clustered and naive loop; Three.js default forward loop and the `ClusteredLighting` addon.
 *
 * Other parameters: `n=<count>`, `frames=<per round>` (default 40), `rounds=<n>` (default 3; the order rotates each round and the
 * frames of all rounds are pooled), `only=<substring>` (the first contender always runs: it is the image reference), `full=1` (do not skip Three.js' forward loop above 256 lights).
 *
 * Reported per contender: `cpu` = time inside `render()` (command encoding), `total` = submit -> GPU idle (`onSubmittedWorkDone`),
 * median / p95 over the pooled frames, draw calls and triangles as reported by each engine, and an image comparison with the first
 * contender (mean absolute error per channel on a 0..255 scale, and the share of pixels differing by more than 16 levels).
 */
import * as T from 'three/webgpu';
import { clamp } from 'three/tsl';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { GPUContext } from '../gpu/GPUContext';
import { Renderer, type BatchingMode } from '../rendering/Renderer';
import { RenderWorld } from '../rendering/RenderWorld';
import { RenderExtractor } from '../rendering/RenderExtractor';
import { World } from '../ecs/World';
import { TransformSystem } from '../ecs/systems/TransformSystem';
import { BoundsSystem } from '../ecs/systems/BoundsSystem';
import { entityIndex } from '../ecs/Entity';
import { LightType } from '../ecs/components/LightStore';
import { createCube, createPlane, createUVSphere, type MeshData } from '../rendering/primitives';
import { STANDARD_VERTEX_FLOATS } from '../rendering/VertexLayouts';

const W = 960, H = 540, FOV = Math.PI / 3;
/** Alternate warmed, live devices frame-by-frame to reduce long-block clock/scheduling bias. */
async function measureInterleaved(cs: Contender[], frames: number, thumbnail: boolean, round: number): Promise<Map<string, Sample>> {
  const live: { c: Contender; canvas: HTMLCanvasElement; scene: Scene; sample: Sample }[] = [];
  try {
    for (const c of cs) {
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; stage.appendChild(canvas);
      const scene = await c.create(canvas);
      const sample: Sample = { cpu: [], total: [], ...scene.counts(), adapter: scene.adapter(), pixels: new Uint8ClampedArray(0) };
      live.push({ c, canvas, scene, sample });
    }
    for (let i = 0; i < 30; i++) for (const x of live) { x.scene.frame(); await x.scene.idle(); }
    for (const x of live) {
      x.scene.frame();
      const snap = document.createElement('canvas'); snap.width = W; snap.height = H;
      const ctx = snap.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(x.canvas, 0, 0); x.sample.pixels = ctx.getImageData(0, 0, W, H).data;
      Object.assign(x.sample, x.scene.counts()); await x.scene.idle();
      if (thumbnail) { snap.title = x.c.name; stage.appendChild(snap); }
    }
    for (let f = 0; f < frames; f++) for (let k = 0; k < live.length; k++) {
      const x = live[(k + f + round) % live.length], start = performance.now();
      x.scene.frame(); const cpu = performance.now() - start; await x.scene.idle();
      x.sample.cpu.push(cpu); x.sample.total.push(performance.now() - start);
    }
    for (const x of live) x.sample.diagnostics = x.scene.diagnostics?.();
    return new Map(live.map(x => [x.c.name, x.sample]));
  } finally { for (const x of live) { x.scene.dispose(); x.canvas.remove(); } }
}

/** Mean absolute error (0..255) above which a contender's image is flagged as not matching the reference. */
const MATCH_MAE = 0.5;
/** Black: it stays black under any output transform, so the clear colour cannot differ between engines that tone map it differently. */
const CLEAR: [number, number, number] = [0, 0, 0];
const out = document.getElementById('out')!;
const stage = document.getElementById('stage')!;
/** Append a line to the page output. */
const log = (s: string) => { out.textContent += '\n' + s; };

type V3 = [number, number, number];
type Q4 = [number, number, number, number];

interface Scene {
  /** Encode and submit one frame. */
  frame(): void;
  /** Resolve when the GPU has finished all submitted work. */
  idle(): Promise<void>;
  /** Draw calls and triangles of the last frame, as counted by the engine itself. */
  counts(): { draws: number; triangles: number };
  diagnostics?(): Record<string, number>;
  /** The adapter the device runs on. */
  adapter(): string;
  dispose(): void;
}
interface Contender { name: string; create(canvas: HTMLCanvasElement): Promise<Scene>; }
interface Stats { median: number; p95: number; mean: number; }
interface Row {
  scenario: string; param: number; contender: string; adapter?: string; cpu?: Stats; total?: Stats; draws?: number; triangles?: number;
  imageMAE?: number; imageDiffPct?: number; meanLuma?: number; litRatio?: number; litPct?: number; skipped?: string;
}

// -------------------------------------------------------------------------------------------------------------- shared data

/** Deterministic pseudo-random generator in [0, 1), identical for every contender. */
function lcg(seed: number): () => number {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Quaternion (x, y, z, w) that rotates the local -Z axis onto the unit vector `d`. Used for every light direction. */
function quatFromMinusZ(d: V3): Q4 {
  const l = Math.hypot(...d), v: V3 = [d[0] / l, d[1] / l, d[2] / l], f: V3 = [0, 0, -1];
  const c: V3 = [f[1] * v[2] - f[2] * v[1], f[2] * v[0] - f[0] * v[2], f[0] * v[1] - f[1] * v[0]];
  const w = 1 + (f[0] * v[0] + f[1] * v[1] + f[2] * v[2]), n = Math.hypot(c[0], c[1], c[2], w);
  return [c[0] / n, c[1] / n, c[2] / n, w / n];
}

/** Base colour and roughness of material `i` in the objects scenario. */
function materialParams(i: number): { color: V3; roughness: number } {
  const forced = new URLSearchParams(location.search).get('rough');   // debug: `?rough=1` forces one roughness to separate diffuse from specular differences
  return { color: [0.25 + 0.09 * i, 0.85 - 0.08 * i, 0.35 + 0.05 * i], roughness: forced ? Number(forced) : 0.15 + 0.1 * i };
}

/** Sun intensity of a scenario (debug: `?sun=<x>` overrides it for every contender). */
function sunIntensity(scenario: string): number {
  const forced = new URLSearchParams(location.search).get('sun');
  return forced ? Number(forced) : scenario === 'objects' ? 1.5 : 0.3;
}

const SUN_OBJECTS: V3 = [-0.4, -0.7, -0.6], SUN_LIGHTS: V3 = [0.3, -1, -0.4];

/** Grid position, mesh index and material index of every object in the objects scenario. */
function objectLayout(count: number) {
  const side = Math.ceil(Math.cbrt(count)), rnd = lcg(12345);
  const items = Array.from({ length: count }, (_, i) => ({
    x: (i % side) * 1.2, y: (Math.floor(i / side) % side) * 1.2, z: Math.floor(i / (side * side)) * 1.2,
    mesh: Math.floor(rnd() * 2), mat: Math.floor(rnd() * 8),
  }));
  return { side, items, camera: [side * 0.6, side * 0.6, side * 3] as V3, far: 1000 };
}

/** Sphere positions and point lights of the lights scenario. */
function lightLayout(lights: number) {
  const rnd = lcg(7);
  const spheres = Array.from({ length: 400 }, () => ({ x: (rnd() - 0.5) * 56, z: (rnd() - 0.5) * 56 }));
  const points = Array.from({ length: lights }, () => ({
    x: (rnd() - 0.5) * 60, y: 1 + rnd() * 2, z: (rnd() - 0.5) * 60, c: [0.4 + rnd() * 0.6, 0.4 + rnd() * 0.6, 0.4 + rnd() * 0.6] as V3,
  }));
  return { spheres, points, camera: [0, 14, 34] as V3, cameraQuat: [-0.2, 0, 0, Math.sqrt(0.96)] as Q4, far: 200 };
}

/** A Three.js geometry holding exactly the vertices and indices of a nugie mesh. */
function geometryOf(d: MeshData): T.BufferGeometry {
  const n = d.vertices.length / STANDARD_VERTEX_FLOATS, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const o = i * STANDARD_VERTEX_FLOATS;
    pos.set(d.vertices.subarray(o, o + 3), i * 3); nor.set(d.vertices.subarray(o + 3, o + 6), i * 3); uv.set(d.vertices.subarray(o + 6, o + 8), i * 2);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3)); g.setAttribute('uv', new T.BufferAttribute(uv, 2));
  g.setIndex(new T.BufferAttribute(d.indices, 1));
  return g;
}

// -------------------------------------------------------------------------------------------------------------- nugie

/** The nugie-renderer contender. `batching` is used by the objects scenario, `clustered` by the lights scenario. */
function nugie(scenario: string, param: number, label: string, batching: BatchingMode, clustered: boolean, lightingVariant?: boolean): Contender {
  return {
    name: label,
    async create(canvas) {
      const gpu = await GPUContext.create(canvas);
      const renderer = new Renderer(gpu);
      renderer.batching = batching; renderer.clusteredShading = clustered; renderer.profiler.enabled = new URLSearchParams(location.search).get('profile') === '1';
      // A/B switch for retained preparation once supported by the renderer.
      renderer.retainedBundles = new URLSearchParams(location.search).get('bundles') !== '0';
      renderer.retainedLighting = lightingVariant ?? (new URLSearchParams(location.search).get('lighting') !== '0');
      renderer.retainedVertex = new URLSearchParams(location.search).get('vertex') === '1';
      renderer.cacheDraws = new URLSearchParams(location.search).get('cache') !== '0';
      renderer.clearColor = { r: CLEAR[0], g: CLEAR[1], b: CLEAR[2], a: 1 };
      const world = new World();
      const ts = new TransformSystem(world.transforms), bs = new BoundsSystem(world.transforms, world.bounds);
      const ex = new RenderExtractor(world, ts), rw = new RenderWorld();
      const sun = entityIndex(world.create());
      const lights = scenario === 'objects' ? null : lightLayout(param);
      const sq = quatFromMinusZ(scenario === 'objects' ? SUN_OBJECTS : SUN_LIGHTS);
      world.transforms.add(sun); world.transforms.setRotation(sun, sq[0], sq[1], sq[2], sq[3]);
      world.lights.add(sun, LightType.Directional, 1, 1, 1, sunIntensity(scenario));
      const cam = entityIndex(world.create());
      const addMesh = (mesh: number, mat: number, x: number, y: number, z: number, s: number) => {
        const e = entityIndex(world.create());
        world.transforms.add(e, x, y, z); if (s !== 1) world.transforms.setScale(e, s, s, s);
        world.meshRenderers.add(e, mesh, mat); world.bounds.add(e, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5);
      };
      if (scenario === 'objects') {
        const meshes = [renderer.meshes.create('cube', createCube()), renderer.meshes.create('sphere', createUVSphere(8, 6))];
        const mats = Array.from({ length: 8 }, (_, i) => { const p = materialParams(i); return renderer.materials.createPBR({ baseColor: [...p.color, 1], roughness: p.roughness, metallic: 0 }); });
        const L = objectLayout(param);
        for (const it of L.items) addMesh(meshes[it.mesh], mats[it.mat], it.x, it.y, it.z, 0.5);
        world.cameras.add(cam, FOV, 0.1, L.far); world.transforms.add(cam, ...L.camera);
      } else {
        const sphere = renderer.meshes.create('sphere', createUVSphere(24, 12)), plane = renderer.meshes.create('plane', createPlane());
        const mat = renderer.materials.createPBR({ baseColor: [0.8, 0.8, 0.8, 1], roughness: 0.45, metallic: 0 });
        const g = entityIndex(world.create());
        world.transforms.add(g, 0, 0, 0); world.transforms.setScale(g, 70, 1, 70);
        world.meshRenderers.add(g, plane, mat); world.bounds.add(g, -0.5, 0, -0.5, 0.5, 0, 0.5);
        for (const s of lights!.spheres) addMesh(sphere, mat, s.x, 0.8, s.z, 1);
        for (const l of lights!.points) {
          const e = entityIndex(world.create());
          world.transforms.add(e, l.x, l.y, l.z); world.lights.add(e, LightType.Point, l.c[0], l.c[1], l.c[2], 8, 5);
        }
        world.cameras.add(cam, FOV, 0.1, lights!.far); world.transforms.add(cam, ...lights!.camera);
        world.transforms.setRotation(cam, ...lights!.cameraQuat);
      }
      ts.update(); bs.update(ts.updated); ex.extract(rw, W / H);
      return {
        frame: () => renderer.render(rw),
        idle: () => gpu.queue.onSubmittedWorkDone(),
        counts: () => ({ draws: renderer.stats.drawCalls, triangles: renderer.stats.triangles }),
        diagnostics: () => ({ ...renderer.stats.cpu, ...Object.fromEntries([...renderer.profiler.smoothed].map(([k,v]) => ['gpu_' + k, v])), drawPreparationReused: Number(renderer.stats.drawPreparationReused), retainedVertexDraws: renderer.stats.retainedVertexDraws, retainedLightingDraws: renderer.stats.retainedLightingDraws, retainedBundleDraws: renderer.stats.retainedBundleDraws, transformUploadBytes: renderer.stats.transformUploadBytes, bufferUploadBytes: renderer.stats.bufferUploadBytes }),
        adapter: () => describeAdapter(gpu.adapter),
        dispose: () => gpu.device.destroy(),
      };
    },
  };
}

// -------------------------------------------------------------------------------------------------------------- three

type ThreeStyle = 'mesh-default' | 'mesh-tuned' | 'instanced' | 'batched';

/** Three.js `WebGPURenderer` contender. `lighting` selects the default forward loop or the clustered addon (lights scenario). */
function three(scenario: string, param: number, label: string, style: ThreeStyle, lighting: 'forward' | 'clustered'): Contender {
  return {
    name: label,
    async create(canvas) {
      const renderer = new T.WebGPURenderer({ canvas, antialias: false });
      renderer.setPixelRatio(1); renderer.setSize(W, H, false);
      renderer.setClearColor(0x000000, 1);
      const tuned = style !== 'mesh-default';
      if (tuned) renderer.sortObjects = false;
      if (lighting === 'clustered') renderer.lighting = new ClusteredLighting(Math.max(64, param), 32, 24, param > 256 ? 256 : 64)   // per-cluster list capacity: 64 drops lights at 1024;
      await renderer.init();
      // nugie's outputColor(): clamp(Narkowicz ACES) then sRGB; Three.js' own ACESFilmic is a different curve, so replace it with the same fit
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.library.addToneMapping(((color: any, exposure: any) => {
        const x = color.mul(exposure);
        return clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0, 1);
      }) as never, T.CustomToneMapping);   // (existing entries cannot be redefined, so it goes under CustomToneMapping)
      renderer.toneMapping = new URLSearchParams(location.search).get('tm') === 'none' ? T.NoToneMapping : T.CustomToneMapping;   // `?tm=none` is a debug switch
      renderer.toneMappingExposure = 1;

      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(60, W / H, 0.1, scenario === 'objects' ? 1000 : 200);
      const finish = (o: T.Object3D) => { if (tuned) { o.frustumCulled = false; o.updateMatrix(); o.matrixAutoUpdate = false; } };
      const dummy = new T.Object3D();

      const sun = new T.DirectionalLight(0xffffff, sunIntensity(scenario));
      const sd = scenario === 'objects' ? SUN_OBJECTS : SUN_LIGHTS, sl = Math.hypot(...sd);
      sun.position.set(-sd[0] / sl * 50, -sd[1] / sl * 50, -sd[2] / sl * 50); // target stays at the origin: light travels along `sd`
      scene.add(sun);

      const phys = (c: V3) => new T.Color(c[0], c[1], c[2]);       // working space is linear sRGB: values are used as-is
      if (scenario === 'objects') {
        const L = objectLayout(param);
        const geos = [geometryOf(createCube()), geometryOf(createUVSphere(8, 6))];
        const mats = Array.from({ length: 8 }, (_, i) => { const p = materialParams(i); return new T.MeshStandardMaterial({ color: phys(p.color), roughness: p.roughness, metalness: 0 }); });
        if (style === 'mesh-default' || style === 'mesh-tuned') {
          for (const it of L.items) {
            const m = new T.Mesh(geos[it.mesh], mats[it.mat]);
            m.position.set(it.x, it.y, it.z); m.scale.setScalar(0.5); finish(m); scene.add(m);
          }
        } else if (style === 'instanced') {
          const groups = new Map<number, typeof L.items>();
          for (const it of L.items) { const k = it.mesh * 8 + it.mat; (groups.get(k) ?? groups.set(k, []).get(k)!).push(it); }
          for (const [k, list] of groups) {
            const im = new T.InstancedMesh(geos[Math.floor(k / 8)], mats[k % 8], list.length);
            list.forEach((it, i) => { dummy.position.set(it.x, it.y, it.z); dummy.scale.setScalar(0.5); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
            im.instanceMatrix.needsUpdate = true; finish(im); scene.add(im);
          }
        } else {
          // one BatchedMesh per material holding both geometries
          const perMat: (typeof L.items)[] = Array.from({ length: 8 }, () => []);
          for (const it of L.items) perMat[it.mat].push(it);
          const vtx = geos.reduce((s, g) => s + g.getAttribute('position').count, 0), idx = geos.reduce((s, g) => s + g.getIndex()!.count, 0);
          perMat.forEach((list, mi) => {
            if (!list.length) return;
            const bm = new T.BatchedMesh(list.length, vtx, idx, mats[mi]);
            bm.perObjectFrustumCulled = false; bm.sortObjects = false;
            const gid = geos.map((g) => bm.addGeometry(g));
            for (const it of list) {
              const id = bm.addInstance(gid[it.mesh]);
              dummy.position.set(it.x, it.y, it.z); dummy.scale.setScalar(0.5); dummy.updateMatrix(); bm.setMatrixAt(id, dummy.matrix);
            }
            finish(bm); scene.add(bm);
          });
        }
        camera.position.set(...L.camera);
      } else {
        const L = lightLayout(param);
        const mat = new T.MeshStandardMaterial({ color: phys([0.8, 0.8, 0.8]), roughness: 0.45, metalness: 0 });
        const floor = new T.Mesh(geometryOf(createPlane()), mat);
        floor.scale.set(70, 1, 70); finish(floor); scene.add(floor);
        const im = new T.InstancedMesh(geometryOf(createUVSphere(24, 12)), mat, L.spheres.length);
        L.spheres.forEach((s, i) => { dummy.position.set(s.x, 0.8, s.z); dummy.scale.setScalar(1); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
        im.instanceMatrix.needsUpdate = true; finish(im); scene.add(im);
        for (const l of L.points) {
          const pl = new T.PointLight(phys(l.c), 8, 5, 2);
          pl.position.set(l.x, l.y, l.z); finish(pl); scene.add(pl);
        }
        camera.position.set(...L.camera); camera.quaternion.set(...L.cameraQuat);
      }
      camera.updateMatrixWorld(true); scene.updateMatrixWorld(true);
      if (tuned) scene.matrixWorldAutoUpdate = false;
      await renderer.compileAsync(scene, camera);
      const device = (renderer.backend as unknown as { device: GPUDevice }).device;
      return {
        frame: () => { renderer.info.reset(); renderer.render(scene, camera); },
        idle: () => device.queue.onSubmittedWorkDone(),
        // `render.calls` counts render() invocations; the draw submissions are `drawCalls` (reset before every frame so one frame is counted)
        counts: () => ({ draws: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles }),
        adapter: () => describeInfo((device as unknown as { adapterInfo?: GPUAdapterInfo }).adapterInfo),
        dispose: () => renderer.dispose(),
      };
    },
  };
}

// -------------------------------------------------------------------------------------------------------------- hardware

/** One-line description of a GPUAdapterInfo (vendor / architecture / device / description). */
function describeInfo(i?: GPUAdapterInfo): string {
  if (!i) return 'unknown';
  return [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(' / ') || 'unknown (masked by the browser)';
}
/** One-line description of an adapter. */
function describeAdapter(a: GPUAdapter): string { return describeInfo(a.info); }

/** Everything worth recording about the machine and browser the numbers were measured on. */
async function collectHardware() {
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { brands: { brand: string; version: string }[]; platform: string } };
  const adapter = await navigator.gpu?.requestAdapter();
  const info = adapter?.info as (GPUAdapterInfo & Record<string, unknown>) | undefined;
  let webglRenderer = 'n/a';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) webglRenderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  } catch { /* unavailable */ }
  const lim = adapter?.limits as unknown as Record<string, number> | undefined;
  return {
    date: new Date().toISOString(),
    webgpu: info ? {
      vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description,
      subgroupMinSize: info.subgroupMinSize, subgroupMaxSize: info.subgroupMaxSize, isFallbackAdapter: info.isFallbackAdapter,
      features: adapter ? [...adapter.features].sort() : [],
      limits: lim ? Object.fromEntries(['maxTextureDimension2D', 'maxBufferSize', 'maxStorageBufferBindingSize', 'maxStorageBuffersPerShaderStage', 'maxComputeInvocationsPerWorkgroup'].map((k) => [k, lim[k]])) : {},
    } : null,
    webglUnmaskedRenderer: webglRenderer,
    browser: { userAgent: navigator.userAgent, brands: nav.userAgentData?.brands ?? [], platform: nav.userAgentData?.platform ?? navigator.platform },
    cpuThreads: navigator.hardwareConcurrency, deviceMemoryGB: nav.deviceMemory ?? null,
    screen: { width: screen.width, height: screen.height, devicePixelRatio: window.devicePixelRatio },
    threeRevision: T.REVISION,
  };
}

// -------------------------------------------------------------------------------------------------------------- measuring

/** Median / p95 / mean of a sample. */
function summarize(xs: number[]): Stats {
  const s = [...xs].sort((a, b) => a - b), q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { median: q(0.5), p95: q(0.95), mean: xs.reduce((a, b) => a + b, 0) / xs.length };
}

interface Sample { cpu: number[]; total: number[]; draws: number; triangles: number; adapter: string; pixels: Uint8ClampedArray; diagnostics?: Record<string, number>; }

/** Build one contender on a fresh canvas, warm it up, take a snapshot and measure `frames` frames. */
async function measureOnce(c: Contender, frames: number, thumbnail: boolean): Promise<Sample> {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  stage.appendChild(canvas);
  const scene = await c.create(canvas);
  try {
    for (let i = 0; i < 30; i++) scene.frame();           // warm-up: pipeline / shader compilation, first uploads
    await scene.idle();
    scene.frame();
    const snap = document.createElement('canvas'); snap.width = W; snap.height = H;
    const ctx = snap.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(canvas, 0, 0);                          // same task as the render: the swap-chain texture is still valid
    const pixels = ctx.getImageData(0, 0, W, H).data;
    const counts = scene.counts();
    ((window as unknown as { __snaps?: Record<string, Uint8ClampedArray> }).__snaps ??= {})[c.name] = pixels;   // for inspection from the console
    await scene.idle();
    const cpu: number[] = [], total: number[] = [];
    for (let f = 0; f < frames; f++) {
      const t0 = performance.now();
      scene.frame();
      const t1 = performance.now();
      await scene.idle();
      cpu.push(t1 - t0); total.push(performance.now() - t0);
    }
    if (thumbnail) { snap.title = c.name; snap.style.width = '240px'; snap.style.height = '135px'; stage.appendChild(snap); }
    return { cpu, total, ...counts, adapter: scene.adapter(), pixels, diagnostics: scene.diagnostics?.() };
  } finally {
    scene.dispose(); canvas.remove();
  }
}

/** Mean absolute error (0..255 per channel), share of pixels with any channel differing by more than 16, and mean luma of `b`. */
function compareImages(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let sum = 0, bad = 0, luma = 0, litA = 0, litB = 0, lit = 0;
  const n = a.length / 4;
  const bg = CLEAR.map((c) => Math.round(c * 255));
  for (let i = 0; i < a.length; i += 4) {
    let mx = 0;
    if (Math.abs(a[i] - bg[0]) + Math.abs(a[i + 1] - bg[1]) + Math.abs(a[i + 2] - bg[2]) > 6) {   // pixel covered by geometry in the reference
      lit++; litA += a[i] + a[i + 1] + a[i + 2]; litB += b[i] + b[i + 1] + b[i + 2];
    }
    for (let k = 0; k < 3; k++) { const d = Math.abs(a[i + k] - b[i + k]); sum += d; if (d > mx) mx = d; }
    if (mx > 16) bad++;
    luma += 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
  }
  return { mae: sum / (n * 3), diffPct: 100 * bad / n, luma: luma / n, litRatio: litA ? litB / litA : 1, litPct: 100 * lit / n };
}

/** Debug view (`?diff=1`): centre crop of |a - b| amplified 4x, drawn twice as large. */
function diffCanvas(name: string, a: Uint8ClampedArray, b: Uint8ClampedArray): HTMLCanvasElement {
  const cw = 320, ch = 180, x0 = (W - cw) / 2, y0 = (H - ch) / 2;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; c.title = name + ' diff x4';
  c.style.width = cw * 2 + 'px'; c.style.height = ch * 2 + 'px';
  const ctx = c.getContext('2d')!, img = ctx.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = ((y + y0) * W + x + x0) * 4, o = (y * cw + x) * 4;
    for (let k = 0; k < 3; k++) img.data[o + k] = Math.min(255, Math.abs(a[i + k] - b[i + k]) * 4);
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Contenders for a scenario / size, in report order (the first is the image reference). */
function contenders(scenario: string, param: number, full: boolean): Contender[] {
  if (scenario === 'objects') {
    return [
      nugie(scenario, param, 'nugie unsorted', 'unsorted', true),
      nugie(scenario, param, 'nugie instanced', 'instanced', true),
      ...(new URLSearchParams(location.search).get('ab') === '1' ? [nugie(scenario, param, 'nugie retained (general shader)', 'instanced', true, false)] : []),
      three(scenario, param, 'three Mesh (default)', 'mesh-default', 'forward'),
      three(scenario, param, 'three Mesh (tuned)', 'mesh-tuned', 'forward'),
      three(scenario, param, 'three InstancedMesh (tuned)', 'instanced', 'forward'),
      three(scenario, param, 'three BatchedMesh (tuned)', 'batched', 'forward'),
    ];
  }
  const skipForward = !full && param > 256;
  return [
    nugie(scenario, param, 'nugie clustered', 'instanced', true),
    nugie(scenario, param, 'nugie naive loop', 'instanced', false),
    three(scenario, param, 'three clustered (addon)', 'instanced', 'clustered'),
    ...(skipForward ? [] : [three(scenario, param, 'three forward (default)', 'instanced', 'forward')]),
  ];
}

/** Print the rows of one size as a table. */
function report(rows: Row[]): void {
  log('contender                      cpu med   cpu p95  total med  total p95  draws   triangles  imgMAE  diff>16  luma  lit/ref  covered');
  for (const r of rows) {
    if (r.skipped) { log(`${r.contender.padEnd(30)} skipped: ${r.skipped}`); continue; }
    const f = (n: number, w = 8) => n.toFixed(2).padStart(w);
    log(`${r.contender.padEnd(30)}${f(r.cpu!.median)} ${f(r.cpu!.p95)}  ${f(r.total!.median, 9)}  ${f(r.total!.p95, 9)}  ${String(r.draws).padStart(5)} ${String(r.triangles).padStart(11)}` +
      `  ${f(r.imageMAE!, 6)}  ${f(r.imageDiffPct!, 6)}%  ${f(r.meanLuma!, 5)}  ${r.litRatio!.toFixed(3).padStart(7)}  ${f(r.litPct!, 6)}%` +
      (r.imageMAE! > MATCH_MAE ? '   <- IMAGE MISMATCH, timings not comparable' : ''));
  }
}

(async () => {
  try {
    const q = new URLSearchParams(location.search);
    const scenario = q.get('scenario') ?? 'objects', frames = Number(q.get('frames') ?? 40), rounds = Number(q.get('rounds') ?? 3);
    const only = q.get('only') ?? '', full = q.get('full') === '1';
    const sizes = q.has('n') ? [Number(q.get('n'))] : scenario === 'objects' ? [1000, 10000] : [16, 64, 256, 1024];
    const hardware = await collectHardware();
    out.textContent = `nugie-renderer vs Three.js ${hardware.threeRevision} WebGPURenderer - ${scenario}, ${W}x${H}, ${rounds} rounds x ${frames} frames (total = render start -> GPU idle)\n` +
      `GPU:     ${hardware.webgpu ? describeInfo(hardware.webgpu as unknown as GPUAdapterInfo) : 'WebGPU unavailable'}\n` +
      `WebGL:   ${hardware.webglUnmaskedRenderer}\nBrowser: ${hardware.browser.brands.map((b) => b.brand + ' ' + b.version).join(', ') || hardware.browser.userAgent} on ${hardware.browser.platform}, ` +
      `${hardware.cpuThreads} threads, screen ${hardware.screen.width}x${hardware.screen.height} @${hardware.screen.devicePixelRatio}x`;
    const results: Row[] = [];
    const samples: unknown[] = [];
    for (const param of sizes) {
      log(`\n== ${scenario}: ${param} ${scenario === 'objects' ? 'objects' : 'point lights'} ==`);
      const list = contenders(scenario, param, full).filter((c, i) => only === 'optimized' ? c.name === 'nugie instanced' || c.name === 'nugie retained (general shader)' || c.name === 'three InstancedMesh (tuned)' : i === 0 || !only || c.name.toLowerCase().includes(only.toLowerCase()));   // the first contender is the image reference
      const acc = new Map<string, { cpu: number[]; total: number[]; s?: Sample; err?: string }>(list.map((c) => [c.name, { cpu: [], total: [] }]));
      for (let r = 0; r < rounds; r++) {
        if (q.get('interleave') === '1') {
          const samples = await measureInterleaved(list, frames, r === 0, r);
          for (const [name, sample] of samples) {
            const a = acc.get(name)!; a.cpu.push(...sample.cpu); a.total.push(...sample.total); a.s ??= sample;
          }
          continue;
        }
        for (let k = 0; k < list.length; k++) {
          const c = list[(k + r) % list.length], a = acc.get(c.name)!;
          if (a.err) continue;
          try {
            const s = await measureOnce(c, frames, r === 0);
            a.cpu.push(...s.cpu); a.total.push(...s.total); a.s ??= s;
          } catch (e) { a.err = String(e); }
        }
      }
      const rows: Row[] = [];
      let ref: Sample | undefined;
      for (const c of list) {
        const a = acc.get(c.name)!;
        const row: Row = { scenario, param, contender: c.name };
        if (a.err || !a.s) row.skipped = a.err ?? 'no samples';
        else {
          ref ??= a.s;
          const cmp = compareImages(ref.pixels, a.s.pixels);
          if (q.get('diff') === '1' && a.s !== ref) stage.appendChild(diffCanvas(c.name, ref.pixels, a.s.pixels));
          Object.assign(row, { adapter: a.s.adapter, cpu: summarize(a.cpu), total: summarize(a.total), draws: a.s.draws, triangles: a.s.triangles, imageMAE: cmp.mae, imageDiffPct: cmp.diffPct, meanLuma: cmp.luma, litRatio: cmp.litRatio, litPct: cmp.litPct });
        }
        rows.push(row);
      }
      if (scenario === 'lights' && !full && param > 256) log('(three forward loop omitted above 256 lights, add &full=1 to include it)');
      samples.push({ param, contenders: Object.fromEntries([...acc].map(([name, a]) => [name, { cpu: a.cpu, total: a.total, diagnostics: a.s?.diagnostics }])) });
      report(rows);
      log('adapters: ' + [...new Set(rows.map((r) => r.adapter).filter(Boolean))].join(' | '));
      results.push(...rows);
    }
    const payload = { hardware, samples, settings: { scenario, width: W, height: H, rounds, framesPerRound: frames, cacheDraws: q.get('cache') !== '0', pixelRatio: 1, msaa: false, culling: false, shadows: false, textures: false, gpuProfiling: q.get('profile') === '1', interleaved: q.get('interleave') === '1', ab: q.get('ab') === '1', retainedVertex: q.get('vertex') === '1', retainedLighting: q.get('lighting') !== '0', retainedBundles: q.get('bundles') !== '0' }, rows: results };
    (window as unknown as { __benchResults: unknown }).__benchResults = payload;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    a.download = `bench-three-${scenario}-${Date.now()}.json`; a.textContent = '\n[download results JSON]'; a.style.color = '#9cf'; a.style.display = 'block';
    out.after(a);
    document.title = 'DONE';
  } catch (e) {
    log('ERROR: ' + String(e) + '\n' + (e as Error).stack);
    document.title = 'FAILED';
  }
})();
