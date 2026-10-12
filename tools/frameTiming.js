// Dev tool: CPU time of `engine.frame` (update, culling, batching, command recording, submit) per demo scene, so two builds can be compared. Works in a hidden browser pane.
//   const { runTiming } = await import('/tools/frameTiming.js'); window.__timing = await runTiming();
export const SCENES = [
  'materials', 'lights', 'lights&post=1&bloom=1&ssao=1&prepass=1&fog=1', 'occlusion&gpucull=hiz2', 'particles', 'rtt', 'lod', 'shapes', 'gallery&post=1&ssao=1',
];

export async function runTiming(scenes = SCENES, { settleMs = 3500, runs = 10, frames = 200 } = {}) {
  const out = {};
  for (const scene of scenes) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:640px;height:360px;border:0';
    frame.src = '/?scene=' + scene;
    document.body.appendChild(frame);
    await new Promise((r) => setTimeout(r, settleMs));
    try {
      const ctx = frame.contentWindow.__r;
      for (let i = 0; i < 40; i++) ctx.frame(1 / 60, 1 + i / 60);
      const times = [];
      for (let k = 0; k < runs; k++) {
        const t0 = performance.now();
        for (let i = 0; i < frames; i++) ctx.frame(1 / 60, 2 + i / 60);
        times.push((performance.now() - t0) / frames);
        await new Promise((r) => setTimeout(r, 30));
      }
      times.sort((a, b) => a - b);
      out[scene] = { min: +times[0].toFixed(3), median: +times[runs >> 1].toFixed(3) };
    } catch (e) { out[scene] = { error: String(e) }; }
    frame.remove();
  }
  return out;
}
