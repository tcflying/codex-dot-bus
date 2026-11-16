// Explicit opt-in live-model proof. It edits only a new, isolated fixture workspace.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { init, atomicJSON } from './task-runner.mjs';

const flags = Object.fromEntries(process.argv.slice(2).reduce((pairs, item, i, all) =>
  i % 2 ? pairs : [...pairs, [item, all[i + 1]]], []));
if (!flags['--root'] || !flags['--codex'] || !flags['--model'] || !flags['--provider'])
  throw new Error('Usage: node scripts/prove-task-runner.mjs --root <NEW-absolute-directory> --codex <native-executable> --model <model> --provider <configured-provider>');
const base = path.resolve(flags['--root']);
await fs.mkdir(base); // Never reuse an existing workspace or proof.
const work = path.join(base, 'work');
const verify = path.join(base, 'verification');
const stateDir = path.join(base, 'state');
await fs.mkdir(work); await fs.mkdir(verify);
const source = path.join(work, 'sum.mjs');
const before = 'export function total(values) { return values.slice(0, -1).reduce((sum, value) => sum + value, 0); }\n';
await fs.writeFile(source, before);
await fs.writeFile(path.join(work, 'AGENTS.md'), 'This is an isolated bug-fix fixture. Edit only sum.mjs. Do not spawn agents or change any configuration. Use PowerShell explicitly on Windows.\n');
const checker = path.join(verify, 'acceptance.mjs');
await fs.writeFile(checker, `import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { total } = await import(pathToFileURL(path.join(process.argv[2], 'sum.mjs')));
for (const [input, expected] of [[[], 0], [[4], 4], [[2, 3], 5], [[-7, 2, 1], -4], [[0.5, 1.25], 1.75]]) {
  const copy = [...input]; assert.equal(total(input), expected); assert.deepEqual(input, copy);
}
console.log('PASS: five independent cases; no input mutation');\n`);
const spec = { version: 1, workspace: work,
  objective: 'Fix total(values) in sum.mjs so it sums ALL numbers, returns zero for empty input, and never mutates input. Make the minimal code change now. Do not add files or ask for confirmation.',
  backend: { kind: 'codex', executable: path.resolve(flags['--codex']), model: flags['--model'], provider: flags['--provider'],
    disabledMcpServers: ['codegraph', 'ima', 'web-search-exa', 'videotono', 'node_repl', 'browseros-neo'] },
  acceptance: { cwd: verify, argv: [process.execPath, checker, work], files: [checker] },
  maxRepairAttempts: 2, maxRepeatedFailures: 2, totalTimeoutMs: 900000, commandTimeoutMs: 600000 };
const specFile = path.join(base, 'task-spec.json');
await atomicJSON(specFile, spec); await init(specFile, stateDir);
const runner = fileURLToPath(new URL('./task-runner.mjs', import.meta.url));
function controller(label) {
  const child = spawn(process.execPath, [runner, 'run', stateDir], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  child.stdout.on('data', b => { output += b; process.stdout.write(b); });
  child.stderr.on('data', b => { output += b; process.stderr.write(b); });
  const finished = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', async code => { await fs.writeFile(path.join(base, `${label}.log`), output); resolve(code); });
  });
  return { child, finished };
}
const first = controller('controller-before-restart');
let interruptedAttempt;
const deadline = Date.now() + 60000;
while (Date.now() < deadline) {
  const state = JSON.parse(await fs.readFile(path.join(stateDir, 'state.json'), 'utf8'));
  if (state.active?.kind === 'repair') {
    try {
      const started = JSON.parse(await fs.readFile(path.join(stateDir, 'attempts', state.active.id, 'started.json'), 'utf8'));
      await fs.stat(path.join(stateDir, 'attempts', state.active.id, 'executor.log'));
      interruptedAttempt = { id: state.active.id, workerPid: started.pid, controllerPid: first.child.pid };
      break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (['blocked', 'completed'].includes(state.status)) break;
  await new Promise(resolve => setTimeout(resolve, 50));
}
assert.ok(interruptedAttempt, 'The real model attempt must start before interrupting its controller');
first.child.kill('SIGKILL'); await first.finished;
await atomicJSON(path.join(base, 'restart.json'), { ...interruptedAttempt, interruptedAt: new Date().toISOString() });
console.log(`Restarting controller; preserving attempt ${interruptedAttempt.id}`);
const second = controller('controller-after-restart');
const code = await second.finished;
const state = JSON.parse(await fs.readFile(path.join(stateDir, 'state.json'), 'utf8'));
const after = await fs.readFile(source, 'utf8');
const evidence = { checkedAt: new Date().toISOString(), backend: 'real Codex CLI', model: spec.backend.model,
  provider: spec.backend.provider, status: state.status, reason: state.reason, code, interruptedAttempt,
  attempts: state.history.map(r => ({ id: r.id, kind: r.kind, executorCode: r.executor?.code,
    acceptanceCode: r.check?.code, output: r.check?.output, error: r.error })),
  repairs: state.repairs, before, after,
  beforeSha256: createHash('sha256').update(before).digest('hex'), afterSha256: createHash('sha256').update(after).digest('hex') };
await atomicJSON(path.join(base, 'evidence.json'), evidence);
assert.equal(code, 0, `Live proof failed: ${state.reason}`);
assert.equal(state.status, 'completed');
assert.equal(state.repairs, 1, 'Controller restart must not cause another dispatch');
assert.deepEqual(state.history.map(r => r.check.code), [1, 0]);
assert.equal(state.history[1].id, interruptedAttempt.id);
assert.notEqual(before, after);
console.log(`LIVE PROOF PASSED: ${path.join(base, 'evidence.json')}`);
