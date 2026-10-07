/**
 * Priority work queue that spreads main-thread work (GPU uploads, object instantiation ...) over frames: `runFrame(budgetMs)`
 * executes tasks, highest priority first, until the budget is spent. At least one task runs per frame so the queue always
 * drains even when a single task is slower than the budget. Tasks can be cancelled before they run.
 */
export interface QueuedTask { cancel(): void; readonly done: Promise<void>; }

interface Item { fn: () => void; priority: number; seq: number; cancelled: boolean; resolve: () => void; reject: (e: unknown) => void; }

export class FrameBudgetQueue {
  private items: Item[] = [];
  private seq = 0;
  /** Stats of the most recent runFrame(). */
  lastRun = { tasks: 0, ms: 0 };
  totalRun = 0;

  constructor(private now: () => number = () => performance.now()) {}

  get length(): number { return this.items.length; }

  enqueue(fn: () => void, priority = 0): QueuedTask {
    let resolve!: () => void, reject!: (e: unknown) => void;
    const done = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    const item: Item = { fn, priority, seq: this.seq++, cancelled: false, resolve, reject };
    this.items.push(item);
    return { cancel: () => { item.cancelled = true; this.items = this.items.filter((i) => i !== item); resolve(); }, done };
  }

  private next(): Item | undefined {
    if (this.items.length === 0) return undefined;
    let best = 0;
    for (let i = 1; i < this.items.length; i++) {
      const a = this.items[i], b = this.items[best];
      if (a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
    }
    return this.items.splice(best, 1)[0];
  }

  /** Run queued tasks for at most ~`budgetMs`. Returns the number of tasks executed. */
  runFrame(budgetMs: number): number {
    const t0 = this.now();
    let n = 0;
    while (this.items.length) {
      if (n > 0 && this.now() - t0 >= budgetMs) break;
      const it = this.next()!;
      try { it.fn(); it.resolve(); } catch (e) { it.reject(e); }
      n++;
    }
    this.lastRun = { tasks: n, ms: this.now() - t0 };
    this.totalRun += n;
    return n;
  }
}
