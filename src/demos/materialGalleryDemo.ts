import type { Demo, DemoContext } from './Demo';
import { createUVSphere, createCube, createPlane, type MeshData } from '../rendering/primitives';
import { createPlaneGrid, createIcosahedron, createTorusKnot } from '../rendering/shapes';
import type { TextureRef, PBRMaterialDesc } from '../rendering/materials/Material';
import { LightType } from '../ecs/components/LightStore';
import { RenderFlags } from '../ecs/components/MeshRendererStore';

const SIZE = 256;

/** Draw into a SIZE x SIZE canvas. */
function canvas(draw: (g: CanvasRenderingContext2D, w: number) => void): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = SIZE;
  draw(c.getContext('2d')!, SIZE);
  return c;
}

/** Brick wall height map: bricks high, mortar low, a little noise. */
function heightCanvas(): HTMLCanvasElement {
  return canvas((g, w) => {
    g.fillStyle = '#202020'; g.fillRect(0, 0, w, w);
    const rows = 8, cols = 4, bh = w / rows, bw = w / cols;
    for (let r = 0; r < rows; r++) {
      for (let c = -1; c < cols; c++) {
        const x = c * bw + (r % 2 ? bw / 2 : 0) + 4, y = r * bh + 4, v = 150 + Math.floor(Math.random() * 90);
        g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, bw - 8, bh - 8);
      }
    }
  });
}

/** Tangent-space normal map computed from a height canvas (Sobel). */
function normalFromHeight(src: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = src.width, d = src.getContext('2d')!.getImageData(0, 0, w, w).data;
  const h = (x: number, y: number) => d[(((y + w) % w) * w + ((x + w) % w)) * 4] / 255;
  return canvas((g) => {
    const out = g.createImageData(w, w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength;   // +y of the image is "down" = decreasing glTF v
        const l = Math.hypot(dx, dy, 1), o = (y * w + x) * 4;
        out.data[o] = (-dx / l * 0.5 + 0.5) * 255; out.data[o + 1] = (dy / l * 0.5 + 0.5) * 255; out.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[o + 3] = 255;
      }
    }
    g.putImageData(out, 0, 0);
  });
}

function colorBricks(): HTMLCanvasElement {
  const hc = heightCanvas();
  return canvas((g, w) => {
    g.drawImage(hc, 0, 0);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = '#c0553a'; g.fillRect(0, 0, w, w);
    g.globalCompositeOperation = 'source-over';
  });
}

/** Alpha map: a grid of round holes (G channel carries the alpha). */
function alphaCanvas(): HTMLCanvasElement {
  return canvas((g, w) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, w);
    g.fillStyle = '#0f0';
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.beginPath(); g.arc((x + 0.5) * w / 4, (y + 0.5) * w / 4, w / 10, 0, Math.PI * 2); g.fill(); }
  });
}

/** A shiny matcap sphere image. */
function matcapCanvas(): HTMLCanvasElement {
  return canvas((g, w) => {
    const grad = g.createRadialGradient(w * 0.38, w * 0.34, w * 0.02, w / 2, w / 2, w / 2);
    grad.addColorStop(0, '#fff6e0'); grad.addColorStop(0.25, '#e9a35b'); grad.addColorStop(0.7, '#5a2a14'); grad.addColorStop(1, '#1b0d08');
    g.fillStyle = grad; g.fillRect(0, 0, w, w);
  });
}

/** A 3-tone toon ramp (left dark, right lit). */
function rampCanvas(): HTMLCanvasElement {
  return canvas((g, w) => {
    const tones = [0.15, 0.15, 0.55, 0.55, 1, 1, 1, 1];
    tones.forEach((t, i) => { const v = Math.round(t * 255); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(i * w / 8, 0, w / 8 + 1, w); });
  });
}

/** Stripes of clearcoat (R) over the surface: the packed factors map (R clearcoat, G roughness, B transmission, A thickness). */
function packedCanvas(): HTMLCanvasElement {
  return canvas((g, w) => {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? 'rgb(255,30,0)' : 'rgb(0,30,0)'; g.fillRect(0, i * w / 8, w, w / 8); }
  });
}

async function tex(ctx: DemoContext, id: string, c: HTMLCanvasElement, srgb: boolean): Promise<TextureRef> {
  const bmp = await createImageBitmap(c, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  return ctx.textures.upload(id, bmp, srgb);
}

/**
 * Material showcase: shading models (basic, Lambert, Phong, toon, matcap), surface detail (bump, parallax, displacement, alpha map),
 * a per-material environment, and the physical extensions (clearcoat, sheen, transmission with volume, dispersion, iridescence,
 * anisotropy, specular / IOR). Add `&env=sky` for image-based lighting. Each ball is labelled.
 */
export const materialGalleryDemo: Demo = (ctx) => {
  const { renderer, params } = ctx;
  const mats = renderer.materials;
  ctx.spawnLight({ type: LightType.Directional, rotation: [-0.5, 0.35, 0.1, 0.78], intensity: 3, color: [1, 0.96, 0.9], castShadow: true });
  ctx.spawnLight({ type: LightType.Point, position: [-6, 6, 6], intensity: 60, range: 30, color: [1, 0.9, 0.8] });
  ctx.spawnObject({ mesh: renderer.meshes.create('floor', createPlane()), material: mats.createPBR({ name: 'floor', baseColor: [0.3, 0.32, 0.35, 1], roughness: 0.9, metallic: 0 }), position: [0, -0.02, 0], scale: [60, 1, 60], flags: RenderFlags.Static | RenderFlags.ReceiveShadow });

  const sphere = renderer.meshes.create('ball', createUVSphere(96, 48));
  const rich = renderer.meshes.create('ball-hi', createUVSphere(192, 96));
  const grid = renderer.meshes.create('grid', createPlaneGrid(160, 160));
  const gem = renderer.meshes.create('gem', createIcosahedron(0.5, 0));
  const knot = renderer.meshes.create('knot', createTorusKnot({ radius: 0.32, tube: 0.1 }));
  const cube = renderer.meshes.create('cube', createCube());
  const unit = (m: MeshData) => m;
  void unit;

  const items: { name: string; row: number; col: number; mesh: number; desc: PBRMaterialDesc; scale?: number; tilt?: boolean; pad?: number }[] = [];
  const labels: { name: string; x: number; z: number }[] = [];

  const build = async (): Promise<void> => {
    const hc = heightCanvas();
    const height = await tex(ctx, 'g-height', hc, false);
    const normal = await tex(ctx, 'g-normal', normalFromHeight(hc, 3.0), false);
    const color = await tex(ctx, 'g-bricks', colorBricks(), true);
    const alpha = await tex(ctx, 'g-alpha', alphaCanvas(), false);
    const matcap = await tex(ctx, 'g-matcap', matcapCanvas(), true);
    const ramp = await tex(ctx, 'g-ramp', rampCanvas(), false);
    const packed = await tex(ctx, 'g-packed', packedCanvas(), false);
    const sunset = renderer.ibl.fromSky({ zenith: [0.25, 0.12, 0.35], horizon: [1.6, 0.55, 0.2], ground: [0.12, 0.06, 0.05], sunDirection: [0.2, 0.15, 0.9], sunColor: [40, 20, 8], sunAngularRadius: 0.05 }, 128);
    const clay: [number, number, number, number] = [0.8, 0.45, 0.3, 1];

    // row 0: shading models
    items.push({ name: 'basic', row: 0, col: 0, mesh: sphere, desc: { shading: 'basic', baseColor: clay } });
    items.push({ name: 'lambert', row: 0, col: 1, mesh: sphere, desc: { shading: 'lambert', baseColor: clay } });
    items.push({ name: 'phong', row: 0, col: 2, mesh: sphere, desc: { shading: 'phong', baseColor: clay, shininess: 60, specular: [0.9, 0.9, 0.9] } });
    items.push({ name: 'toon', row: 0, col: 3, mesh: sphere, desc: { shading: 'toon', baseColor: clay, toonSteps: 3 } });
    items.push({ name: 'toon ramp', row: 0, col: 4, mesh: sphere, desc: { shading: 'toon', baseColor: clay, textures: { aux: ramp } } });
    items.push({ name: 'matcap', row: 0, col: 5, mesh: sphere, desc: { shading: 'matcap', baseColor: [1, 1, 1, 1], textures: { aux: matcap } } });
    items.push({ name: 'pbr', row: 0, col: 6, mesh: sphere, desc: { baseColor: clay, roughness: 0.4, metallic: 0 } });
    items.push({ name: 'own env', row: 0, col: 7, mesh: sphere, desc: { baseColor: [0.95, 0.95, 0.97, 1], metallic: 1, roughness: 0.05, environment: sunset } });

    // row 1: surface detail (flat tiles lie on the floor, the bump / normal balls are spheres)
    items.push({ name: 'normal map', row: 1, col: 0, mesh: sphere, desc: { baseColor: [1, 1, 1, 1], roughness: 0.7, metallic: 0, textures: { baseColor: color, normal } } });
    items.push({ name: 'bump', row: 1, col: 1, mesh: sphere, desc: { baseColor: [1, 1, 1, 1], roughness: 0.7, metallic: 0, bumpScale: 0.06, textures: { baseColor: color, height } } });
    items.push({ name: 'parallax', row: 1, col: 2, mesh: cube, desc: { baseColor: [1, 1, 1, 1], roughness: 0.7, metallic: 0, parallaxScale: 0.06, textures: { baseColor: color, height, normal } } });
    items.push({ name: 'displace', row: 1, col: 3, mesh: grid, desc: { baseColor: [0.75, 0.55, 0.4, 1], roughness: 0.8, metallic: 0, displacementScale: 0.35, bumpScale: 0.03, textures: { baseColor: color, height } }, scale: 2, tilt: false, pad: 0.4 });
    items.push({ name: 'alpha map', row: 1, col: 4, mesh: cube, desc: { baseColor: [0.3, 0.8, 0.5, 1], roughness: 0.4, metallic: 0, doubleSided: true, textures: { alpha } } });
    items.push({ name: 'height ball', row: 1, col: 5, mesh: rich, desc: { baseColor: [0.75, 0.55, 0.4, 1], roughness: 0.8, metallic: 0, displacementScale: 0.12, textures: { height } } });
    items.push({ name: 'packed coat', row: 1, col: 6, mesh: sphere, desc: { baseColor: [0.15, 0.4, 0.9, 1], metallic: 0.2, roughness: 0.6, clearcoat: 1, clearcoatRoughness: 0.03, textures: { aux: packed } } });

    // row 2: physical extensions
    items.push({ name: 'clearcoat', row: 2, col: 0, mesh: sphere, desc: { baseColor: [0.8, 0.05, 0.05, 1], metallic: 0.6, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.03 } });
    items.push({ name: 'sheen', row: 2, col: 1, mesh: sphere, desc: { baseColor: [0.35, 0.05, 0.1, 1], metallic: 0, roughness: 0.9, sheenColor: [1, 0.55, 0.65], sheenRoughness: 0.35 } });
    items.push({ name: 'glass', row: 2, col: 2, mesh: sphere, desc: { baseColor: [1, 1, 1, 1], metallic: 0, roughness: 0.02, transmission: 1, thickness: 0.8, ior: 1.5 } });
    items.push({ name: 'tinted volume', row: 2, col: 3, mesh: sphere, desc: { baseColor: [1, 1, 1, 1], metallic: 0, roughness: 0.05, transmission: 1, thickness: 1.5, attenuationColor: [0.1, 0.7, 0.3], attenuationDistance: 1.2, ior: 1.45 } });
    items.push({ name: 'dispersion', row: 2, col: 4, mesh: gem, desc: { baseColor: [1, 1, 1, 1], metallic: 0, roughness: 0.0, transmission: 1, thickness: 0.5, ior: 2.4, dispersion: 20 }, scale: 1.7 });
    items.push({ name: 'iridescence', row: 2, col: 5, mesh: sphere, desc: { baseColor: [0.05, 0.05, 0.06, 1], metallic: 0.9, roughness: 0.15, iridescence: 1, iridescenceIor: 1.8, iridescenceThickness: [250, 520] } });
    items.push({ name: 'anisotropy', row: 2, col: 6, mesh: knot, desc: { baseColor: [0.85, 0.85, 0.9, 1], metallic: 1, roughness: 0.35, anisotropy: 0.85, anisotropyRotation: 0.0 }, scale: 1.8 });
    items.push({ name: 'ior / specular', row: 2, col: 7, mesh: sphere, desc: { baseColor: [0.15, 0.4, 0.2, 1], metallic: 0, roughness: 0.15, ior: 2.2, specularIntensity: 1, specularColor: [1, 0.9, 0.7] } });

    const spacing = 2.6, x0 = -3.5 * spacing;
    for (const it of items) {
      const x = x0 + it.col * spacing, z = (it.row - 1) * -3.2;
      const s = it.scale ?? 1.8;
      const m = mats.createPBR({ name: it.name, ...it.desc });
      const flat = it.mesh === grid;
      const e = ctx.spawnObject({ mesh: it.mesh, material: m, position: [x, flat ? 0.4 : 1.1, z], scale: flat ? [2.2, 1, 2.2] : s, name: it.name });
      if (flat) ctx.world.bounds.padding[e] = it.pad ?? 0.4;
      labels.push({ name: it.name, x, z: z + 1.9 });
    }
    try {
      const font = await ctx.createFont({ family: 'sans-serif', weight: 'bold', size: 64 });
      const ts = ctx.createTextSystem(font);
      for (const l of labels) ts.addText(font, l.name, { position: [l.x, 0.05, l.z], size: 0.42, mode: 'fixed', right: [1, 0, 0], up: [0, 0, -1], color: [1, 1, 1, 0.9], anchor: [0.5, 0.5] });
    } catch { /* no canvas text: skip the labels */ }
  };
  void build();

  ctx.orbit.distance = Number(params.get('dist') ?? 22); ctx.orbit.pitch = 0.5; ctx.orbit.yaw = 0.0; ctx.orbit.autoRotate = 0; ctx.orbit.target[1] = 0.8;
};
