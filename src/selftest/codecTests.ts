import type { GPUContext } from '../gpu/GPUContext';
import { BasisFormat, BasisTranscoder } from '../assets/codecs/BasisTranscoder';
import { createKTX2Texture } from '../assets/codecs/Ktx2Texture';
import { loadGLTF } from '../assets/gltf/GLTFLoader';
import { STANDARD_VERTEX_FLOATS as STRIDE } from '../rendering/VertexLayouts';
import { readTextureRGBA8, type SelfTest } from './harness';

const SHOW_WGSL = /* wgsl */ `
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var<uniform> level: vec4<u32>;
@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  return vec4<f32>(p, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  return textureLoad(tex, vec2<i32>(p.xy), i32(level.x));
}`;

/** The device features that decide each transcode target, in the order they are tried here. */
const TARGETS: { name: string; features: string[]; needs: string; format: RegExp }[] = [
  { name: 'ASTC', features: ['texture-compression-astc'], needs: 'texture-compression-astc', format: /^astc-4x4/ },
  { name: 'BC7', features: ['texture-compression-bc'], needs: 'texture-compression-bc', format: /^bc7/ },
  { name: 'ETC2', features: ['texture-compression-etc2'], needs: 'texture-compression-etc2', format: /^etc2/ },
  { name: 'RGBA8', features: [], needs: '', format: /^rgba8/ },
];

/** Fetch a fixture from the dev server (`/tests/fixtures`). */
async function fixture(name: string): Promise<Uint8Array> {
  const response = await fetch(`/tests/fixtures/${name}`);
  if (!response.ok) throw new Error(`Cannot load fixture ${name}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Draw mip `level` of `texture` (sampled with `textureLoad`, so no filtering) into an RGBA8 target and read it back. */
async function showLevel(gpu: GPUContext, texture: GPUTexture, level: number): Promise<Uint8Array> {
  const { device } = gpu;
  const width = Math.max(1, texture.width >> level), height = Math.max(1, texture.height >> level);
  const module = gpu.resources.shaders.get('ktx2-test-show', SHOW_WGSL);
  const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniform, 0, new Uint32Array([level, 0, 0, 0]));
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView() }, { binding: 1, resource: { buffer: uniform } }] });
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
  device.queue.submit([enc.finish()]);
  const pixels = await readTextureRGBA8(device, target, 0, width, height);
  target.destroy(); uniform.destroy();
  return pixels;
}

/** Mean absolute difference per channel value between two RGBA8 images. */
function meanError(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** GPU tests for KTX2 / Basis textures and compressed glTF files. */
export function codecTests(gpu: GPUContext): SelfTest[] {
  const tests: SelfTest[] = [];
  for (const file of ['pattern-uastc.ktx2', 'pattern-etc1s.ktx2']) {
    for (const target of TARGETS) {
      tests.push({
        name: `ktx2: ${file} -> ${target.name} samples like the RGBA8 transcode (mips 0, 2, 4, 6)`,
        run: async () => {
          if (target.needs && !gpu.device.features.has(target.needs as GPUFeatureName)) return `skipped: this device has no ${target.needs}`;
          const bytes = await fixture(file);
          const made = await createKTX2Texture(gpu, file, bytes, false, { features: new Set(target.features) });
          // ETC1S cannot be transcoded to ASTC: on an ASTC-only device it falls back to RGBA8
          const expected = file.includes('etc1s') && target.name === 'ASTC' ? /^rgba8/ : target.format;
          if (!expected.test(made.format)) throw new Error(`chose ${made.format}, expected ${target.name}`);
          const image = (await BasisTranscoder.load()).open(bytes);
          const report: string[] = [];
          try {
            for (const level of [0, 2, 4, 6]) {
              const shown = await showLevel(gpu, made.texture, level);
              const { width, height } = image.levelSize(level);
              if (shown.length !== width * height * 4) throw new Error(`level ${level}: ${shown.length} bytes, expected ${width * height * 4}`);
              const reference = image.transcode(level, BasisFormat.RGBA32);
              const error = meanError(shown, reference);
              // UASTC -> ASTC / BC7 is near lossless; UASTC -> ETC2 re-encodes the blocks (the checker pattern's hard edges show at small mips)
              const limit = file.includes('uastc') ? (target.name === 'ETC2' ? 25 : 4) : 12;
              if (error > limit) throw new Error(`level ${level} (${width}x${height}): mean error ${error.toFixed(2)} > ${limit}`);
              report.push(error.toFixed(2));
            }
          } finally { image.close(); gpu.resources.textures.destroy(made.texture); }
          return `${made.format}, mean error per level ${report.join(' / ')}`;
        },
      });
    }
  }
  for (const [file, label] of [['sphere-draco-uastc.glb', 'Draco'], ['sphere-meshopt-etc1s.glb', 'meshopt']] as const) {
    tests.push({
      name: `gltf: ${label}-compressed sphere with a KTX2 texture loads in the browser`,
      run: async () => {
        const asset = await loadGLTF(await fixture(file));
        const prim = asset.meshes[0].primitives[0];
        if (asset.warnings.length) throw new Error(`warnings: ${asset.warnings.join('; ')}`);
        let radius = 0;
        const v = prim.mesh.vertices;
        for (let i = 0; i < v.length; i += STRIDE) radius = Math.max(radius, Math.hypot(v[i], v[i + 1], v[i + 2]));
        if (Math.abs(radius - 0.5) > 0.01) throw new Error(`sphere radius ${radius}, expected 0.5`);
        if (asset.images[0].mimeType !== 'image/ktx2' || asset.textures.length !== 1) throw new Error('texture not resolved to the KTX2 image');
        return `${v.length / STRIDE} vertices, ${prim.mesh.indices.length / 3} triangles, radius ${radius.toFixed(3)}`;
      },
    });
  }
  return tests;
}
