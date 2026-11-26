import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch, release, totalmem } from 'node:os';
import { writeFileSync } from 'node:fs';
const [count, output, separator, command, ...args] = process.argv.slice(2);
const n = Number(count);
if (!Number.isInteger(n) || n < 1 || n > 1000 || !output || separator !== '--' || !command) {
  console.error('Usage: node scripts/architecture-benchmark.mjs 10 output.json -- command [args...]');
  process.exit(2);
}
const runs = [];
for (let i = 0; i < n; i++) {
  const start = performance.now();
  const child = spawnSync(command, args, { stdio: 'inherit', shell: false });
  runs.push({ wall_ms: performance.now() - start, exit_code: child.status, signal: child.signal, error: child.error?.code ?? null });
}
const values = runs.filter(r => r.exit_code === 0 && !r.error).map(r => r.wall_ms).sort((a,b)=>a-b);
const percentile = p => values.length ? values[Math.ceil(p * values.length)-1] : null;
const median = values.length ? (values[Math.floor((values.length-1)/2)] + values[Math.floor(values.length/2)])/2 : null;
writeFileSync(output, JSON.stringify({ schema_version: 1, metric: 'process_wall_ms', cache_state: 'uncontrolled', host: { platform: platform(), arch: arch(), release: release(), cpu: cpus()[0]?.model, logical_cpus: cpus().length, ram_bytes: totalmem(), node: process.version }, runs, median_ms: median, p95_ms: percentile(.95), failures: n-values.length }, null, 2)+'\n', {flag:'wx'});
if (values.length !== n) process.exitCode = 1;
