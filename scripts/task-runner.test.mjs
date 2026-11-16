import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { init, run, status, atomicJSON } from './task-runner.mjs';

const runner = fileURLToPath(new URL('./task-runner.mjs', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, body = "await fs.writeFile('answer.txt', '42');", options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'dot-runner-test-'));
  const workspace = path.join(base, 'work');
  const verifier = path.join(base, 'verify');
  await fs.mkdir(workspace); await fs.mkdir(verifier);
  const check = path.join(verifier, 'check.mjs');
  await fs.writeFile(check, `import fs from 'node:fs/promises'; import path from 'node:path';
try { if ((await fs.readFile(path.join(process.argv[2], 'answer.txt'), 'utf8')) !== '42') throw Error(); }
catch { console.error('Expected answer 42'); process.exitCode = 1; }`);
  const worker = path.join(verifier, 'worker.mjs');
  await fs.writeFile(worker, `import fs from 'node:fs/promises';
await fs.appendFile('dispatches.txt', process.env.TASK_ATTEMPT + '\\n');
${body}`);
  const spec = { version: 1, workspace, objective: 'Repair answer.txt to contain exactly 42.',
    backend: { kind: 'command', argv: [process.execPath, worker] },
    acceptance: { cwd: verifier, argv: [process.execPath, check, workspace], files: [check] },
    commandTimeoutMs: 10000, totalTimeoutMs: 30000, maxRepairAttempts: 3, maxRepeatedFailures: 2,
    ...options };
  const specFile = path.join(base, 'spec.json');
  const state = path.join(base, 'state');
  await atomicJSON(specFile, spec);
  t.after(async () => { await fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  return { base, workspace, verifier, check, worker, spec, specFile, state };
}
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(50); }
  throw new Error('Timed out waiting for test condition');
}
test('failed precheck automatically repairs and collects independent success', async t => {
  const f = await fixture(t);
  await init(f.specFile, f.state);
  const result = await run(f.state, { pollMs: 30 });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.history.map(r => r.check.code), [1, 0]);
  assert.equal(result.repairs, 1);
  assert.equal(await fs.readFile(path.join(f.workspace, 'dispatches.txt'), 'utf8'), '1\n');
  const replay = await run(f.state);
  assert.equal(replay.repairs, 1);
  assert.equal((await status(f.state)).history.length, 2);
});
test('worker saying done is not success; unchanged failure blocks within budget', async t => {
  const f = await fixture(t, "console.log('All done, tests passed!');");
  await init(f.specFile, f.state);
  const result = await run(f.state, { pollMs: 30 });
  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /Repeated failure/);
  assert.equal(result.repairs, 2);
  assert.ok(result.history.every(r => r.check.code === 1));
});
test('failed first repair continues to a second repair without caller input', async t => {
  const f = await fixture(t, "if (process.env.TASK_ATTEMPT === '2') await fs.writeFile('answer.txt', '42');");
  await init(f.specFile, f.state);
  const result = await run(f.state, { pollMs: 30 });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.history.map(r => r.check.code), [1, 1, 0]);
});
test('controller crash releases lock; resumed controller collects same worker once', async t => {
  const f = await fixture(t, "await new Promise(r => setTimeout(r, 1800)); await fs.writeFile('answer.txt', '42');");
  await init(f.specFile, f.state);
  const controller = spawn(process.execPath, [runner, 'run', f.state], { stdio: 'ignore', windowsHide: true });
  const exited = new Promise(resolve => controller.once('exit', resolve));
  await until(async () => {
    try { return (await fs.readFile(path.join(f.workspace, 'dispatches.txt'), 'utf8')) === '1\n'; } catch { return false; }
  });
  await assert.rejects(run(f.state), /Controller lock unavailable/);
  controller.kill('SIGKILL'); await exited;
  const result = await run(f.state, { pollMs: 30 });
  assert.equal(result.status, 'completed');
  assert.equal(result.repairs, 1);
  assert.equal(await fs.readFile(path.join(f.workspace, 'dispatches.txt'), 'utf8'), '1\n');
});
test('uncertain launch is blocked, never submitted again', async t => {
  const f = await fixture(t); await init(f.specFile, f.state);
  const stateFile = path.join(f.state, 'state.json');
  const s = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  s.deadline = Date.now() + 20000;
  s.active = { id: 'uncertain', token: 'same-token', kind: 'repair', launchedAt: Date.now() - 20000 };
  s.status = 'running'; s.repairs = 1;
  await fs.mkdir(path.join(f.state, 'attempts', 'uncertain'));
  await atomicJSON(stateFile, s);
  const result = await run(f.state, { pollMs: 30 });
  assert.equal(result.status, 'blocked'); assert.match(result.reason, /outcome unknown/);
  await assert.rejects(fs.stat(path.join(f.workspace, 'dispatches.txt')), { code: 'ENOENT' });
});
test('tampering with the external verifier cannot produce success', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.worker, `import fs from 'node:fs/promises'; await fs.writeFile(${JSON.stringify(f.check)}, 'process.exit(0)');`);
  await init(f.specFile, f.state);
  const result = await run(f.state, { pollMs: 30 });
  assert.equal(result.status, 'blocked'); assert.match(result.reason, /Acceptance input changed/);
});
test('timed out worker is stopped and not automatically replayed', async t => {
  const f = await fixture(t, 'await new Promise(r => setTimeout(r, 60000));', { commandTimeoutMs: 600 });
  await init(f.specFile, f.state);
  const result = await run(f.state, { pollMs: 30 });
  assert.equal(result.status, 'blocked'); assert.match(result.reason, /timed out/);
  assert.equal(result.repairs, 1);
});
test('invalid or overlapping task paths and mutable specs are refused', async t => {
  const f = await fixture(t);
  await assert.rejects(init(f.specFile, path.join(f.workspace, 'state')), /outside the workspace/);
  f.spec.acceptance.files = [path.join(f.workspace, 'own-test.mjs')];
  await fs.writeFile(f.spec.acceptance.files[0], 'process.exit(0)');
  await atomicJSON(f.specFile, f.spec);
  await assert.rejects(init(f.specFile, f.state), /outside workspace/);
  f.spec.acceptance.files = [f.check]; f.spec.backend.kind = 'unknown';
  await atomicJSON(f.specFile, f.spec);
  await assert.rejects(init(f.specFile, f.state), /backend.kind/);
  f.spec.backend.kind = 'command'; await atomicJSON(f.specFile, f.spec); await init(f.specFile, f.state);
  const immutable = path.join(f.state, 'task.json');
  const task = JSON.parse(await fs.readFile(immutable, 'utf8')); task.objective = 'Changed';
  await atomicJSON(immutable, task);
  await assert.rejects(run(f.state), /specification changed/);
});

test('backend failure is recorded without switching models or retrying submission', async t => {
  const f = await fixture(t, "console.error('provider unavailable'); process.exitCode = 19;");
  await init(f.specFile, f.state);
  const result = await run(f.state, { pollMs: 30 });
  assert.equal(result.status, 'blocked'); assert.match(result.reason, /exit 19/);
  assert.equal(result.repairs, 1);
});

test('repair budget bounds changing failures too', async t => {
  const f = await fixture(t, "await fs.writeFile('answer.txt', process.env.TASK_ATTEMPT);", { maxRepairAttempts: 1 });
  await init(f.specFile, f.state);
  const result = await run(f.state, { pollMs: 30 });
  assert.equal(result.status, 'blocked'); assert.equal(result.reason, 'Repair budget exhausted');
  assert.equal(result.repairs, 1);
});

test('a dead attempt without a receipt is not repeated', async t => {
  const f = await fixture(t); await init(f.specFile, f.state);
  const stateFile = path.join(f.state, 'state.json');
  const s = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  s.deadline = Date.now() + 20000;
  s.active = { id: 'dead', token: 'same-token', kind: 'repair', launchedAt: Date.now() };
  s.status = 'running'; s.repairs = 1;
  await fs.mkdir(path.join(f.state, 'attempts', 'dead'));
  await atomicJSON(path.join(f.state, 'attempts', 'dead', 'started.json'), { id: 'dead', token: 'same-token', pid: -1 });
  await atomicJSON(stateFile, s);
  const result = await run(f.state, { pollMs: 30 });
  assert.equal(result.status, 'blocked'); assert.match(result.reason, /without a receipt/);
  await assert.rejects(fs.stat(path.join(f.workspace, 'dispatches.txt')), { code: 'ENOENT' });
});

test('junction workspace is rejected before any execution', async t => {
  const f = await fixture(t);
  const link = path.join(f.base, 'linked-work');
  await fs.symlink(f.workspace, link, process.platform === 'win32' ? 'junction' : 'dir');
  f.spec.workspace = link; await atomicJSON(f.specFile, f.spec);
  await assert.rejects(init(f.specFile, f.state), /Symlink\/junction/);
});
