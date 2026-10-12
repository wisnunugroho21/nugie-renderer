import type { GPUContext } from '../../gpu/GPUContext';
import { technique, type TechniqueBuilder } from './TechniqueBuilder';
import type { TechniqueInstance, TechniqueInstanceOptions } from './TechniqueInstance';

/**
 * A technique that is rebuilt only when its `key` changes: the way a pass whose resources depend on the frame (target size, sample count, the set of active
 * layers ...) keeps one instance alive across frames. `get(key, build)` returns the current instance, building a new one (and freeing the old) when the key differs.
 */
export class CachedTechnique {
  private key: string | null = null;
  private instance: TechniqueInstance | null = null;

  constructor(private gpu: GPUContext, private name: string, private options: TechniqueInstanceOptions = {}) {}

  /** The instance for `key`; `build` declares its resources and nodes on a fresh builder when the key is new. */
  get(key: string, build: (g: TechniqueBuilder) => void): TechniqueInstance {
    if (this.instance && key === this.key) return this.instance;
    this.instance?.dispose();
    const g = technique(this.name);
    build(g);
    this.instance = g.instantiate(this.gpu, { label: this.name, ...this.options });
    this.key = key;
    return this.instance;
  }

  /** Free the current instance (the next `get` builds again). */
  dispose(): void { this.instance?.dispose(); this.instance = null; this.key = null; }
}
