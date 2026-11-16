# codex-dot-bus

Drive supported Codex and ChatGPT Work threads through the Windows desktop app's
native `codex-app-tools` pipe. **TBO Dot messaging rooms are a different surface:**
the repository name does not mean every Dot can be sent through the thread API.

| Destination | Programmatic support |
|---|---|
| Codex thread with catalog ID and host | Native thread tools |
| ChatGPT Work chat (`kind:"chatgpt"`) | Native thread tools supported by the installed app |
| TBO Dot with Dot ID + room ID + durable root | No room-send tool exposed by the checked 26.1106.6628.0 pipe; use the normal client fallback |

A Dot root may be readable but still return `thread not found` when sent through
`send_message_to_thread`. Do not infer send support from `read_thread`, substitute
a room ID for a thread ID, or blindly navigate/retry. `chatgptWorkCloud` creates a
Work chat, not a TBO Dot.

## Quick start

Requires Windows, a running OpenAI Codex desktop app, Node >=22 and PowerShell.
No npm install is needed. Use native host tools directly when available.

```powershell
git clone https://github.com/tcflying/codex-dot-bus.git
cd codex-dot-bus
node scripts/app-tools-client.mjs list
node scripts/app-tools-client.mjs call send_message_to_thread '{"threadId":"<target>","hostId":"local","prompt":"<authorized message with unique marker>"}' '<existing-sender-thread>'
node scripts/app-tools-client.mjs call read_thread '{"threadId":"<target>","hostId":"local","turnLimit":3,"includeOutputs":true}' '<existing-sender-thread>'
node scripts/app-tools-client.mjs call wait_threads '{"targets":[{"threadId":"<target>","hostId":"local","afterCursor":"<last-wait-cursor>"}],"timeoutMs":60000}' '<existing-sender-thread>'
```

Use the real target `hostId`; omit `afterCursor` on the first wait. Inspect current
schemas from `list` rather than copying obsolete `threadIds` examples. Sender
context must identify an existing authorized Codex thread. Do not invent a sender
or use direct IPC to bypass an approval requirement.

The client rediscovers the pipe and verifies its owner as the packaged
`ChatGPT.exe`. A call prints the original result in `raw`; protocol failure exits
nonzero. The client does not convert a failed request into a successful send.

## Delivery is not completion

1. Accepted tool call: submitted only.
2. New matching target turn or room message with author/message/request IDs: delivered.
3. Matching destination assistant ACK/answer: replied.
4. Requested operation's actual result: completed.

Prefer programmatic send/readback. Only when that route cannot establish delivery
or replies, use computer use on the exact destination in the normal signed-in
client. Read back the populated draft, actually submit it, and confirm the real
message and reply. Filling an input, clicking an unverified button, or a human
clicking Send is not proof of an autonomous programmatic send. Report human help
accurately and never duplicate an unknown-outcome request.

Do not implement room sending by stripping app-attest/Sentinel preparation from
the normal client's message API. A missing public pipe tool is a real capability
boundary, not permission to bypass runtime integrity checks.

The official delegation wrapper XML-escapes `<input>`. Decode that wrapper's text
once before executing original code; do not execute `&amp;` / `&gt;=` as operators
or repeatedly HTML-unescape arbitrary user source. The bundled client itself
JSON-serializes prompts without HTML encoding.

## Files and installation

- [SKILL.md](SKILL.md): minimal routing, verification, failure recovery and scope rules.
- [scripts/app-tools-client.mjs](scripts/app-tools-client.mjs): native pipe client.
- [scripts/pipe-owner.ps1](scripts/pipe-owner.ps1): pipe discovery and server identity.
- [scripts/app-tools-client.test.mjs](scripts/app-tools-client.test.mjs): targeted result/exit-code checks.

Copy or symlink this repository into an agent's skill folder, for example
`<CODEX_HOME>/skills/codex-dot-bus`, `~/.agents/skills/codex-dot-bus`, or
`~/.zcode/skills/codex-dot-bus`.

```powershell
node --test scripts/app-tools-client.test.mjs
```

## Verified boundaries

Historical supported Work-thread round trips used desktop 26.1021.x/26.1023.x.
The 26.1106.6628.0 investigation verified current pipe discovery, TBO Dot root/send
mismatch, normal-client room send and ACK, and XML escaping in native delegation.
It did **not** establish a programmatic TBO room-send API or reliable unattended
resumption. Custom instructions do not create a scheduler: a promised later check
needs an actual scheduling receipt and subsequent execution evidence.

Tool availability, approval gates and schemas depend on the app version. Recheck
after updates. Keep credentials and private chat identities out of this repository.

## License

MIT — see [LICENSE](LICENSE).
