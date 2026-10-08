export interface BenchResult { name: string; opsPerSec: number; meanMs: number; samples: number; }

/** Minimal benchmark: warm up, then run `fn` repeatedly for ~`ms` and report mean time. */
export function bench(name: string, fn: () => void, ms = 400): BenchResult {
  for (let i = 0; i < 20; i++) fn();
  let n = 0;
  const start = performance.now();
  let now = start;
  while (now - start < ms) { fn(); n++; now = performance.now(); }
  const meanMs = (now - start) / n;
  return { name, opsPerSec: 1000 / meanMs, meanMs, samples: n };
}

/** Print a table of results with each one's speed relative to the baseline entry (default: the last). */
export function report(title: string, results: BenchResult[], baselineIndex = results.length - 1): void {
  console.log(`\n== ${title} ==`);
  const base = results[baselineIndex];
  for (const r of results) {
    const rel = base.meanMs / r.meanMs;
    console.log(`  ${r.name.padEnd(52)} ${r.meanMs.toFixed(4).padStart(10)} ms/op  ${rel.toFixed(1).padStart(7)}x vs baseline (${base.name.split(',')[0]})`);
  }
}
