// test-log.js — Runs vitest suite and writes structured results
// to /Projects/logs/test-results/research360.json
// ESM · No external dependencies · Node.js built-ins only

import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const outDir = resolve(projectRoot, '..', '..', 'logs', 'test-results');
const outFile = resolve(outDir, 'research360.json');

function git(cmd) {
  try {
    return execSync(cmd, { cwd: projectRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const branch = git('git rev-parse --abbrev-ref HEAD');
const commit = git('git rev-parse --short HEAD');

const start = Date.now();
const result = spawnSync('npm', ['test'], {
  cwd: projectRoot,
  encoding: 'utf8',
  shell: true,
  timeout: 120_000,
});
const duration_ms = Date.now() - start;
const output = (result.stdout || '') + '\n' + (result.stderr || '');

let pass = 0, fail = 0, skip = 0, status = 'unknown';

try {
  // Vitest summary: " Tests  25 passed (25)"
  // With failures:  " Tests  5 failed | 20 passed (25)"
  const failMatch = output.match(/Tests\s+(\d+) failed/);
  const passMatch = output.match(/Tests\s+(?:\d+ failed \| )?(\d+) passed/);
  const skipMatch = output.match(/Tests\s+.*?(\d+) skipped/);

  if (passMatch) pass = Number(passMatch[1]);
  if (failMatch) fail = Number(failMatch[1]);
  if (skipMatch) skip = Number(skipMatch[1]);

  if (passMatch || failMatch) status = fail > 0 ? 'red' : 'green';
} catch {
  status = 'unknown';
}

const payload = {
  project: 'research360',
  timestamp: new Date().toISOString(),
  status,
  pass,
  fail,
  skip,
  duration_ms,
  runner: 'vitest',
  branch,
  commit,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, JSON.stringify(payload, null, 2) + '\n');

console.log(`\n✔ wrote ${outFile}`);
console.log(JSON.stringify(payload, null, 2));

process.exit(result.status ?? 1);
