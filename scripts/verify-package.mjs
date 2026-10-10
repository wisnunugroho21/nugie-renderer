import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Engine, createCube } from 'nugie-renderer';
import { Mat4 } from 'nugie-renderer/math/Mat4';
import { buildMipChain } from 'nugie-renderer/assets/MipChain';
import { buildMipChain as compatibilityExport } from 'nugie-renderer/streaming/TextureStreamer';
import { PriorityQueue } from 'nugie-renderer/core/PriorityQueue';
import { MotionMatchingMotion } from 'nugie-renderer/animation/motionmatching/MotionMatchingMotion';

/** Check runtime/declaration pairs for every source module promised by wildcard exports. */
async function verifyModules(directory = 'src') {
  let count = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['demos', 'game', 'bench', 'selftest'].includes(entry.name)) count += await verifyModules(path);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && entry.name !== 'main.ts' && !entry.name.endsWith('.worker.ts')) {
      const output = join('dist', path.slice(4, -3));
      assert.ok(existsSync(`${output}.js`), `Missing runtime module: ${path}`);
      assert.ok(existsSync(`${output}.d.ts`), `Missing declarations: ${path}`);
      await import(`nugie-renderer/${path.slice(4, -3).replaceAll('\\', '/')}`);
      count++;
    }
  }
  return count;
}

assert.equal(typeof Engine.create, 'function');
assert.ok(createCube().indices.length > 0);
assert.equal(Mat4.create().length, 16);
assert.equal(buildMipChain, compatibilityExport);
assert.equal(buildMipChain(new Uint8Array(16), 2, 2, false).length, 2);
assert.equal(typeof MotionMatchingMotion, 'function');
const queue = new PriorityQueue((a, b) => a - b);
queue.push(2); queue.push(1);
assert.equal(queue.pop(), 1);
assert.equal(queue.pop(), 2);
for (const directory of ['demos', 'game', 'bench', 'selftest']) {
  assert.ok(!existsSync(join('dist', directory)), `Application code leaked into library: ${directory}`);
}
console.log(`Package imports passed; ${await verifyModules()} runtime/declaration pairs verified.`);
