/**
 * Small promise-based worker pool. `run` queues a job, hands it to an idle worker (one job at a time per worker) and resolves with
 * the worker's reply. Transferables move buffers without copying. Jobs are processed in FIFO order; `priority` (higher first) lets
 * urgent work overtake queued work.
 */
export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

interface Job { msg: unknown; transfer: Transferable[]; priority: number; seq: number; resolve: (v: unknown) => void; reject: (e: unknown) => void; }

export class WorkerPool {
  private workers: { w: WorkerLike; job: Job | null }[] = [];
  private queue: Job[] = [];
  private seq = 0;
  completed = 0;
  /** Highest number of jobs that were ever in flight at once (diagnostics / tests). */
  peakBusy = 0;

  constructor(factory: () => WorkerLike, size = Math.max(1, Math.min(4, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) - 1))) {
    for (let i = 0; i < size; i++) {
      const slot = { w: factory(), job: null as Job | null };
      slot.w.onmessage = (e) => {
        const j = slot.job; slot.job = null; this.completed++;
        const d = e.data as { error?: string } | null;
        if (j) { if (d && typeof d === 'object' && 'error' in d && d.error) j.reject(new Error(d.error)); else j.resolve(e.data); }
        this.pump();
      };
      slot.w.onerror = (e) => { const j = slot.job; slot.job = null; if (j) j.reject(e instanceof Error ? e : new Error(String((e as { message?: string })?.message ?? e))); this.pump(); };
      this.workers.push(slot);
    }
  }

  get size(): number { return this.workers.length; }
  get pending(): number { return this.queue.length; }

  run<T>(msg: unknown, transfer: Transferable[] = [], priority = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ msg, transfer, priority, seq: this.seq++, resolve: resolve as (v: unknown) => void, reject });
      this.pump();
    });
  }

  private pump(): void {
    for (const slot of this.workers) {
      if (slot.job || this.queue.length === 0) continue;
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) {
        const a = this.queue[i], b = this.queue[best];
        if (a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
      }
      const job = this.queue.splice(best, 1)[0];
      slot.job = job;
      slot.w.postMessage(job.msg, job.transfer);
      this.peakBusy = Math.max(this.peakBusy, this.workers.filter((s) => s.job).length);
    }
  }

  terminate(): void { for (const s of this.workers) s.w.terminate(); this.workers = []; this.queue.length = 0; }
}
