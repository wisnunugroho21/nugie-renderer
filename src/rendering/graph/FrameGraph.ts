import { technique, type TechniqueBuilder } from './TechniqueBuilder';
import type { TechniqueHost, TechniqueInstance, TechniqueInstanceOptions } from './TechniqueInstance';

/**
 * Names the engine's frame passes order themselves by, declared on every frame's builder so features can say `reads: ['sceneColor']` without declaring anything.
 * A feature that produces its own resource declares it with `graph.logical('name')`.
 */
export const FRAME_RESOURCES = [
  'backbuffer', 'sceneColor', 'color', 'depth', 'auxTex', 'transmissionTex', 'hizTex', 'culled', 'culledA', 'culledB',
  'shadowMap', 'lights', 'clusterGrid', 'fogVolume', 'particles', 'ribbons',
] as const;

/**
 * The renderer's frame as one technique of callback nodes. Each frame the renderer (and its features) declares the passes on a fresh builder from `begin()`, then `run`
 * compiles them (dependencies, culling, ordering) and records them in order. Most frames declare the same passes as the one before; then the compiled plan is reused and only
 * the passes' code (this frame's closures) is swapped in, so a steady scene pays for building the list but not for compiling it.
 */
export class FrameGraph {
  private key: string | null = null;
  private instance: TechniqueInstance | null = null;

  constructor(private host: TechniqueHost, private name = 'frame', private options: TechniqueInstanceOptions = {}) {}

  /** A fresh builder with the {@link FRAME_RESOURCES} (and any `extra` names, such as what the features produce) declared as logical resources. */
  begin(extra: Iterable<string> = []): TechniqueBuilder {
    const g = technique(this.name);
    for (const name of FRAME_RESOURCES) g.logical(name);
    for (const name of extra) g.logical(name);
    return g;
  }

  /** Compile the declared passes (or reuse the previous plan if they are the same) and record them into `encoder`. */
  run(builder: TechniqueBuilder, encoder: GPUCommandEncoder): TechniqueInstance {
    const key = builder.callbackKey();
    if (this.instance && key === this.key) this.instance.setCallbacks(builder.callbacks());
    else {
      this.instance?.dispose();
      this.instance = null; this.key = null;   // a failed compile must not leave the freed instance to be reused
      this.instance = builder.instantiate(this.host, { label: this.name, ...this.options });
      this.key = key;
    }
    this.instance.execute(encoder);
    return this.instance;
  }

  /** The instance of the last frame (its `plan` lists the order and the culled passes), or null before the first. */
  get last(): TechniqueInstance | null { return this.instance; }
}
