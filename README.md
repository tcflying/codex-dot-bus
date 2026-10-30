# codex-dot-bus

**Drive OpenAI Codex desktop threads and coordinate Codex ↔ ChatGPT ("dot") cloud
threads from any IDE, agent, or script on Windows — through the app's native
`codex-app-tools` named pipe.**

One pipe, both thread kinds:

- `kind:"codex"` — local Codex tasks (your coding agents)
- `kind:"chatgpt"` — ChatGPT cloud threads ("dot")

Any local process (ZCode, Claude Code, Cursor, a cron job, another Codex agent)
can `create_thread`, `send_message_to_thread`, `read_thread`, and `wait_threads`
on either kind. A Codex agent can do the same from inside its own turn, which
enables the relay pattern: **IDE → Codex foreman thread → dot cloud thread →
back**, supervised in a loop for long-running projects.

## What's in the box

- `SKILL.md` — the agent-facing skill: **complete end-to-end walkthrough** (setup →
  dispatch → gates → polling → acceptance → sustained operation), wire protocol,
  tool reference, a battle-tested codex→dot relay dispatch template, authorization
  and approval-gate handling, interruption/model recovery plays, field-verified
  gotcha index, blind-marker acceptance, and safety rules. Any agent-skills-compatible
  IDE (Claude Code, ZCode, Cursor, …) can load it as-is.
- `scripts/app-tools-client.mjs` — portable Node ≥22 client (no npm deps).
  Discovers the pipe, validates the owner, frames JSON-RPC, calls tools.
- `scripts/pipe-owner.ps1` — pipe enumeration + named-pipe server PID resolution.

## Quick start

```bash
git clone https://github.com/tcflying/codex-dot-bus.git
cd codex-dot-bus

# 1) Prove the bus (ChatGPT desktop app must be running):
node scripts/app-tools-client.mjs list | head -40    # bash; PowerShell: | Select-Object -First 40

# 2) Send a command to a codex thread (arg 3 = any existing codex thread id,
#    used as the call envelope context):
node scripts/app-tools-client.mjs call send_message_to_thread \
  '{"threadId":"<codex-thread-id>","prompt":"Run the test suite and report exit codes"}' \
  <codex-thread-id>

# 3) Read it back (delivery + reply evidence):
node scripts/app-tools-client.mjs call read_thread \
  '{"threadId":"<codex-thread-id>","turnLimit":3,"includeOutputs":true}' \
  <codex-thread-id>
```

## Install as an agent skill

Copy/symlink this directory into your agent's skills folder:

| Agent | Location |
|---|---|
| ZCode | `~/.zcode/skills/codex-dot-bus/` |
| Claude Code | `~/.claude/skills/codex-dot-bus/` (or `~/.agents/skills/`) |
| Codex CLI | `<CODEX_HOME>/skills/codex-dot-bus/` |
| Generic | any dir your agent scans for `SKILL.md` |

The `description` frontmatter tells the agent when to reach for it; the body is
self-contained operating instructions.

## Field-verified facts baked into the skill

Verified live against ChatGPT desktop (OpenAI Codex MSIX) 26.1021.x / 26.1023.x:

- Full external round trip: pipe client → codex thread (ACK) and → dot cloud
  thread (challenge ACK with fresh marker).
- In-app Codex agent → dot relay: agent-driven `send_message_to_thread` +
  `read_thread` read-back, receipts reported verbatim.
- The gotchas that break naive integrations: pipe re-randomization on app
  restart, `notLoaded` threads rejecting sends (fix: `navigate_to_codex_page`),
  envelope-thread rules for `tools/call` and `wait_threads`, model-name routing
  differences (account backend vs local gateway), 3–8 min dot cloud turn lag,
  the six `approval_mode:"prompt"` tools, and the human-authorization policy
  gate for agent-initiated cross-thread sends.

## Limitations

- Windows only (named pipes). The desktop app must be running.
- The pipe is a local, unauthenticated-by-design IPC surface of a logged-in
  desktop app: anyone with a local session can use it. The client therefore
  validates the pipe owner (packaged `ChatGPT.exe`) before every write, and the
  skill's safety rules forbid touching threads you did not create.
- Tool surface follows the app version; re-run `list` after app updates.

## License

MIT — see [LICENSE](LICENSE).
