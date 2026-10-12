// Dev tool: renders demo scenes frame by frame (`engine.frame`, so it also works in a hidden browser pane) and reports, per scene, the executed pass order
// and a hash of the final image. Run the same battery on two builds and compare the results. Load it from any page of the dev server:
//   const { runBattery } = await import('/tools/frameBattery.js'); window.__battery = await runBattery();
export const SCENES = [
  'materials', 'materials&post=1&ssao=1&bloom=1&ssr=1', 'lights', 'lights&pointshadow=1', 'occlusion&gpucull=hiz2', 'occlusion&gpucull=frustum', 'particles', 'rtt',
  'feature', 'technique', 'gallery', 'gallery&post=1&ssao=1', 'lod', 'shapes', 'materials&prepass=1', 'materials&msaa=4&post=1', 'lights&post=1&bloom=1&ssao=1&prepass=1',
  'lights&cluster=0', 'occlusion&gpucull=hiz2&prepass=1', 'gallery&msaa=4', 'streaming', 'lights&fog=1',
];

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };

/** The executed pass names of the renderer's last frame, on either the old (`graph`) or the new (`frame`) pass graph. */
function passOrder(renderer) {
  if (renderer.graph) return renderer.graph.order.slice();
  const plan = renderer.frame.last.plan;
  return plan.steps.map((s) => s.node.path);
}

export async function runBattery(scenes = SCENES, { settleMs = 2500, frames = 6 } = {}) {
  const out = {};
  for (const scene of scenes) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:640px;height:360px;border:0';
    frame.src = '/?scene=' + scene;
    document.body.appendChild(frame);
    await new Promise((r) => setTimeout(r, settleMs));
    const ctx = frame.contentWindow.__r;
    try {
      let image = '', thumb = [];
      for (let i = 0; i < frames; i++) {
        ctx.frame(1 / 60, 1 + i / 60);
        if (i === frames - 1) {
          const canvas = frame.contentDocument.querySelector('canvas');
          image = canvas.toDataURL();
          // a 32x18 thumbnail, for scenes whose exact pixels vary from run to run (asynchronous loads, random sparkles): compare those by distance
          const small = document.createElement('canvas'); small.width = 32; small.height = 18;
          const c2 = small.getContext('2d'); c2.drawImage(canvas, 0, 0, 32, 18);
          thumb = Array.from(c2.getImageData(0, 0, 32, 18).data).filter((_, k) => k % 4 !== 3);
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      out[scene] = { passes: passOrder(ctx.renderer).join(','), image: hash(image), bytes: image.length, size: `${frame.contentDocument.querySelector('canvas').width}x${frame.contentDocument.querySelector('canvas').height}`, thumb: thumb.join(',') };
    } catch (e) { out[scene] = { error: String(e) }; }
    frame.remove();
  }
  return out;
}
