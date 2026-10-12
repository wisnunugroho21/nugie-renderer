import { technique, type BindingRef, type TextureHandle } from '../graph/TechniqueBuilder';
import type { Technique } from '../graph/TechniqueTypes';
import { DEPTH_FORMAT } from '../formats';
import type { PostSettings } from './PostProcessor';

/** Format of the scene target while the post chain is on (linear HDR). */
export const HDR_FORMAT: GPUTextureFormat = 'rgba16float';
/** Format of the aux target (view-space normal, roughness, metallic) used by SSAO / SSR. */
export const AUX_FORMAT: GPUTextureFormat = 'rgba16float';
const DEPTH_LINEAR_FORMAT: GPUTextureFormat = 'r32float';
const AO_FORMAT: GPUTextureFormat = 'r8unorm';

/**
 * The post-processing chain as a technique (see TECHNIQUES.md): linear view depth, SSAO (sample + two blurs), SSR, the bloom mip chain,
 * the composite (exposure, bloom, SSAO / SSR, tone mapping, grading, sRGB) and FXAA, each a full-screen draw node. The scene colour, aux
 * target, depth buffer and swap chain are imported; everything else is transient and owned (and memory-aliased) by the technique.
 *
 * The shader sources are the engine's `post*.wgsl`: they address the node's textures as `texA` .. `texD` and its parameters as `P.a` .. `P.f`.
 * Each node gets the bindings it names (unused names point at a 1 x 1 dummy texture), and `P.a` .. `P.d` become the node's own float4 variables.
 */
export interface PostChainShape {
  width: number;
  height: number;
  /** Format of the swap chain (the composite / FXAA target). */
  swapFormat: GPUTextureFormat;
  /** Samples per pixel of the main depth buffer. */
  depthSamples: number;
  /** The aux target exists: the view-depth pass runs. */
  aux: boolean;
  ssao: boolean;
  ssr: boolean;
  fxaa: boolean;
  /** Sizes of the bloom mip chain, level 0 first; empty = no bloom. */
  bloom: [number, number][];
}

/** WGSL for the chain (the sources are assembled: `//#include` lines are resolved by `assemble`). */
export interface PostChainSources { assemble: (source: string) => string; post: string; depth: string; ssao: string; ssr: string; }

export interface PostChainPlan {
  technique: Technique;
  /** Variable names the plan declares (values for other names are ignored). */
  variables: Set<string>;
}

type Slot = 'texA' | 'texB' | 'texC' | 'texD';
const variableName = (node: string, letter: string): string => `${node.replace(/-/g, '_')}_${letter}`;
const token = (name: string): string => `/*$(Variable:${name})*/`;

/** Describe the chain for a frame of this shape. */
export function buildPostChain(shape: PostChainShape, src: PostChainSources): PostChainPlan {
  const g = technique('post-chain');
  const { width: w, height: h } = shape;
  const size = [w, h];
  const scene = g.texture('scene', { format: HDR_FORMAT, size, visibility: 'imported' });
  const dummy = g.texture('dummy', { format: HDR_FORMAT, size: [1, 1], visibility: 'imported' });
  const backbuffer = g.texture('backbuffer', { format: shape.swapFormat, size, visibility: 'imported' });
  const aux = shape.aux ? g.texture('aux', { format: AUX_FORMAT, size, visibility: 'imported' }) : null;
  const depth = shape.aux ? g.texture('depth', { format: DEPTH_FORMAT, size, samples: shape.depthSamples === 4 ? 4 : 1, visibility: 'imported' }) : null;
  const variables = new Set<string>(['camE', 'camF']);
  g.float4('camE'); g.float4('camF');

  /** One full-screen draw: `code` is the shader (with `P.x` for the node's parameters), `reads` names what texA .. texD are. */
  const fullscreen = (name: string, code: string, entry: string, reads: Partial<Record<Slot, TextureHandle>>, target: TextureHandle,
    o: { load?: boolean; additive?: boolean; defaults?: Partial<Record<'a' | 'b' | 'c' | 'd', number[]>> } = {}): void => {
    const used = new Set<string>();
    const body = code.replace(/\bP\.([a-f])\b/g, (_m, l: string) => {
      if (l === 'e') return token('camE');
      if (l === 'f') return token('camF');
      used.add(l);
      return token(variableName(name, l));
    });
    for (const l of used) { const v = variableName(name, l); variables.add(v); g.float4(v, o.defaults?.[l as 'a'] ?? [0, 0, 0, 0]); }
    const list: BindingRef[] = (['texA', 'texB', 'texC', 'texD'] as Slot[]).map((slot) => ({ resource: reads[slot] ?? dummy, name: slot, ...(slot === 'texA' ? { sampler: 'linear' as const } : {}) }));
    g.draw(name, {
      shader: body, vertexEntry: 'vs_full', fragmentEntry: entry, reads: list, vertices: 3,
      colorTargets: [{ resource: target, loadOp: o.load ? 'load' : 'clear', clearValue: [0, 0, 0, 1], blend: o.additive ? 'additive' : 'none' }],
    });
  };

  const post = src.assemble(src.post);
  const target = (name: string, format: GPUTextureFormat, tw = w, th = h) => g.texture(name, { format, size: [tw, th] });
  const depthView = shape.aux ? target('viewDepth', DEPTH_LINEAR_FORMAT) : null;

  if (depthView && depth) {
    variables.add('depthQ'); g.float4('depthQ');
    g.draw('post-depth', {
      shader: src.assemble(src.depth), vertexEntry: 'vs_full', fragmentEntry: 'fs_depth', vertices: 3,
      reads: [{ resource: depth, name: 'depthTex' }],
      colorTargets: [{ resource: depthView, loadOp: 'clear', clearValue: [0, 0, 0, 1] }],
    });
  }

  let ao: [TextureHandle, TextureHandle] | null = null;
  if (shape.ssao && aux && depthView) {
    const ssao = src.assemble(src.ssao);
    ao = [target('ao0', AO_FORMAT), target('ao1', AO_FORMAT)];
    fullscreen('post-ssao', ssao, 'fs_ssao', { texA: aux, texD: depthView }, ao[0]);
    fullscreen('post-ssao-blur-h', ssao, 'fs_blur', { texA: ao[0], texD: depthView }, ao[1], { defaults: { a: [1, 0, 20, 0] } });
    fullscreen('post-ssao-blur-v', ssao, 'fs_blur', { texA: ao[1], texD: depthView }, ao[0], { defaults: { a: [0, 1, 20, 0] } });
  }

  let ssrTarget: TextureHandle | null = null;
  if (shape.ssr && aux && depthView) {
    ssrTarget = target('ssr', HDR_FORMAT);
    fullscreen('post-ssr', src.assemble(src.ssr), 'fs_ssr', { texA: scene, texB: aux, texD: depthView }, ssrTarget);
  }

  const levels = shape.bloom.map(([lw, lh], i) => target(`bloom${i}`, HDR_FORMAT, lw, lh));
  if (levels.length) {
    fullscreen('bloom-prefilter', post, 'fs_prefilter', { texA: scene }, levels[0]);
    for (let i = 1; i < levels.length; i++) {
      const [pw, ph] = shape.bloom[i - 1];
      fullscreen(`bloom-down-${i}`, post, 'fs_down', { texA: levels[i - 1] }, levels[i], { defaults: { a: [1 / pw, 1 / ph, 0, 0] } });
    }
    for (let i = levels.length - 1; i >= 1; i--) fullscreen(`bloom-up-${i}`, post, 'fs_up', { texA: levels[i] }, levels[i - 1], { load: true, additive: true });
  }

  const ldr = shape.fxaa ? target('ldr', shape.swapFormat) : null;
  fullscreen('post-composite', post, 'fs_composite', { texA: scene, ...(levels.length ? { texB: levels[0] } : {}), ...(ssrTarget ? { texC: ssrTarget } : {}), ...(ao ? { texD: ao[0] } : {}) }, ldr ?? backbuffer);
  if (ldr) fullscreen('post-fxaa', post, 'fs_fxaa', { texA: ldr }, backbuffer, { defaults: { a: [1 / w, 1 / h, 0, 0] } });

  return { technique: g.build(), variables };
}

/** Per-frame inputs for the chain's variables. */
export interface PostChainFrame {
  /** Camera projection matrix (column-major). */
  projection: ArrayLike<number>;
  toneMapperId: number;
}

/** Values of the variables the chain's nodes read this frame (bloom levels, SSAO, SSR, composite and the shared camera terms). */
export function postChainValues(shape: PostChainShape, s: PostSettings, f: PostChainFrame): Record<string, number[]> {
  const proj = f.projection, near = proj[14] / proj[10], far = proj[14] / (1 + proj[10]);
  const v: Record<string, number[]> = {
    camE: [proj[0], proj[5], proj[10], proj[14]], camF: [1 / shape.width, 1 / shape.height, shape.width, shape.height], depthQ: [proj[10], proj[14], 0, 0],
  };
  const bloomOn = shape.bloom.length > 0;
  if (shape.ssao) { const a = s.ssao; v.post_ssao_a = [a.radius, a.bias, a.intensity, a.power]; v.post_ssao_b = [a.samples, 0, far, 0]; }
  if (shape.ssr) {
    const r = s.ssr;
    v.post_ssr_a = [r.maxDistance, r.thickness, r.stride, r.steps]; v.post_ssr_b = [r.intensity, r.maxRoughness, 0, far]; v.post_ssr_c = [near, 0, 0, 0];
  }
  if (bloomOn) {
    const b = s.bloom;
    v.bloom_prefilter_a = [1 / shape.width, 1 / shape.height, b.threshold, Math.max(b.knee, 1e-4)];
    for (let i = 1; i < shape.bloom.length; i++) v[`bloom_up_${i}_a`] = [b.radius / shape.bloom[i][0], b.radius / shape.bloom[i][1], 0, 0];
  }
  v.post_composite_b = [s.exposure, s.bloom.intensity, s.vignette, s.saturation];
  v.post_composite_c = [s.contrast, f.toneMapperId, bloomOn ? 1 : 0, 1 / 255];
  v.post_composite_d = [shape.width / shape.height, shape.ssao ? 1 : 0, shape.ssr ? 1 : 0, 0];
  return v;
}
