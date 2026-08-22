// The whole release benchmark gate as one command: node benchmark/release.mjs
// Runs every measurement RELEASING.md reads, in order, and exits nonzero if any step does.
// Steps that fetch (corpora, npm baselines, the fever wiki dump) cache through
// benchmark/lib/cache.mjs, so only the first run on a machine pays the downloads.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(new URL('.', import.meta.url).pathname, '..');

const STEPS = [
  ['compare: last release vs working tree', ['benchmark/compare.mjs']],
  ['scale: 13k', ['benchmark/run.mjs', '.', '.tmp/cache/obsidian-hub-x2-x2-hub-1']],
  ['scale: 26k', ['benchmark/run.mjs', '.', '.tmp/cache/obsidian-hub-x4-x4-hub-1']],
  ['stress: shape-cliff guard', ['benchmark/run.mjs', '.', '.tmp/cache/stress-stress-1']],
  ['quality: nfcorpus', ['benchmark/eval.mjs', 'nfcorpus']],
  ['quality: fever', ['benchmark/eval.mjs', 'fever']],
];

let failed = 0;
for (const [title, args] of STEPS) {
  console.log(`\n===== ${title} =====`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    failed++;
    console.error(`FAILED (exit ${r.status}): ${args.join(' ')}`);
  }
}
if (failed > 0) {
  console.error(`\n${failed} step(s) failed`);
  process.exit(1);
}
console.log('\nall benchmark steps passed; paste the tables into BENCHMARKING.md from this output');
