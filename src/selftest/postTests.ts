import type { GPUContext } from '../gpu/GPUContext';
import { PostProcessor, type PostSettingsInput } from '../rendering/post/PostProcessor';
import { FrameGraph } from '../rendering/graph/FrameGraph';
import { DEPTH_FORMAT } from '../rendering/formats';
import { Mat4 } from '../math/Mat4';
import { readTextureRGBA8, type SelfTest } from './harness';
import golden from './postGolden.json';

const W = 96, H = 64;

/** Synthetic inputs for the post chain: an HDR image with bright blobs, an aux image (view normal / roughness / metallic) and a depth buffer with a sky band. */
const SYNTH = /* wgsl */ `
struct V { @builtin(position) p: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> V {
  let q = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  return V(vec4<f32>(q * 2.0 - 1.0, 0.0, 1.0), vec2<f32>(q.x, 1.0 - q.y));
}
@fragment fn fs_scene(in: V) -> @location(0) vec4<f32> {
  let c = vec3<f32>(0.1 + 0.8 * in.uv.x, 0.2 + 0.5 * in.uv.y, 0.4);
  let a = smoothstep(0.12, 0.0, distance(in.uv, vec2<f32>(0.7, 0.3)));
  let b = smoothstep(0.08, 0.0, distance(in.uv, vec2<f32>(0.25, 0.7)));
  return vec4<f32>(c * (1.0 + 6.0 * a + 3.0 * b), 1.0);
}
@fragment fn fs_aux(in: V) -> @location(0) vec4<f32> {
  let n = normalize(vec3<f32>(0.5 * sin(in.uv.x * 9.0), 0.5 * cos(in.uv.y * 7.0), 1.0));
  let oct = n.xy / (abs(n.x) + abs(n.y) + abs(n.z));
  return vec4<f32>(oct * 0.5 + vec2<f32>(0.5), 0.3, 0.9);
}
@fragment fn fs_depth(in: V) -> @builtin(frag_depth) f32 {
  if (in.uv.y < 0.12) { return 1.0; }
  return 0.97 + 0.01 * (0.5 + 0.5 * sin(in.uv.x * 9.0) * cos(in.uv.y * 7.0));
}
`;

const PROJ = Mat4.perspective(Mat4.create(), Math.PI / 3, W / H, 0.1, 100);

interface Case { name: string; samples: 1 | 4; settings: PostSettingsInput; }

const CASES: Case[] = [
  { name: 'everything', samples: 1, settings: {
    fxaa: true, vignette: 0.3, saturation: 1.2, contrast: 1.1, exposure: 1.3,
    bloom: { enabled: true, threshold: 1, intensity: 0.6, levels: 6 }, ssao: { enabled: true, radius: 0.8, intensity: 1 }, ssr: { enabled: true, intensity: 0.8 },
  } },
  { name: 'bloom-neutral', samples: 1, settings: { toneMapper: 'neutral', bloom: { enabled: true, threshold: 0.8, knee: 0.3, intensity: 0.4, radius: 1.5, levels: 3 } } },
  { name: 'ssao-ssr-msaa-depth', samples: 4, settings: { toneMapper: 'reinhard', ssao: { enabled: true, samples: 8 }, ssr: { enabled: true, steps: 32 } } },
  { name: 'fxaa-grade', samples: 1, settings: { fxaa: true, toneMapper: 'none', contrast: 1.4, saturation: 0.6 } },
];

const b64 = (bytes: Uint8Array): string => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Run the post chain over the synthetic inputs and read the final image back (in the swap chain's format). */
async function runCase(gpu: GPUContext, c: Case): Promise<Uint8Array> {
  const { device } = gpu;
  const post = new PostProcessor(gpu);
  post.configure(c.settings);
  post.ensureTargets(W, H, c.samples);
  const out = device.createTexture({ label: 'post-test-out', size: [W, H], format: gpu.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  post.outputTexture = out;
  const depth = device.createTexture({ label: 'post-test-depth', size: [W, H], format: DEPTH_FORMAT, sampleCount: c.samples, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const module = device.createShaderModule({ code: SYNTH });
  const pipe = (entry: string, format: GPUTextureFormat | null, samples: number): GPURenderPipeline => device.createRenderPipeline({
    layout: 'auto', vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: entry, targets: format ? [{ format }] : [] },
    ...(format ? {} : { depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'always' as const } }),
    multisample: { count: samples },
  });
  const enc = device.createCommandEncoder();
  const draw = (desc: GPURenderPassDescriptor, p: GPURenderPipeline) => { const pass = enc.beginRenderPass(desc); pass.setPipeline(p); pass.draw(3); pass.end(); };
  draw({ colorAttachments: [{ view: post.sceneView, loadOp: 'clear', storeOp: 'store' }] }, pipe('fs_scene', 'rgba16float', 1));
  if (post.needsAux) draw({ colorAttachments: [post.auxColorAttachment()] }, pipe('fs_aux', 'rgba16float', c.samples));
  draw({ colorAttachments: [], depthStencilAttachment: { view: depth.createView({ aspect: 'depth-only' }), depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'store' } }, pipe('fs_depth', null, c.samples));
  device.queue.submit([enc.finish()]);
  const frame = new FrameGraph(gpu), g = frame.begin();
  g.callback('main', { writes: ['sceneColor'], keep: true, execute: () => {} });
  if (post.needsAux) g.callback('aux', { reads: ['sceneColor'], writes: ['auxTex'], execute: () => {} });
  post.addChainPasses(g, { projection: PROJ, depthView: depth.createView({ aspect: 'depth-only' }), depthTexture: depth, depthSamples: c.samples });
  const enc2 = device.createCommandEncoder();
  frame.run(g, enc2);
  device.queue.submit([enc2.finish()]);
  const pixels = await readTextureRGBA8(device, out, 0, W, H);
  out.destroy(); depth.destroy();
  return pixels;
}

/** Average 4x4 pixel blocks (a compact fingerprint of the image that survives checking into the repository). */
function blocks(pixels: Uint8Array): Uint8Array {
  const bw = W / 4, bh = H / 4, out = new Uint8Array(bw * bh * 4);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) for (let ch = 0; ch < 4; ch++) {
    let sum = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) sum += pixels[((by * 4 + y) * W + bx * 4 + x) * 4 + ch];
    out[(by * bw + bx) * 4 + ch] = Math.round(sum / 16);
  }
  return out;
}

const maxDiff = (a: Uint8Array, b: Uint8Array): number => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

/**
 * The post chain (view depth, SSAO, SSR, bloom, composite, FXAA) rendered over synthetic inputs and compared with golden images recorded from the
 * hand-written implementation, so moving the chain onto the technique render graph is checked against it: a block-averaged golden is checked in
 * (`postGolden.json`), and the first run in a browser also keeps the exact image in localStorage for a strict pixel comparison on later runs.
 */
export function postTests(gpu: GPUContext): SelfTest[] {
  const recorded = ((window as unknown as { __postGolden?: Record<string, string> }).__postGolden ??= {});
  return CASES.map((c) => ({
    name: `post chain: ${c.name} matches the golden image`,
    run: async () => {
      const pixels = await runCase(gpu, c);
      recorded[c.name] = b64(blocks(pixels));
      let lit = 0;
      for (let i = 0; i < pixels.length; i++) if (pixels[i] > 8 && i % 4 !== 3) lit++;
      if (lit < W * H) throw new Error(`the image is nearly black (${lit} lit channels); the inputs were not rendered`);
      const key = `postExact:${c.name}`;
      let note = '';
      try {
        const exact = localStorage.getItem(key);
        if (exact) {
          const max = maxDiff(pixels, unb64(exact));
          if (max > 1) throw new Error(`exact comparison with the first recorded run: max difference ${max} levels`);
          note = `, exact max difference ${max}`;
        } else localStorage.setItem(key, b64(pixels));
      } catch (e) { if ((e as Error).message.startsWith('exact')) throw e; }
      const expected = (golden as Record<string, string>)[c.name];
      if (!expected) throw new Error('no golden image recorded (window.__postGolden has the current output)');
      const coarse = maxDiff(blocks(pixels), unb64(expected));
      if (coarse > 2) throw new Error(`block-averaged image differs from the golden by up to ${coarse} levels`);
      note = `coarse max difference ${coarse}` + note;
      return `${W}x${H}, ${note}`;
    },
  }));
}
