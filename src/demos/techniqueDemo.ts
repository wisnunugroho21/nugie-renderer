import type { Demo } from './Demo';
import { technique, wgsl, bindings, sizeOf } from '../rendering/graph/TechniqueBuilder';
import { techniqueToDot } from '../rendering/graph/Dot';
import { createCube, createPlane, createUVSphere } from '../rendering/primitives';
import { entityIndex } from '../ecs/Entity';
import { RenderFlags } from '../ecs/components/MeshRendererStore';
import type { RenderFeature } from '../rendering/RenderFeature';

/** A separable box blur as a reusable technique: `image` in, `result` out, one `radius` variable. */
function blurPass() {
  const g = technique('blur-pass');
  const radius = g.int('radius', 4);
  const image = g.texture('image', { format: 'rgba8unorm', visibility: 'imported' });
  const mid = g.texture('mid', { format: 'rgba8unorm', like: image });
  const result = g.texture('result', { format: 'rgba8unorm', like: image, visibility: 'exported' });
  /** One direction of the blur; `axis` is the unit step. */
  const pass = (name: string, src: typeof image, dst: typeof image, axis: string) => g.compute(name, {
    reads: [src], writes: [dst], dispatch: { like: dst }, workgroupSize: [8, 8],
    shader: wgsl`${bindings}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = ${sizeOf(dst)};
  if (id.x >= size.x || id.y >= size.y) { return; }
  let r = ${radius};
  var sum = vec4<f32>(0.0);
  for (var i = -r; i <= r; i++) {
    let p = clamp(vec2<i32>(id.xy) + ${axis} * i, vec2<i32>(0), vec2<i32>(size.xy) - 1);
    sum += textureLoad(${src}, p, 0);
  }
  textureStore(${dst}, vec2<i32>(id.xy), sum / f32(2 * r + 1));
}`,
  });
  pass('horizontal', image, mid, 'vec2<i32>(1, 0)');
  pass('vertical', mid, result, 'vec2<i32>(0, 1)');
  return g;
}

/**
 * The demo's technique: a plasma generator feeding two blur passes. With the blur radius at 0 both blur sub-graphs are switched off by their
 * conditions and a copy takes their place, so the graph changes shape (it recompiles) without any code running differently.
 */
function plasmaTechnique() {
  const g = technique('plasma-blur');
  const time = g.float('time', 0, 'host');
  const size = g.uint('resolution', 256, 'host');
  const radius = g.int('radius', 3);
  const hue = g.float('hue', 0);
  const raw = g.texture('raw', { format: 'rgba8unorm', size: [size, size] });
  const soft = g.texture('soft', { format: 'rgba8unorm', like: raw });
  const out = g.texture('out', { format: 'rgba8unorm', like: raw, visibility: 'exported' });

  g.compute('plasma', {
    writes: [raw], dispatch: { like: raw }, workgroupSize: [8, 8],
    shader: wgsl`${bindings}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = ${sizeOf(raw)};
  if (id.x >= size.x || id.y >= size.y) { return; }
  let uv = (vec2<f32>(id.xy) + 0.5) / vec2<f32>(size.xy);
  let t = ${time};
  var v = sin(uv.x * 12.0 + t) + sin(uv.y * 9.0 + t * 1.3) + sin((uv.x + uv.y) * 10.0 + t * 0.7);
  v += sin(length(uv - 0.5) * 24.0 - t * 2.0);
  let c = 0.5 + 0.5 * cos(6.2831853 * (v * 0.25 + vec3<f32>(0.0, 0.33, 0.67) + ${hue}));
  textureStore(${raw}, vec2<i32>(id.xy), vec4<f32>(c * c, 1.0));
}`,
  });
  const blur = blurPass();
  g.subgraph('blur-a', blur, { inputs: { image: raw }, outputs: { result: soft }, variables: { radius }, when: radius.gt(0) });
  g.subgraph('blur-b', blur, { inputs: { image: soft }, outputs: { result: out }, variables: { radius: 2 }, when: radius.gt(0) });
  g.copy('passthrough', raw, out, { when: radius.eq(0) });
  return g;
}

/**
 * `?scene=technique`: the render graph's Technique Builder in use. A technique written in code (a plasma generator feeding two blur
 * sub-graphs) runs as a pass of the engine's frame graph (through a {@link RenderFeature}) and its exported texture is shown, unlit, on a
 * panel and a sphere. Keys: `[` / `]` blur radius (0 switches the blur off: the graph recompiles), `H` shifts the hue, `Space` pauses time,
 * `G` prints the graph as Graphviz DOT to the console. `window.__technique` exposes the instance and its compiled plan.
 */
export const techniqueDemo: Demo = (ctx) => {
  const { world, renderer, gpu, params } = ctx;
  const builder = plasmaTechnique();
  const fx = builder.instantiate(gpu, { label: 'plasma', values: { radius: Number(params.get('radius') ?? 3) } });

  // the technique runs as one pass of the frame graph; 'plasma' is the logical name the scene passes wait for
  const feature: RenderFeature = {
    name: 'technique-demo', produces: ['plasma'],
    addPasses: (graph) => fx.addTo(graph, { name: 'plasma-technique', writes: [graph.logical('plasma')] }),
  };
  renderer.addFeature(feature);

  const out = fx.resource('out') as GPUTexture;
  const texture = { id: 'technique:out', view: out.createView() };
  const screen = renderer.materials.createPBR({ name: 'plasma', shading: 'basic', baseColor: [1, 1, 1, 1], textures: { baseColor: texture }, sampler: { magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' } });
  const ground = renderer.materials.createPBR({ name: 'ground', baseColor: [0.2, 0.22, 0.26, 1], roughness: 0.95, metallic: 0 });
  const plane = renderer.meshes.create('plane', createPlane()), cube = renderer.meshes.create('cube', createCube()), sphere = renderer.meshes.create('sphere', createUVSphere(48, 24));
  const spawn = (mesh: number, material: number, x: number, y: number, sx: number, sy: number, sz: number, flags = 0) => {
    const e = entityIndex(world.create());
    world.transforms.add(e, x, y, 0); world.transforms.setScale(e, sx, sy, sz);
    world.meshRenderers.add(e, mesh, material, flags);
    world.bounds.add(e, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5);
  };
  const g = entityIndex(world.create());
  world.transforms.add(g, 0, -1.4, 0); world.transforms.setScale(g, 20, 1, 20);
  world.meshRenderers.add(g, plane, ground, RenderFlags.Static);
  world.bounds.add(g, -0.5, 0, -0.5, 0.5, 0, 0.5);
  spawn(cube, screen, -1.5, 0.2, 2.6, 2.6, 0.08);       // a panel facing the camera
  spawn(sphere, screen, 1.9, 0.2, 2.2, 2.2, 2.2);

  const overlay = document.createElement('pre');
  overlay.style.cssText = 'position:fixed;right:8px;bottom:8px;margin:0;color:#cfe;font:12px monospace;background:rgba(0,0,0,.6);padding:6px 8px;pointer-events:none';
  document.body.appendChild(overlay);

  let paused = false, clock = 0;
  const status = { fx, builder, plan: fx.plan, dot: '', radius: Number(fx.getVariable('radius')), hue: 0 };
  (window as unknown as { __technique: unknown }).__technique = status;
  const describe = () => {
    const p = fx.plan, s = p.stats;
    overlay.textContent = [
      'Technique Builder demo   [ ] blur radius   H hue   Space pause   G print DOT',
      `radius ${status.radius}${status.radius === 0 ? ' (blur sub-graphs off, copy on)' : ''}   hue ${status.hue.toFixed(2)}   compiles ${fx.compileCount}`,
      `order: ${p.steps.map((x) => x.node.path).join(' > ')}`,
      `${s.live}/${s.nodes} nodes live, ${p.slots.length} allocations for ${p.resources.size} resources, ${s.bytesAliased} of ${s.bytes} bytes after aliasing`,
    ].join('\n');
  };
  const set = (name: string, value: number) => { fx.setVariable(name, value); status.plan = fx.plan; describe(); };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'BracketRight') set('radius', status.radius = Math.min(12, status.radius + 1));
    else if (e.code === 'BracketLeft') set('radius', status.radius = Math.max(0, status.radius - 1));
    else if (e.code === 'KeyH') set('hue', status.hue = (status.hue + 0.1) % 1);
    else if (e.code === 'Space') { paused = !paused; e.preventDefault(); }
    else if (e.code === 'KeyG') { status.dot = techniqueToDot(fx.plan); console.log(status.dot); }
  });
  if (params.get('paused') === '1') paused = true;
  describe();

  ctx.orbit.distance = 8; ctx.orbit.pitch = 0.1; ctx.orbit.autoRotate = 0;
  return (_t, dt) => {
    if (!paused) clock += dt;
    fx.setVariable('time', clock);
    if (status.plan !== fx.plan) { status.plan = fx.plan; describe(); }
  };
};
