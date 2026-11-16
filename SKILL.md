---
name: codex-dot-bus
description: Send and verify authorized messages between supported Codex and ChatGPT Work threads through the Windows desktop app's native pipe. Identify TBO Dot messaging rooms separately; use the normal signed-in client only when the programmatic route cannot establish delivery or replies.
---

# Codex Dot Bus — minimal router

Use the native programmatic route first. Resolve the destination type, send once,
and verify the actual response. A populated input box, a click, or a submitted
tool call is not proof that a message was delivered.

## 1. Identify the destination

| Object | Identity | Route |
|---|---|---|
| Codex thread | Catalog thread ID and `hostId` | Native thread tools |
| ChatGPT Work chat | Catalog `kind:"chatgpt"` ID | Native thread tools supported by the current app |
| TBO Dot | Dot/TBO ID, messaging room ID, and possibly a durable root ID | A distinct messaging surface; do not substitute these IDs for a catalog Work chat |

`chatgptWorkCloud` creates a Work chat, not a TBO Dot. A creation receipt's
`clientThreadId` is not necessarily the catalog ID. Re-read the catalog rather
than guessing an ID or selecting another conversation by title alone.

On desktop 26.1106.6628.0, a Dot durable root could return an empty thread summary
from `read_thread`, while `send_message_to_thread` returned `thread not found`.
The enumerated app-tools pipe did not expose a Dot room messaging tool. A readable
root is therefore not proof of a supported sending route. Do not repeat that
send or navigate/retry blindly. The bundled client has no `send-dot` room API.

## 2. Discover and send through the native route

Requires Windows, the running OpenAI Codex desktop app, Node >=22 and PowerShell.
No npm dependencies. Use the host's native tools when already available; otherwise
use `scripts/app-tools-client.mjs`. It rediscovers the pipe and validates its
owner as packaged `ChatGPT.exe` under `WindowsApps/OpenAI.Codex_*`.

```powershell
node scripts/app-tools-client.mjs list
node scripts/app-tools-client.mjs call send_message_to_thread '{"threadId":"<target>","hostId":"local","prompt":"<authorized message with unique marker>"}' '<existing-sender-thread>'
node scripts/app-tools-client.mjs call read_thread '{"threadId":"<target>","hostId":"local","turnLimit":3,"includeOutputs":true}' '<existing-sender-thread>'
node scripts/app-tools-client.mjs call wait_threads '{"targets":[{"threadId":"<target>","hostId":"local","afterCursor":"<last-wait-cursor>"}],"timeoutMs":60000}' '<existing-sender-thread>'
```

Inspect current tool schemas from `list`; older examples using `threadIds` for
`wait_threads` are obsolete on this app version. Omit `afterCursor` for the first
wait, then reuse the returned cursor. The sender context must be a real authorized
Codex thread, not an invented UUID or an unrelated identity. For a wait, use a
sender context different from the target. Omit model overrides unless requested.

Wire format: 4-byte little-endian length + UTF-8 JSON-RPC 2.0. The `tools/call`
envelope contains `namespace:"codex_app"`, `tool`, `arguments`, sender `threadId`,
unique `callId`/`turnId`, and `callerSource:"codex"`. This is source attribution,
not permission to impersonate a different caller or bypass approval.

The native result uses `success` and `contentItems`; the client preserves it in
`raw`. CLI protocol failures exit nonzero and retain the original error text.
Do not classify arbitrary text containing the word “error” as a failure.

## 3. Verify delivery and completion

- **Submitted:** the sending tool accepted the call. A returned thread ID proves
  only this stage.
- **Delivered:** a new matching target turn, or a real room message with the
  expected marker, author, message ID and request ID, is read back.
- **Replied:** the destination assistant returns a matching ACK or answer.
- **Completed:** the requested operation has its own result and appropriate
  execution evidence. ACK is not completion.

Record who performed each action. If the operator clicked Send after the agent
filled a draft, report a human-assisted send. A GUI action labelled successful
or `unverifiable` is not a message receipt. Never resend while delivery is unknown.
Re-read the target first; reject old turns, unrelated markers, and text merely
quoting the requested result.

## 4. Use the normal client only when the programmatic route cannot verify it

For a TBO Dot room unsupported by the enumerated pipe, use the already signed-in
normal client and computer use. Preserve other drafts and verify the exact Dot.
Fill, read back, submit, then confirm the real room message and assistant reply.
Use programmatic authenticated readback when already available; otherwise confirm
through the normal UI. Do not claim an unsent draft was delivered.

The app's Dot send path validates message metadata, obtains runtime integrity
headers/app-attest or Sentinel data, supplies a stable request/idempotency ID,
and accepts the server's returned message ID. Do not replace it with a bare-token
POST that skips that preparation. Never extract or publish cookies/tokens, forge
integrity state, or install a hypothetical room transport that just returns success.

## 5. Recover the specific failure and continue

- `thread not found`: verify destination type, catalog identity, host, and current
  support. Only reload a supported thread when there is actual `notLoaded`
  evidence. Do not treat every 404 as a loading problem.
- Protocol/command failure: inspect the exact new turn and logs, preserve completed
  work, fix the demonstrated cause, and rerun only the failed necessary part.
- Unknown delivery: read back and wait; do not duplicate the request.
- Human input genuinely required: surface the existing request. Respect previous
  authorization; do not manufacture repeat confirmations or approve a denied action.

The official delegation wrapper can XML-escape its `<input>` text. When extracting
that input, decode **one XML layer** before interpreting or executing the original
message. Do not run `&amp;` or `&gt;=` as operators. Do not repeatedly unescape all
user code: a literal `&amp;` in the original must remain literal after the wrapper
is decoded. This client itself sends JSON and does not HTML-encode the prompt.

For long work, continue the current authorized run using actual wait/read tools.
After completion, consume the result and perform the next necessary step. Custom
instructions are not a scheduler. Never say a later check was scheduled without
an actual scheduling receipt; do not infer it from a promise or an unrelated task
list. If waiting or resumption is unavailable, report the precise limitation rather
than promising unattended continuation. Do not create recurring job monitors just
to compensate for a single stalled run.

## Scope and evidence

Modify or message only explicitly authorized destinations; reusing an existing
thread is valid when authorized. Do not create, archive, re-pin, delete or switch
threads unnecessarily. Follow real approval gates; direct IPC is not a workaround
for missing authorization. Keep credentials and private IDs out of the public repo.

Historical Work-thread round trips were verified on 26.1021.x/26.1023.x. The
26.1106.6628.0 check additionally verified pipe discovery, the TBO Dot type mismatch,
the normal-client room send/ACK path, and the delegation XML encoding. These are
separate claims: none proves that a TBO Dot can be sent through this pipe or will
always resume unattended. After app updates, recheck schema and those boundaries.

Validate local client changes with `node --test scripts/app-tools-client.test.mjs`.
