import type { Engine } from './Engine';
import type { BatchingMode } from '../rendering/Renderer';
import type { ToneMapper } from '../rendering/post/PostProcessor';
import type { CullMode } from '../visibility/VisibilitySystem';

/**
 * Renderer options that can be switched from the page URL while developing:
 *  post-processing: `msaa=4`, `fxaa=1`, `bloom=<intensity>`, `tonemap=none|reinhard|aces|neutral`, `exposure=<x>`, `vignette=<0..1>`, `post=1` (HDR chain only);
 *  `mode=unsorted|sorted|instanced`, `cluster=0`, `prepass=1`, `gpulod=1`, `gpucull=off|frustum|hiz|hiz2`, `cull=none|linear|bvh`.
 * Applied synchronously; call before the first frame.
 */
export function applyRenderSettings(engine: Engine, params: URLSearchParams): void {
  const r = engine.renderer;
  r.batching = (params.get('mode') as BatchingMode) ?? 'instanced';
  r.clusteredShading = params.get('cluster') !== '0';
  r.depthPrepass = params.get('prepass') === '1';
  r.gpuLOD = params.get('gpulod') === '1';
  r.gpuCulling = (params.get('gpucull') as typeof r.gpuCulling) ?? 'off';
  engine.visibility.mode = (params.get('cull') as CullMode) ?? 'bvh';
  applyPostSettings(engine, params);
}

/** Post-processing options from the URL (see {@link applyRenderSettings}); does nothing when none are present. */
export function applyPostSettings(engine: Engine, params: URLSearchParams): void {
  const num = (k: string): number | undefined => (params.has(k) ? Number(params.get(k)) : undefined);
  const msaa = num('msaa') === 4 ? 4 : undefined;
  const fxaa = params.get('fxaa') === '1';
  const bloom = num('bloom');
  const tonemap = params.get('tonemap') as ToneMapper | null;
  const exposure = num('exposure'), vignette = num('vignette');
  const chain = fxaa || bloom !== undefined || tonemap !== null || exposure !== undefined || vignette !== undefined || params.get('post') === '1';
  if (!chain && msaa === undefined) return;
  engine.renderer.post.configure({
    enabled: chain,
    ...(msaa ? { msaa } : {}),
    fxaa,
    ...(bloom !== undefined ? { bloom: { enabled: bloom > 0, intensity: bloom } } : {}),
    ...(tonemap ? { toneMapper: tonemap } : {}),
    ...(exposure !== undefined ? { exposure } : {}),
    ...(vignette !== undefined ? { vignette } : {}),
  });
}

/**
 * Environment options from the URL: `env=sky` (procedural sky) or `hdr=<url>` (Radiance .hdr), `envI=<intensity>`,
 * `sky=0` (hide the skybox), `fog=<density>` (volumetric fog), `warmup=1` (pre-compile pipelines; result in `window.__warm`).
 * Async because it may fetch an HDR file and wait for pipeline compilation.
 */
export async function applyEnvironmentSettings(engine: Engine, params: URLSearchParams): Promise<void> {
  const { renderer, gpu } = engine;
  const intensity = Number(params.get('envI') ?? 1);
  const hdr = params.get('hdr');
  if (hdr) {
    const buf = await (await fetch(hdr)).arrayBuffer();
    renderer.setEnvironment(renderer.ibl.fromHDR(buf), intensity);
  } else if (params.get('env') === 'sky') {
    renderer.setEnvironment(renderer.ibl.fromSky(), intensity);
  }
  renderer.showSkybox = params.get('sky') !== '0';
  if (params.get('fog')) renderer.enableFog({ density: Number(params.get('fog')) });
  if (params.get('warmup') === '1') {
    const t0 = performance.now();
    const pipelines = await renderer.warmup();
    (window as unknown as { __warm: unknown }).__warm = { pipelines, ms: performance.now() - t0, creationsAfterWarmup: gpu.resources.stats.pipelineCreations };
  }
}
