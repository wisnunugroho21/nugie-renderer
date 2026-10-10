import { describe, expect, it } from 'vitest';
import { PriorityQueue } from '../src/core/PriorityQueue';

interface Entry { priority: number; seq: number; }
const compare = (a: Entry, b: Entry) => b.priority - a.priority || a.seq - b.seq;

describe('PriorityQueue', () => {
  it('matches stable sorting after interleaved pushes, pops and cancellation', () => {
    const queue = new PriorityQueue<Entry>(compare);
    const reference: Entry[] = [];
    let seed = 42;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    for (let seq = 0; seq < 3000; seq++) {
      const entry = { priority: random() % 15, seq };
      queue.push(entry); reference.push(entry);
      if (seq % 3 === 0) {
        const index = random() % reference.length;
        expect(queue.remove(reference.splice(index, 1)[0])).toBe(true);
      }
      if (seq % 5 === 0) {
        reference.sort(compare);
        expect(queue.pop()).toBe(reference.shift());
      }
      expect(queue.length).toBe(reference.length);
    }
    reference.sort(compare);
    for (const entry of reference) expect(queue.pop()).toBe(entry);
    expect(queue.pop()).toBeUndefined();
    expect(queue.remove({ priority: 0, seq: 0 })).toBe(false);
  });
});
