import type { Demo } from './Demo';
import { entityIndex } from '../ecs/Entity';
import { Quat } from '../math/Quat';
import { createCube, createPlane, createUVSphere } from '../rendering/primitives';
import { RenderFlags } from '../ecs/components/MeshRendererStore';

const PULSE_WGSL = /* wgsl */ `
struct PulseOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) @interpolate(flat) mat: u32,
};

@vertex
fn vs_main(in: VertexInput) -> PulseOut {
  var out: PulseOut;
  let m = materials[instances[in.instance].materialIndex];
  let model = getModelMatrix(in.instance);
  let wobble = 1.0 + 0.15 * sin(frame.cameraPosition.w * param_speed(m.paramBase) + in.position.y * 6.0);
  out.clip = frame.viewProjection * model * vec4<f32>(in.position * wobble, 1.0);
  out.normal = normalMatrix(model) * in.normal;
  out.mat = instances[in.instance].materialIndex;
  return out;
}

@fragment
fn fs_main(in: PulseOut) -> @location(0) vec4<f32> {
  let m = materials[in.mat];
  let n = normalize(in.normal);
  let rim = pow(1.0 - abs(n.z), 2.0);
  let c = param_tint(m.paramBase).rgb * (0.4 + rim * 2.0);
  return vec4<f32>(outputColor(c), 1.0);
}
`;

/** PBR metallic/roughness grid, HDR emissive lamp, blended glass and a custom WGSL material. */
export const materialsDemo: Demo = (ctx) => {
  const { world, renderer, params } = ctx;
  const mats = renderer.materials;
  const cubeMesh = renderer.meshes.create('cube', createCube());
  const sphereMesh = renderer.meshes.create('sphere', createUVSphere(48, 24));
  const planeMesh = renderer.meshes.create('plane', createPlane());
  const ground = mats.createPBR({ name: 'ground', baseColor: [0.35, 0.37, 0.4, 1], roughness: 0.9, metallic: 0 });
  const emissiveMat = mats.createPBR({ name: 'lamp', baseColor: [0.05, 0.05, 0.05, 1], emissive: [1, 0.5, 0.15], emissiveStrength: 8, roughness: 0.4 });
  const glass = mats.createPBR({ name: 'glass', baseColor: [0.3, 0.7, 1, 0.35], alphaMode: 'BLEND', roughness: 0.1, metallic: 0 });
  const pulse = mats.createCustom({
    name: 'pulse', wgsl: PULSE_WGSL, params: [{ name: 'speed', type: 'f32' }, { name: 'tint', type: 'vec4' }],
    values: { speed: 3, tint: [0.2, 1, 0.6, 1] },
  });

  /** Add an object (mesh + material at a position, uniform or per-axis scale, optionally static) with unit-cube bounds; returns its entity index. */
  const spawn = (mesh: number, mat: number, x: number, y: number, z: number, s: number | [number, number, number], isStatic = false) => {
    const i = entityIndex(world.create());
    world.transforms.add(i, x, y, z);
    const sc = typeof s === 'number' ? [s, s, s] : s;
    world.transforms.setScale(i, sc[0], sc[1], sc[2]);
    world.meshRenderers.add(i, mesh, mat, isStatic ? RenderFlags.Static : RenderFlags.CastShadow);
    world.bounds.add(i, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5);
    return i;
  };
  spawn(planeMesh, ground, 0, -0.6, 0, [30, 1, 30], true);
  const N = 7;
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      const m = mats.createPBR({ baseColor: [0.95, 0.64, 0.54, 1], metallic: a / (N - 1), roughness: Math.max(0.05, b / (N - 1)) });
      spawn(sphereMesh, m, (a - (N - 1) / 2) * 1.2, 0.2, (b - (N - 1) / 2) * 1.2, 1, true);
    }
  }
  const lamp = spawn(sphereMesh, emissiveMat, 0, 2.2, 0, 0.5);
  const pulseObj = spawn(sphereMesh, pulse, -5.5, 1.2, 0, 1.4);
  const glassObjs = [spawn(cubeMesh, glass, 4.5, 0.6, -2, 1.5), spawn(cubeMesh, glass, 5.2, 0.4, -1.2, 1.2)];

  // Optional stress field of static instanced cubes (?n=20000) placed far from the sphere grid.
  const stress = Number(params.get('n') ?? 0);
  const stressMat = mats.createPBR({ baseColor: [0.6, 0.8, 0.5, 1], roughness: 0.5, metallic: 0.1 });
  const side = Math.ceil(Math.sqrt(stress));
  for (let i = 0; i < stress; i++) {
    spawn(cubeMesh, stressMat, (i % side - side / 2) * 0.9 + 40, 0.2, Math.floor(i / side) * 0.9 - side / 2 * 0.9, 0.5, true);
  }

  ctx.orbit.distance = 13; ctx.orbit.pitch = 0.45; ctx.orbit.autoRotate = 0.15;
  const q = Quat.create();
  // Per-frame update: spin the custom-material sphere and the glass cubes, move the lamp in a circle.
  return (t) => {
    Quat.fromAxisAngle(q, 0, 1, 0, t * 0.7);
    world.transforms.setRotation(pulseObj, q[0], q[1], q[2], q[3]);
    world.transforms.setPosition(lamp, Math.sin(t) * 3, 2.2, Math.cos(t) * 3);
    for (const g of glassObjs) { Quat.fromAxisAngle(q, 0.3, 1, 0, t * 0.4); world.transforms.setRotation(g, q[0], q[1], q[2], q[3]); }
  };
};
