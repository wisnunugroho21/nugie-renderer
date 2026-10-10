import { bench, report } from './harness';
import { FrameBudgetQueue } from '../src/workers/FrameBudgetQueue';
import { StreamPolicy, DEFAULT_STREAM_CONFIG } from '../src/streaming/StreamPolicy';
import { buildMipChain } from '../src/assets/MipChain';

// Includes enqueue + drain; fixed priorities and FIFO ties, empty tasks, no wall-clock budget.
for (const count of [100, 1000, 10000]) {
  report(`Frame queue: enqueue + drain ${count} tasks`, [bench('frame queue', () => {
    const queue = new FrameBudgetQueue(() => 0);
    for (let i = 0; i < count; i++) queue.enqueue(() => {}, (i * 17) % 13);
    if (queue.runFrame(Infinity) !== count) throw new Error('Incomplete queue drain');
  }, 200)]);
}

// Every texture wants to downgrade, but hysteresis holds residency fixed during measurement.
for (const count of [100, 1000, 2000]) {
  const policy = new StreamPolicy({ ...DEFAULT_STREAM_CONFIG, budgetBytes: 1e12, downgradeDelay: 1e12 });
  for (let i = 0; i < count; i++) policy.add(1024, 1024, 11, 4, 0);
  report(`Streaming plan: ${count} unseen resident textures`, [bench('stream plan', () => {
    policy.beginFrame();
    if (policy.plan().length) throw new Error('Benchmark changed residency');
  }, 200)]);
}

const rgba = new Uint8Array(1024 * 1024 * 4).map((_, i) => (i * 13) % 256);
report('CPU mip chain: 1024 x 1024', [
  bench('linear RGBA8', () => { buildMipChain(rgba, 1024, 1024, false); }, 200),
  bench('sRGB RGBA8', () => { buildMipChain(rgba, 1024, 1024, true); }, 200),
]);
