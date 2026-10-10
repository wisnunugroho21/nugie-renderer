/** Binary min-heap. The comparator decides priority; include a sequence number for FIFO ties.
 * Entries must be unique. Indexed removal lets callers cancel pending work in O(log n).
 */
export class PriorityQueue<T> {
  private items: T[] = [];
  private positions = new Map<T, number>();

  constructor(private compare: (a: T, b: T) => number) {}

  get length(): number { return this.items.length; }

  push(item: T): void {
    if (this.positions.has(item)) throw new Error('PriorityQueue: duplicate entry');
    this.positions.set(item, this.items.length);
    this.items.push(item);
    this.up(this.items.length - 1);
  }

  pop(): T | undefined {
    const item = this.items[0];
    if (this.items.length) this.remove(item);
    return item;
  }

  remove(item: T): boolean {
    const index = this.positions.get(item);
    if (index === undefined) return false;
    const last = this.items.pop()!;
    this.positions.delete(item);
    if (index < this.items.length) {
      this.items[index] = last;
      this.positions.set(last, index);
      const next = this.up(index);
      this.down(next);
    }
    return true;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    this.positions.set(this.items[a], a);
    this.positions.set(this.items[b], b);
  }

  private up(index: number): number {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(this.items[index], this.items[parent]) >= 0) break;
      this.swap(index, parent);
      index = parent;
    }
    return index;
  }

  private down(index: number): void {
    while (index * 2 + 1 < this.items.length) {
      let child = index * 2 + 1;
      if (child + 1 < this.items.length && this.compare(this.items[child + 1], this.items[child]) < 0) child++;
      if (this.compare(this.items[index], this.items[child]) <= 0) break;
      this.swap(index, child);
      index = child;
    }
  }
}
