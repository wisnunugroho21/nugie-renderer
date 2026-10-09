import type { MaterialManager } from './MaterialManager';
import type { TextureRef } from './Material';

/**
 * Screen-space "projective" texture: the surface shows the render target at its own screen position. With a mirror view (the
 * main camera reflected in the surface's plane, `RenderViewOptions.mirror`) that is a perfect planar reflection; with any other view
 * it is a window onto another place. The target should have the canvas aspect ratio (`createRenderTarget({ scale: 1 })`).
 */
const MIRROR_WGSL = /* wgsl */ `
struct MirrorOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) @interpolate(flat) mat: u32,
};

@vertex
fn vs_main(in: VertexInput) -> MirrorOut {
  var out: MirrorOut;
  let model = getModelMatrix(in.instance);
  out.clip = frame.viewProjection * model * vec4<f32>(in.position, 1.0);
  out.mat = instances[in.instance].materialIndex;
  return out;
}

@fragment
fn fs_main(in: MirrorOut) -> @location(0) vec4<f32> {
  let m = materials[in.mat];
  let uv = in.clip.xy / frame.viewport.xy;
  let c = textureSampleLevel(texBaseColor, materialSampler, uv, 0.0).rgb;
  let tint = param_tint(m.paramBase).rgb;
  return vec4<f32>(outputColor(c * tint * param_strength(m.paramBase)), 1.0);
}
`;

export interface MirrorMaterialOptions {
  /** Multiplies the reflection (default white): a slight tint makes a mirror look like glass or polished metal. */
  tint?: readonly [number, number, number];
  /** Brightness multiplier (default 1). */
  strength?: number;
  name?: string;
}

/** Create the material that shows `target` at screen position (see {@link MIRROR_WGSL}). Returns the material id. */
export function createMirrorMaterial(materials: MaterialManager, target: TextureRef, o: MirrorMaterialOptions = {}): number {
  const t = o.tint ?? [1, 1, 1];
  return materials.createCustom({
    name: o.name ?? 'mirror', wgsl: MIRROR_WGSL,
    params: [{ name: 'tint', type: 'vec4' }, { name: 'strength', type: 'f32' }],
    values: { tint: [t[0], t[1], t[2], 1], strength: o.strength ?? 1 },
    textures: { 0: target },
    sampler: { magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' },
  });
}
