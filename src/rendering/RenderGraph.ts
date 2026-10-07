export interface PassDesc {
  name: string;
  /** Logical resources this pass consumes / produces (free-form names, e.g. 'shadowMap', 'depth'). */
  reads?: string[];
  writes?: string[];
  /** Keep the pass even if nothing consumes its outputs (e.g. the pass that writes the backbuffer). */
  sideEffect?: boolean;
  execute: (enc: GPUCommandEncoder) => void;
}

/**
 * Minimal frame graph: passes declare what they read and write; `compile` orders them so every producer runs before its
 * consumers (stable w.r.t. declaration order), keeps write-after-read / write-after-write order, rejects cycles and drops
 * passes whose results nobody uses. The renderer rebuilds it each frame (a handful of passes: the cost is negligible).
 */
export class RenderGraph {
  private passes: PassDesc[] = [];
  /** Names of the passes in executed order after compile(). */
  order: string[] = [];
  /** Passes removed by culling after compile(). */
  culled: string[] = [];
  private compiled: PassDesc[] = [];

  /** Remove all passes (call at the start of every frame). */
  reset(): void { this.passes.length = 0; this.order.length = 0; this.culled.length = 0; this.compiled.length = 0; }

  /** Declare a pass for this frame. */
  addPass(p: PassDesc): void { this.passes.push(p); }

  /** Derive pass order from the declared reads / writes (a stable topological sort), drop passes nothing depends on, and throw on cycles. Returns the names of culled passes. */
  compile(): string[] {
    const n = this.passes.length;
    // dependency edges (a -> b means a must run before b), derived from declaration order per resource
    const deps: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
    const lastWriter = new Map<string, number>(), readersSinceWrite = new Map<string, number[]>(), writersOf = new Map<string, number[]>();
    this.passes.forEach((p, i) => { for (const r of p.writes ?? []) (writersOf.get(r) ?? writersOf.set(r, []).get(r)!).push(i); });
    this.passes.forEach((p, i) => {
      for (const r of p.reads ?? []) {
        const w = lastWriter.get(r);
        if (w !== undefined && w !== i) deps[i].add(w);
        // nothing declared before this read writes `r`: it consumes the (later-declared) producer(s) instead
        else if (w === undefined) { for (const j of writersOf.get(r) ?? []) if (j !== i) deps[i].add(j); continue; }
        (readersSinceWrite.get(r) ?? readersSinceWrite.set(r, []).get(r)!).push(i);
      }
      for (const r of p.writes ?? []) {
        const w = lastWriter.get(r);
        if (w !== undefined && w !== i) deps[i].add(w);                    // write after write
        for (const rd of readersSinceWrite.get(r) ?? []) if (rd !== i) deps[i].add(rd);   // write after read
        lastWriter.set(r, i); readersSinceWrite.set(r, []);
      }
    });
    // cull: keep side-effect passes and everything they (transitively) depend on
    const keep = new Array<boolean>(n).fill(false);
    /** Keep pass `i` and, recursively, every pass it depends on. */
    const mark = (i: number): void => { if (keep[i]) return; keep[i] = true; deps[i].forEach(mark); };
    this.passes.forEach((p, i) => { if (p.sideEffect) mark(i); });
    // a pass with outputs that some kept pass reads is already kept through deps; passes with no outputs are only kept if sideEffect
    this.culled = this.passes.filter((_, i) => !keep[i]).map((p) => p.name);
    // stable topological order (Kahn, lowest declaration index first)
    const indeg = new Array<number>(n).fill(0);
    const users: number[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) if (keep[i]) for (const d of deps[i]) if (keep[d]) { indeg[i]++; users[d].push(i); }
    const ready: number[] = [];
    for (let i = 0; i < n; i++) if (keep[i] && indeg[i] === 0) ready.push(i);
    const out: PassDesc[] = [];
    while (ready.length) {
      ready.sort((a, b) => a - b);
      const i = ready.shift()!;
      out.push(this.passes[i]);
      for (const u of users[i]) if (--indeg[u] === 0) ready.push(u);
    }
    if (out.length !== keep.filter(Boolean).length) throw new Error('RenderGraph: dependency cycle between passes');
    this.compiled = out;
    return (this.order = out.map((p) => p.name));
  }

  /** Run the compiled passes in order, recording into `enc`. */
  execute(enc: GPUCommandEncoder): void { for (const p of this.compiled) p.execute(enc); }
}
