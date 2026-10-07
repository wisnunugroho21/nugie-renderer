import { Engine } from './app/Engine';
import { OrbitController } from './app/OrbitController';
import { formatHud } from './app/Hud';
import { applyEnvironmentSettings, applyRenderSettings } from './app/urlSettings';
import { DEMOS, DEFAULT_DEMO } from './demos';
import type { DemoContext } from './demos/Demo';

/** Demo launcher: builds the engine, runs the demo chosen by `?scene=`, and shows the debug HUD. */
async function main(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  let engine: Engine;
  try {
    engine = await Engine.create(canvas);
  } catch (e) {
    hud.textContent = String(e);
    return;
  }

  const params = new URLSearchParams(location.search);
  applyRenderSettings(engine, params);

  const orbit = new OrbitController(canvas);
  const ctx: DemoContext = Object.assign(engine, { orbit, params });
  const demoName = params.get('scene') && params.get('scene')! in DEMOS ? params.get('scene')! : DEFAULT_DEMO;
  const updateDemo = DEMOS[demoName](ctx);

  await applyEnvironmentSettings(engine, params);
  (window as unknown as { __r: unknown }).__r = ctx;   // dev handle for the browser console / automated checks

  engine.onFrameEnd = () => { hud.textContent = formatHud(engine, demoName); };
  engine.start((time, dt) => {
    updateDemo?.(time, dt);
    orbit.update(engine.world, engine.camera, dt);
  });
}
main();
