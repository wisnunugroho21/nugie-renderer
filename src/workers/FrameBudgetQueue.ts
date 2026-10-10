import { PriorityQueue } from '../core/PriorityQueue';

/** Handle to a queued task: cancel it before it runs, or await `done` (resolves after it ran or was cancelled). */
export interface QueuedTask { cancel(): void; readonly done: Promise<void>; }

interface Item { fn: () => void; priority: number; seq: number; resolve: () => void; reject: (e: unknown) => void; }

/**
 * Priority work queue that spreads main-thread work (GPU uploads, object instantiation ...) over frames: `runFrame(budgetMs)`
 * executes tasks, highest priority first, until the budget is spent. At least one task runs per frame so the queue always
 * drains even when a single task is slower than the budget. Tasks can be cancelled before they run.
 */
export class FrameBudgetQueue {
  private items = new PriorityQueue<Item>((a, b) => b.priority - a.priority || a.seq - b.seq);
  private seq = 0;
  /** Stats of the most recent runFrame(). */
  lastRun = { tasks: 0, ms: 0 };
  totalRun = 0;

  /** `now` supplies the clock in ms (injectable for deterministic tests). */
  constructor(private now: () => number = () => performance.now()) {}

  /** Number of tasks waiting. */
  get length(): number { return this.items.length; }

  /** Queue `fn`; higher `priority` runs first, ties run in submission order. Returns a handle for cancelling / awaiting it. */
  enqueue(fn: () => void, priority = 0): QueuedTask {
    let resolve!: () => void, reject!: (e: unknown) => void;
    const done = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    const item: Item = { fn, priority, seq: this.seq++, resolve, reject };
    this.items.push(item);
    return { cancel: () => { if (this.items.remove(item)) resolve(); }, done };
  }

  /** Run queued tasks for at most ~`budgetMs`. Returns the number of tasks executed. */
  runFrame(budgetMs: number): number {
    const t0 = this.now();
    let n = 0;
    while (this.items.length) {
      if (n > 0 && this.now() - t0 >= budgetMs) break;
      const it = this.items.pop()!;
      try { it.fn(); it.resolve(); } catch (e) { it.reject(e); }
      n++;
    }
    this.lastRun = { tasks: n, ms: this.now() - t0 };
    this.totalRun += n;
    return n;
  }
}
