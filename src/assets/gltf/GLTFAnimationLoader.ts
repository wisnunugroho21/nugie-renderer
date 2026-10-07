import type { GLTFDocument } from './GLTFParser';
import { GLTFError } from './GLTFParser';
import { readAccessorFloat } from './Accessors';
import type { AnimationChannelData, AnimationClipData } from '../AssetTypes';

const STRIDE = { translation: 3, rotation: 4, scale: 3 } as const;

/** Parse animations into raw channel data (sampling lives in the animation runtime, Phase 16). */
export function loadAnimations(doc: GLTFDocument, nodeMorphTargetCount: (node: number) => number, warn: (m: string) => void): AnimationClipData[] {
  return (doc.json.animations ?? []).map((a, ai) => {
    const name = a.name ?? `animation${ai}`;
    const channels: AnimationChannelData[] = [];
    let duration = 0;
    a.channels.forEach((ch, ci) => {
      const node = ch.target.node;
      if (node === undefined) return; // extension-targeted channel
      const sampler = a.samplers[ch.sampler];
      if (!sampler) throw new GLTFError(`${name}: channel ${ci} references missing sampler ${ch.sampler}`);
      const interpolation = sampler.interpolation ?? 'LINEAR';
      const times = readAccessorFloat(doc, sampler.input).data;
      const values = readAccessorFloat(doc, sampler.output).data;
      const path = ch.target.path;
      const stride = path === 'weights' ? nodeMorphTargetCount(node) : STRIDE[path];
      if (stride <= 0) { warn(`${name}: weights channel on node ${node} without morph targets skipped`); return; }
      const perKey = interpolation === 'CUBICSPLINE' ? 3 : 1;
      if (values.length !== times.length * stride * perKey) {
        throw new GLTFError(`${name}: channel ${ci} output has ${values.length} floats, expected ${times.length * stride * perKey}`);
      }
      for (let i = 1; i < times.length; i++) if (times[i] < times[i - 1]) throw new GLTFError(`${name}: channel ${ci} times are not monotonic`);
      if (times.length) duration = Math.max(duration, times[times.length - 1]);
      channels.push({ node, path, interpolation, times, values, stride });
    });
    return { name, duration, channels };
  });
}
