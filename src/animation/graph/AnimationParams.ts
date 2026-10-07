export type ParamType = 'bool' | 'float' | 'int' | 'trigger';

/**
 * Typed animation parameters (bool / float / int / trigger). Parameters are addressed by integer id on hot paths
 * (`id()` once at setup); name-based setters are conveniences.
 *
 * Triggers are latched until a transition that is conditioned on them fires (then consumed) - deterministic
 * and independent of frame rate.
 */
export class AnimationParams {
  private ids = new Map<string, number>();
  readonly types: ParamType[] = [];
  readonly values: Float64Array;
  readonly names: string[] = [];

  /** Create a parameter table with room for `capacity` parameters. */
  constructor(capacity = 32) { this.values = new Float64Array(capacity); }

  /** Declare parameter `name` of the given type with an initial value and return its numeric id. Throws on duplicates or when full. */
  define(name: string, type: ParamType, initial = 0): number {
    if (this.ids.has(name)) throw new Error(`Parameter '${name}' already defined`);
    const id = this.types.length;
    if (id >= this.values.length) throw new Error('Too many animation parameters');
    this.ids.set(name, id); this.types.push(type); this.names.push(name);
    this.values[id] = type === 'bool' || type === 'trigger' ? (initial ? 1 : 0) : type === 'int' ? Math.trunc(initial) : initial;
    return id;
  }

  /** Numeric id of parameter `name` (throws if unknown); prefer caching it for per-frame writes. */
  id(name: string): number {
    const id = this.ids.get(name);
    if (id === undefined) throw new Error(`Unknown animation parameter '${name}'`);
    return id;
  }

  /** True if a parameter called `name` is defined. */
  has(name: string): boolean { return this.ids.has(name); }

  /** Accept either a parameter name or an id and return the id. */
  private resolve(p: number | string): number { return typeof p === 'string' ? this.id(p) : p; }

  /** Set a float parameter. */
  setFloat(p: number | string, v: number): void { this.values[this.resolve(p)] = v; }
  /** Set an integer parameter (truncated toward zero). */
  setInt(p: number | string, v: number): void { this.values[this.resolve(p)] = Math.trunc(v); }
  /** Set a boolean parameter. */
  setBool(p: number | string, v: boolean): void { this.values[this.resolve(p)] = v ? 1 : 0; }
  /** Latch a trigger (consumed by the first transition that uses it). */
  trigger(p: number | string): void { this.values[this.resolve(p)] = 1; }
  /** Clear a trigger without waiting for a transition to consume it. */
  resetTrigger(p: number | string): void { this.values[this.resolve(p)] = 0; }
  /** Current numeric value of a parameter (bool / trigger = 0 or 1). */
  get(p: number | string): number { return this.values[this.resolve(p)]; }
}

export type ConditionOp = 'gt' | 'lt' | 'ge' | 'le' | 'eq' | 'ne' | 'true' | 'false' | 'trigger';

export interface Condition { param: number; op: ConditionOp; value?: number; }

/** Test one transition condition (comparison, bool or trigger) against the current parameter values. */
export function evaluateCondition(c: Condition, params: AnimationParams): boolean {
  const v = params.values[c.param], ref = c.value ?? 0;
  switch (c.op) {
    case 'gt': return v > ref;
    case 'lt': return v < ref;
    case 'ge': return v >= ref;
    case 'le': return v <= ref;
    case 'eq': return v === ref;
    case 'ne': return v !== ref;
    case 'true': case 'trigger': return v !== 0;
    case 'false': return v === 0;
  }
}
