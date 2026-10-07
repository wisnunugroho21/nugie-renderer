import { parseGLTF, GLTFError, type GLTFDocument, type ResourceResolver } from './GLTFParser';
import { loadMeshes } from './GLTFMeshLoader';
import { loadMaterials } from './GLTFMaterialLoader';
import { TextureUseRegistry, loadImages } from './GLTFTextureLoader';
import { loadSkins } from './GLTFSkinLoader';
import { loadAnimations } from './GLTFAnimationLoader';
import type { CameraAsset, GLTFAsset, NodeAsset } from '../AssetTypes';

/** Decompose a column-major TRS matrix into translation / rotation (xyzw) / scale. */
export function decomposeMatrix(m: ArrayLike<number>): { t: [number, number, number]; r: [number, number, number, number]; s: [number, number, number] } {
  let sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
  // negative determinant => flip one axis
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  if (det < 0) sx = -sx;
  const r00 = m[0] / sx, r10 = m[1] / sx, r20 = m[2] / sx;
  const r01 = m[4] / sy, r11 = m[5] / sy, r21 = m[6] / sy;
  const r02 = m[8] / sz, r12 = m[9] / sz, r22 = m[10] / sz;
  const trace = r00 + r11 + r22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s; x = (r21 - r12) / s; y = (r02 - r20) / s; z = (r10 - r01) / s;
  } else if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1 + r00 - r11 - r22) * 2;
    w = (r21 - r12) / s; x = 0.25 * s; y = (r01 + r10) / s; z = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = Math.sqrt(1 + r11 - r00 - r22) * 2;
    w = (r02 - r20) / s; x = (r01 + r10) / s; y = 0.25 * s; z = (r12 + r21) / s;
  } else {
    const s = Math.sqrt(1 + r22 - r00 - r11) * 2;
    w = (r10 - r01) / s; x = (r02 + r20) / s; y = (r12 + r21) / s; z = 0.25 * s;
  }
  const l = Math.hypot(x, y, z, w) || 1;
  return { t: [m[12], m[13], m[14]], r: [x / l, y / l, z / l, w / l], s: [sx, sy, sz] };
}

/**
 * glTF -> engine assets (CPU side). Never renders from glTF JSON: everything is converted to
 * AssetTypes structures. GPU upload / ECS instantiation are separate steps (GLTFInstantiator).
 */
export async function loadGLTF(data: ArrayBuffer | Uint8Array | string, resolver?: ResourceResolver): Promise<GLTFAsset> {
  const doc = await parseGLTF(data, resolver);
  return convertDocument(doc);
}

export function convertDocument(doc: GLTFDocument): GLTFAsset {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const json = doc.json;

  const registry = new TextureUseRegistry(doc, warn);
  const materials = loadMaterials(doc, registry, warn);
  const meshes = loadMeshes(doc, warn);
  const images = loadImages(doc);
  const skins = loadSkins(doc);

  const nodes: NodeAsset[] = (json.nodes ?? []).map((n, i) => {
    let t: [number, number, number] = (n.translation as [number, number, number]) ?? [0, 0, 0];
    let r: [number, number, number, number] = (n.rotation as [number, number, number, number]) ?? [0, 0, 0, 1];
    let s: [number, number, number] = (n.scale as [number, number, number]) ?? [1, 1, 1];
    if (n.matrix) {
      if (n.matrix.length !== 16) throw new GLTFError(`node ${i}: matrix must have 16 elements`);
      ({ t, r, s } = decomposeMatrix(n.matrix));
    }
    return {
      name: n.name ?? `node${i}`, parent: -1, children: (n.children ?? []).slice(), translation: [...t], rotation: [...r], scale: [...s],
      mesh: n.mesh ?? -1, skin: n.skin ?? -1, camera: n.camera ?? -1, weights: n.weights ? Float32Array.from(n.weights) : null,
    };
  });
  nodes.forEach((n, i) => {
    for (const c of n.children) {
      if (!nodes[c]) throw new GLTFError(`node ${i} references missing child ${c}`);
      if (nodes[c].parent !== -1) throw new GLTFError(`node ${c} has more than one parent`);
      nodes[c].parent = i;
    }
  });
  assertAcyclic(nodes);

  const cameras: CameraAsset[] = (json.cameras ?? []).map((c, i) => ({
    name: c.name ?? `camera${i}`, type: c.type,
    yfov: c.perspective?.yfov ?? 0, znear: c.perspective?.znear ?? c.orthographic?.znear ?? 0.1,
    zfar: c.perspective?.zfar ?? c.orthographic?.zfar ?? 1000, aspectRatio: c.perspective?.aspectRatio ?? 0,
    xmag: c.orthographic?.xmag ?? 0, ymag: c.orthographic?.ymag ?? 0,
  }));

  // morph target count per node = from its mesh's first primitive
  const morphCount = (node: number): number => {
    const mi = nodes[node]?.mesh ?? -1;
    return mi >= 0 ? meshes[mi]?.primitives[0]?.morphTargets?.length ?? 0 : 0;
  };
  const animations = loadAnimations(doc, morphCount, warn);

  const scenes = (json.scenes ?? [{ nodes: nodes.filter((n) => n.parent === -1).map((n) => nodes.indexOf(n)) }]).map((s, i) => ({
    name: (s as { name?: string }).name ?? `scene${i}`, nodes: (s.nodes ?? []).slice(),
  }));

  return { scenes, defaultScene: json.scene ?? 0, nodes, meshes, materials, textures: registry.uses, images, cameras, skins, animations, warnings };
}

function assertAcyclic(nodes: NodeAsset[]): void {
  const state = new Uint8Array(nodes.length); // 0 unvisited, 1 visiting, 2 done
  for (let i = 0; i < nodes.length; i++) {
    if (state[i] === 2) continue;
    const stack: [number, number][] = [[i, 0]];
    state[i] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const n = nodes[top[0]];
      if (top[1] < n.children.length) {
        const c = n.children[top[1]++];
        if (state[c] === 1) throw new GLTFError('Node hierarchy contains a cycle');
        if (state[c] === 0) { state[c] = 1; stack.push([c, 0]); }
      } else { state[top[0]] = 2; stack.pop(); }
    }
  }
}

