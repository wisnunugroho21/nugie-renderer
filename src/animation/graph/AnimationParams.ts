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

  constructor(capacity = 32) { this.values = new Float64Array(capacity); }

  define(name: string, type: ParamType, initial = 0): number {
    if (this.ids.has(name)) throw new Error(`Parameter '${name}' already defined`);
    const id = this.types.length;
    if (id >= this.values.length) throw new Error('Too many animation parameters');
    this.ids.set(name, id); this.types.push(type); this.names.push(name);
    this.values[id] = type === 'bool' || type === 'trigger' ? (initial ? 1 : 0) : type === 'int' ? Math.trunc(initial) : initial;
    return id;
  }

  id(name: string): number {
    const id = this.ids.get(name);
    if (id === undefined) throw new Error(`Unknown animation parameter '${name}'`);
    return id;
  }

  has(name: string): boolean { return this.ids.has(name); }

  private resolve(p: number | string): number { return typeof p === 'string' ? this.id(p) : p; }

  setFloat(p: number | string, v: number): void { this.values[this.resolve(p)] = v; }
  setInt(p: number | string, v: number): void { this.values[this.resolve(p)] = Math.trunc(v); }
  setBool(p: number | string, v: boolean): void { this.values[this.resolve(p)] = v ? 1 : 0; }
  /** Latch a trigger (consumed by the first transition that uses it). */
  trigger(p: number | string): void { this.values[this.resolve(p)] = 1; }
  resetTrigger(p: number | string): void { this.values[this.resolve(p)] = 0; }
  get(p: number | string): number { return this.values[this.resolve(p)]; }
}

export type ConditionOp = 'gt' | 'lt' | 'ge' | 'le' | 'eq' | 'ne' | 'true' | 'false' | 'trigger';

export interface Condition { param: number; op: ConditionOp; value?: number; }

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
