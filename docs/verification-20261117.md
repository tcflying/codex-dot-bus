# Durable execution verification — 2026-11-17

The local runner was exercised on Windows with Node 24.22.1 and Codex CLI 0.167.0.
This report separates deterministic tests from an actual model run.

## Deterministic regression tests

`node --test scripts/app-tools-client.test.mjs scripts/task-runner.test.mjs`

**15 passed, 0 failed.** These cover native-client failure reporting, automatic
repair, a failed repair followed by another repair, refusal of a prose-only
success, controller crash/recovery, exclusive locking, uncertain/dead attempts,
verification tampering, timeout handling, backend failures, bounded attempts,
changed task specifications, junction rejection, and detached background start.
The added background-start check exposed a reserved Windows TCP-port collision;
Windows locking now uses an OS-owned named pipe. All 15 tests pass with that fix.

## Actual model, automatic repair and controller restart

The committed `scripts/prove-task-runner.mjs` harness invoked the real
`group/subagent-only` model through the existing `magpie` provider. It did not use
the command-fixture backend. No extra prompt or manual source edit was supplied
after the harness started.

| Observed event | Result |
|---|---|
| External check before repair | Exit 1; `total([4])` returned 0, expected 4 |
| Real Codex repair dispatched | One repair attempt |
| Harness killed its own controller | Attempt worker continued |
| Replacement controller resumed the same state | Same repair attempt ID, no redispatch |
| Model process completed | Exit 0 |
| Original external check reran | Exit 0; five cases and no input mutation |
| Final persisted task state | `completed`, `repairs: 1` |

Completed at **2026-11-16T17:44:41.287Z** (2026-11-17 01:44:41 Asia/Shanghai).
After changing the Windows lock to a named pipe, a second fresh live-model run
completed at **2026-11-16T17:51:50.328Z** (2026-11-17 01:51:50 Asia/Shanghai),
again with check exits **1 → 0**, exactly **one** repair dispatch, and the same
attempt retained across the deliberate controller restart. The source hashes
below matched in both runs.
The model also encountered and corrected a patch-command error during its own
run. The controller did not need a user to tell it to continue.

The actual source change was:

```diff
-export function total(values) { return values.slice(0, -1).reduce((sum, value) => sum + value, 0); }
+export function total(values) { return values.reduce((sum, value) => sum + value, 0); }
```

SHA-256 before: `4c4bafc925f48a6293ec058a1ef854cd2f04314080f60782fe71fe61519c31ea`  
SHA-256 after: `ae12f31d240a107520d7bddd8cea677e515080e3195ccb996b49f1c9b3d984d4`

The private run retains `evidence.json`, immutable task inputs, controller logs,
and each attempt's start/result receipts. Account configuration, local paths and
raw model logs are deliberately not included in this repository. The harness
creates fresh evidence for anyone repeating the test with their own provider.

## Scope

This proves the **local** failed-check → model repair → independent verification
→ persisted result path, including one controller crash. The test is a small
isolated code defect, not a production deployment or a broad model benchmark.
Deterministic tests separately prove that a failed first repair triggers a
second repair within budget.

It does not create a TBO messaging API, repair an inaccessible cloud scheduler,
or automatically deliver a result to a Dot room. A task must first be explicitly
handed to the local runner. `completed` describes the recorded check at that
time; later edits require a new authorized task, not reuse of an old success.
