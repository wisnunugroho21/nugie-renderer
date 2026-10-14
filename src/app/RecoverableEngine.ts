import { Engine, type EngineOptions } from './Engine';

/** Callbacks and tuning for {@link runRecoverable}. */
export interface RecoverableOptions {
  /** Called when the device is lost, before the engine is rebuilt. */
  onLost?: (info: GPUDeviceLostInfo) => void;
  /** Called once a replacement engine is up and `setup` has run on it. */
  onRecovered?: (engine: Engine) => void;
  /** Called when rebuilding fails for good (after `maxAttempts`), or when WebGPU cannot be recovered at all. */
  onFailed?: (error: unknown) => void;
  /** Rebuild attempts per loss before giving up (default 5); the wait doubles from `retryDelayMs`. */
  maxAttempts?: number;
  /** First retry delay in milliseconds (default 250). */
  retryDelayMs?: number;
  /** Engine factory; defaults to {@link Engine.create}. Replaceable for tests. */
  create?: (canvas: HTMLCanvasElement, options: EngineOptions) => Promise<Engine>;
}

/** A running engine that replaces itself after a GPU device loss. */
export interface RecoverableEngine {
  /** The current engine; a different object after every recovery, so do not keep references to it or to anything it created. */
  readonly engine: Engine;
  /** Stop recovering and stop the current engine's loop. */
  dispose(): void;
}

/**
 * Create an engine and keep it alive across GPU device loss (driver reset, GPU switch, tab backgrounded for long enough).
 *
 * A lost device takes every buffer, texture and pipeline with it, so the engine cannot repair itself in place: instead `setup` is the
 * single function that builds your scene (meshes, materials, entities, camera, `engine.start(...)`). It runs on the first engine and
 * again on each replacement, so keep game state that must survive outside it. A loss with reason `'destroyed'` (an intentional
 * `device.destroy()`) is not recovered.
 *
 * ```ts
 * const game = await runRecoverable(canvas, {}, (engine) => { buildScene(engine); engine.start(update); });
 * ```
 */
export async function runRecoverable(
  canvas: HTMLCanvasElement,
  engineOptions: EngineOptions,
  setup: (engine: Engine) => void | Promise<void>,
  options: RecoverableOptions = {},
): Promise<RecoverableEngine> {
  const create = options.create ?? ((c, o) => Engine.create(c, o));
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelay = options.retryDelayMs ?? 250;
  let disposed = false;
  let current!: Engine;

  /** Build one engine, run `setup` on it and arm the loss handler. */
  const build = async (): Promise<Engine> => {
    const engine = await create(canvas, engineOptions);
    engine.onDeviceLost = (info) => { void recover(info); };
    try {
      await setup(engine);
    } catch (error) {
      engine.onDeviceLost = null; // an abandoned engine must not trigger recovery
      engine.stop();
      throw error;
    }
    return engine;
  };

  /** Rebuild after a loss, retrying with exponential back-off. */
  const recover = async (info: GPUDeviceLostInfo): Promise<void> => {
    if (disposed || info.reason === 'destroyed') return;
    options.onLost?.(info);
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts && !disposed; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, baseDelay * 2 ** (attempt - 1)));
      if (disposed) return;
      try {
        current = await build();
        options.onRecovered?.(current);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    if (!disposed) options.onFailed?.(lastError);
  };

  current = await build();
  return {
    get engine() { return current; },
    dispose() { disposed = true; current.stop(); },
  };
}
