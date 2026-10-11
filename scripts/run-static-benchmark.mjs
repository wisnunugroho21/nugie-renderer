/** npm exec --yes --package=playwright -- node scripts/run-static-benchmark.mjs baseline */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch {
  for (const bin of process.env.PATH.split(delimiter)) {
    const candidate = resolve(bin, '../playwright');
    if (existsSync(candidate + '/package.json')) { playwright = require(candidate); break; }
  }
}
if (!playwright) throw new Error('Run through npm exec --yes --package=playwright -- node scripts/run-static-benchmark.mjs');
const label = process.argv[2] ?? 'optimized';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid result label');
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { stdio: 'inherit' });
const selftest = process.argv[3] === '--selftest';
const port = Number(process.env.BENCH_PORT ?? 5191);
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--config', 'vite.benchmark.config.ts', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
let browser;
try {
  await new Promise((ok, fail) => { server.stdout.on('data', c => { if(c.toString().includes('Local:')) ok(); });server.stderr.on('data', c=>process.stderr.write(c));server.on('exit',c=>fail(new Error(`Server exited ${c}`))); });
  browser = await playwright.chromium.launch({ executablePath: process.env.BENCH_CHROME ?? (os.platform() === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: false });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];page.on('console',m=>{ if(['error','warning'].includes(m.type())) errors.push(m.text()); });page.on('pageerror',e=>errors.push(e.message));
  const url = new URL(`http://127.0.0.1:${port}/${selftest ? 'selftest.html' : 'bench-three.html?scenario=objects&only=optimized&frames=120&rounds=3'}`);
  if (!selftest) for (const [key, value] of new URLSearchParams((process.argv[3] ?? '').replace(/^&/, ''))) url.searchParams.set(key, value);
  await page.goto(url.href);
  await page.waitForFunction(()=>document.title.startsWith('DONE') || document.title === 'FAILED', undefined, {timeout:600000});
  console.log(await page.locator('#out').textContent());
  const result = await page.evaluate((st)=>st ? { selftests: window.__selftest } : window.__benchResults, selftest);
  if (!result || (selftest ? !result.selftests?.length || result.selftests.some(t=>!t.ok) : result.rows.some(r=>r.skipped || r.imageMAE > 0.5)) || errors.some(e=>/validation|uncaptured|shader.*error/i.test(e))) throw new Error('Benchmark failed or mismatched images');
  result.url = url.href;
  const sourceHash = createHash('sha256');
  const sourceFiles = execFileSync('rg', ['--files', 'src'], {encoding:'utf8'}).trim().split('\n').sort();
  for (const file of sourceFiles) sourceHash.update(file).update(readFileSync(file));
  result.sourceSHA256 = sourceHash.digest('hex');
  result.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
  result.host = { cpu: os.cpus()[0].model, memoryGB: os.totalmem()/2**30, browser: browser.version(), platform: os.platform(), release: os.release(), build: 'production' };
  result.consoleMessages=errors;
  mkdirSync('benchmarks/results',{recursive:true});writeFileSync(`benchmarks/results/${selftest ? 'selftest' : 'static'}-${label}.json`,JSON.stringify(result,null,2));
  const images=selftest ? [] :await page.locator('#stage canvas').evaluateAll(cs=>cs.map(c=>({name:c.title,png:c.toDataURL()})));
  for(const [index, shot] of images.entries())writeFileSync(`benchmarks/results/${label}-${index}-${shot.name.replace(/[^a-z0-9]+/gi,'-')}.png`,Buffer.from(shot.png.split(',')[1],'base64'));
} finally { await browser?.close();server.kill(); }
