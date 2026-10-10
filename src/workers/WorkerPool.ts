import { PriorityQueue } from '../core/PriorityQueue';

/** The subset of a Worker needed by the pool (also usable by test doubles). */
export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

interface Job {
  msg: unknown;
  transfer: Transferable[];
  priority: number;
  seq: number;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}
interface WorkerSlot { worker: WorkerLike; job: Job | null; }

function defaultSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4;
  return Math.max(1, Math.min(4, (cores || 4) - 1));
}

/** Promise-based worker pool: one job per worker, higher priority first, FIFO ties.
 * A job-level error reply rejects only that job. A worker error closes the pool: a worker
 * whose script failed to load cannot process further jobs, so none are left waiting forever.
 */
export class WorkerPool {
  private workers: WorkerSlot[] = [];
  private queue = new PriorityQueue<Job>((a, b) => b.priority - a.priority || a.seq - b.seq);
  private seq = 0;
  private closed: Error | null = null;
  private pumping = false;
  completed = 0;
  /** Highest number of jobs that were ever in flight at once. */
  peakBusy = 0;

  constructor(factory: () => WorkerLike, size = defaultSize()) {
    if (!Number.isInteger(size) || size < 1) throw new RangeError('WorkerPool size must be a positive integer');
    try {
      for (let i = 0; i < size; i++) {
        const slot: WorkerSlot = { worker: factory(), job: null };
        this.workers.push(slot);
        slot.worker.onmessage = (event) => {
          const job = slot.job;
          if (!job || this.closed) return;
          slot.job = null;
          this.completed++;
          const data = event.data as { error?: string } | null;
          if (data && typeof data === 'object' && data.error) job.reject(new Error(data.error));
          else job.resolve(event.data);
          this.pump();
        };
        slot.worker.onerror = (error) => {
          this.close(error instanceof Error ? error : new Error(String((error as { message?: string })?.message ?? error)));
        };
      }
    } catch (error) {
      this.terminate();
      throw error;
    }
  }

  get size(): number { return this.workers.length; }
  get pending(): number { return this.queue.length; }

  /** Transferables are moved rather than copied. Rejects immediately after termination. */
  run<T>(msg: unknown, transfer: Transferable[] = [], priority = 0): Promise<T> {
    if (this.closed) return Promise.reject(this.closed);
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ msg, transfer, priority, seq: this.seq++, resolve: resolve as (value: unknown) => void, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.pumping || this.closed) return;
    this.pumping = true;
    try {
      for (const slot of this.workers) {
        while (!this.closed && !slot.job && this.queue.length) {
          const job = this.queue.pop()!;
          slot.job = job;
          this.peakBusy = Math.max(this.peakBusy, this.workers.reduce((n, s) => n + Number(s.job !== null), 0));
          try {
            slot.worker.postMessage(job.msg, job.transfer);
          } catch (error) {
            // DataCloneError (or an invalid transferable) must not poison the slot.
            if (slot.job === job) slot.job = null;
            job.reject(error);
          }
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private close(error: Error): void {
    if (this.closed) return;
    this.closed = error;
    for (const slot of this.workers) {
      slot.worker.onmessage = null;
      slot.worker.onerror = null;
      slot.job?.reject(error);
      slot.job = null;
      slot.worker.terminate();
    }
    while (this.queue.length) this.queue.pop()!.reject(error);
    this.workers.length = 0;
  }

  /** Reject running, queued and future jobs and release every worker. Idempotent. */
  terminate(): void { this.close(new Error('WorkerPool terminated')); }
}
