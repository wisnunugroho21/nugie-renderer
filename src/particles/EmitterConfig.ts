export type EmitterShape = 'point' | 'box' | 'sphere' | 'cone';
export type EmitterDirection = 'none' | 'outward' | 'cone';
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export interface Burst { /** Seconds after the emitter (loop) started. */ time: number; count: number; }

export interface EmitterConfig {
  shape?: EmitterShape;
  /** box: half extents | sphere: radius (x), surfaceOnly | cone: base radius (x), half angle in radians. */
  box?: Vec3;
  radius?: number;
  surfaceOnly?: boolean;
  coneAngle?: number;
  /** Continuous spawn rate (particles / second). */
  rate?: number;
  bursts?: Burst[];
  /** Emission duration in seconds (0 / undefined = endless). */
  duration?: number;
  loop?: boolean;
  lifetime?: [number, number];
  size?: [number, number];
  /** Size at end of life = start size * this. */
  sizeEndScale?: number;
  velocityMin?: Vec3;
  velocityMax?: Vec3;
  /** Additional speed along the shape direction (see `direction`). */
  radialSpeed?: [number, number];
  direction?: EmitterDirection;
  acceleration?: Vec3;
  drag?: number;
  rotation?: [number, number];
  angularVelocity?: [number, number];
  colorStart?: Vec4;
  colorEnd?: Vec4;
  space?: 'world' | 'local';
  flipbook?: { columns: number; rows: number; frames: number; fps?: number };
  seed?: number;
}

export const EMITTER_FLOATS = 60;           // 240 bytes, mirrors `Emitter` in particles_common.wgsl
export const EMITTER_BYTES = EMITTER_FLOATS * 4;

const SHAPE_ID: Record<EmitterShape, number> = { point: 0, box: 1, sphere: 2, cone: 3 };
const DIR_ID: Record<EmitterDirection, number> = { none: 0, outward: 1, cone: 2 };

/** Resolve defaults (every field concrete). */
export function resolveEmitter(c: EmitterConfig): Required<Omit<EmitterConfig, 'flipbook' | 'bursts'>> & { flipbook: NonNullable<EmitterConfig['flipbook']> | null; bursts: Burst[] } {
  const shape = c.shape ?? 'point';
  return {
    shape, box: c.box ?? [0.5, 0.5, 0.5], radius: c.radius ?? 0.5, surfaceOnly: c.surfaceOnly ?? false, coneAngle: c.coneAngle ?? Math.PI / 6,
    rate: c.rate ?? 0, bursts: [...(c.bursts ?? [])].sort((a, b) => a.time - b.time), duration: c.duration ?? 0, loop: c.loop ?? true,
    lifetime: c.lifetime ?? [1, 1], size: c.size ?? [0.1, 0.1], sizeEndScale: c.sizeEndScale ?? 1,
    velocityMin: c.velocityMin ?? [0, 0, 0], velocityMax: c.velocityMax ?? [0, 0, 0], radialSpeed: c.radialSpeed ?? [0, 0],
    direction: c.direction ?? (shape === 'cone' ? 'cone' : shape === 'sphere' || shape === 'box' ? 'outward' : 'none'),
    acceleration: c.acceleration ?? [0, 0, 0], drag: c.drag ?? 0, rotation: c.rotation ?? [0, 0], angularVelocity: c.angularVelocity ?? [0, 0],
    colorStart: c.colorStart ?? [1, 1, 1, 1], colorEnd: c.colorEnd ?? [1, 1, 1, 0], space: c.space ?? 'world',
    flipbook: c.flipbook ?? null, seed: c.seed ?? 1,
  };
}

/** Pack one emitter + its world matrix into `out` at float offset `o` (layout in particles_common.wgsl). */
export function packEmitter(cfg: EmitterConfig, world: ArrayLike<number>, out: Float32Array, o: number, seedOverride?: number): void {
  const e = resolveEmitter(cfg);
  for (let i = 0; i < 16; i++) out[o + i] = world[i];
  /** Write four floats into the emitter's packed data at vec4 `slot`. */
  const set = (slot: number, a: number, b: number, c: number, d: number) => { const k = o + 16 + slot * 4; out[k] = a; out[k + 1] = b; out[k + 2] = c; out[k + 3] = d; };
  if (e.shape === 'box') set(0, e.box[0], e.box[1], e.box[2], 0);
  else if (e.shape === 'sphere') set(0, e.radius, e.surfaceOnly ? 1 : 0, 0, 0);
  else if (e.shape === 'cone') set(0, e.radius, 0, 0, e.coneAngle);
  else set(0, 0, 0, 0, 0);
  set(1, e.velocityMin[0], e.velocityMin[1], e.velocityMin[2], e.radialSpeed[0]);
  set(2, e.velocityMax[0], e.velocityMax[1], e.velocityMax[2], e.radialSpeed[1]);
  set(3, e.acceleration[0], e.acceleration[1], e.acceleration[2], e.drag);
  set(4, e.lifetime[0], e.lifetime[1], e.size[0], e.size[1]);
  set(5, e.rotation[0], e.rotation[1], e.angularVelocity[0], e.angularVelocity[1]);
  set(6, ...e.colorStart);
  set(7, ...e.colorEnd);
  set(8, e.sizeEndScale, DIR_ID[e.direction], SHAPE_ID[e.shape], e.space === 'local' ? 1 : 0);
  const fb = e.flipbook;
  set(9, fb ? fb.columns : 1, fb ? fb.rows : 1, fb ? fb.frames : 1, fb?.fps ?? 0);
  new Uint32Array(out.buffer, out.byteOffset + (o + 56) * 4, 4).set([(seedOverride ?? e.seed) >>> 0, 0, 0, 0]);
}

/**
 * CPU-side spawn scheduling (rate accumulation, bursts, duration/looping). The GPU only receives how many particles
 * each emitter spawns this frame; everything else (positions, velocities, randomness) happens in the emit kernel.
 */
export class EmitterRuntime {
  readonly config: ReturnType<typeof resolveEmitter>;
  enabled = true;
  /** Time within the current loop. */
  time = 0;
  finished = false;
  private acc = 0;
  private nextBurst = 0;

  /** Resolve `source` (user-facing, all-optional config) into a full config with defaults filled in. */
  constructor(readonly source: EmitterConfig) { this.config = resolveEmitter(source); }

  /** Reset the emitter's clock, rate accumulator and burst schedule so it plays from the beginning again. */
  restart(): void { this.time = 0; this.acc = 0; this.nextBurst = 0; this.finished = false; }

  /**
   * Advance by dt; returns the number of particles to spawn this frame.
   * Rate emission accumulates fractional particles across frames; every burst fires exactly once per loop, even when a
   * long dt spans several loops.
   */
  tick(dt: number): number {
    if (!this.enabled || this.finished || dt <= 0) return 0;
    const c = this.config, EPS = 1e-9;
    let spawn = 0, remaining = dt;
    for (let guard = 0; guard < 1024 && remaining > 0; guard++) {
      const t = this.time;
      const end = c.duration > 0 ? Math.min(t + remaining, c.duration) : t + remaining;
      this.acc += c.rate * (end - t);
      while (this.nextBurst < c.bursts.length && c.bursts[this.nextBurst].time <= end + EPS) spawn += c.bursts[this.nextBurst++].count;
      remaining -= end - t;
      this.time = end;
      if (c.duration > 0 && end >= c.duration - EPS) {
        if (!c.loop) { this.finished = true; break; }
        this.time = 0; this.nextBurst = 0;          // wrap; continue with whatever time is left
        if (remaining <= EPS) break;
      } else break;
    }
    const whole = Math.floor(this.acc + EPS);
    this.acc -= whole;
    return spawn + whole;
  }
}
