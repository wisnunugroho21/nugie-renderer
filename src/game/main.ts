/**
 * Starter game: move a cube around a floor with WASD / arrow keys under a shadow-casting sun.
 * Open /game.html (`npm run dev`). Copy this folder as the starting point of your own game; every API used here is
 * explained in docs/MAKING_A_GAME.md.
 */
import { Engine, LightType, RenderFlags, Quat, createCube, createPlane } from '../index';

/** Keys currently held down (by `KeyboardEvent.code`). */
const keys = new Set<string>();
window.addEventListener('keydown', (e) => keys.add(e.code));
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

/** -1, 0 or +1 from a pair of opposing keys (e.g. left / right). */
function axis(negative: string[], positive: string[]): number {
  const down = (codes: string[]) => codes.some((c) => keys.has(c));
  return (down(positive) ? 1 : 0) - (down(negative) ? 1 : 0);
}

/** Build the scene and start the game loop. */
async function main(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const engine = await Engine.create(canvas);
  const { renderer, world } = engine;

  // --- assets: create meshes and materials once, up front
  const cubeMesh = renderer.meshes.create('cube', createCube());
  const planeMesh = renderer.meshes.create('plane', createPlane());
  const floorMat = renderer.materials.createPBR({ name: 'floor', baseColor: [0.35, 0.4, 0.45, 1], roughness: 0.9, metallic: 0 });
  const playerMat = renderer.materials.createPBR({ name: 'player', baseColor: [0.9, 0.35, 0.2, 1], roughness: 0.4, metallic: 0 });

  // --- entities
  engine.spawnObject({
    mesh: planeMesh, material: floorMat, scale: [40, 1, 40],
    flags: RenderFlags.Static | RenderFlags.ReceiveShadow,   // bounds default to the mesh's own
  });
  const player = engine.spawnObject({ mesh: cubeMesh, material: playerMat, position: [0, 0.5, 0] });
  engine.spawnLight({ type: LightType.Directional, rotation: [-0.5, 0.2, 0.1, 0.84], color: [1, 0.95, 0.85], intensity: 3, castShadow: true });

  // --- look: sky lighting, then compile all pipelines now rather than during play
  renderer.setEnvironment(renderer.ibl.fromSky(), 0.8);
  await renderer.warmup();

  // --- camera: a fixed downward tilt; the position follows the player each frame
  const tilt = Quat.fromAxisAngle(Quat.create(), 1, 0, 0, -0.5);
  world.transforms.setRotation(engine.camera, tilt[0], tilt[1], tilt[2], tilt[3]);

  // --- picking: click an object to see what the ray hit (engine.pick = screen ray + raycast)
  canvas.addEventListener('pointerdown', (e) => {
    const hit = engine.pick(e.clientX, e.clientY);
    document.getElementById('msg')!.textContent = hit
      ? `hit entity ${hit.entity} at ${hit.distance.toFixed(2)} m, point (${hit.point.map((v) => v.toFixed(1)).join(', ')})`
      : 'nothing under the pointer';
  });

  const pos = { x: 0, z: 0 };
  const SPEED = 6;   // metres per second

  // --- game loop: gameplay writes to the world; the engine does everything else
  engine.start((_time, dt) => {
    pos.x += axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) * SPEED * dt;
    pos.z += axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']) * SPEED * dt;
    world.transforms.setPosition(player, pos.x, 0.5, pos.z);
    world.transforms.setPosition(engine.camera, pos.x, 7, pos.z + 11);
  });
}

main().catch((e) => {
  document.getElementById('msg')!.textContent = String(e);   // e.g. "WebGPU is not supported in this browser."
});
