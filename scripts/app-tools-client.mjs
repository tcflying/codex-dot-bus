// codex-dot-bus — portable client for the OpenAI Codex desktop `codex-app-tools-*` named pipe.
// Wire: 4-byte little-endian length prefix + UTF-8 JSON-RPC 2.0.
// Every operation re-discovers the pipe (the uuid changes on app restart) and
// validates that the pipe server is ChatGPT.exe from the packaged MSIX install.
// Requires Node >= 22 and PowerShell. No npm dependencies.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const OWNER_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pipe-owner.ps1');

function encodeFrame(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  if (payload.length > MAX_FRAME_BYTES) throw new Error('FRAME_TOO_LARGE');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

function decodeFrames(buffer) {
  const messages = [];
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (length > MAX_FRAME_BYTES) throw new Error('FRAME_TOO_LARGE');
    if (buffer.length < length + 4) break;
    messages.push(JSON.parse(buffer.subarray(4, length + 4).toString('utf8')));
    buffer = buffer.subarray(length + 4);
  }
  return { messages, rest: buffer };
}

/** Enumerate codex-app-tools pipes with their server owner info. */
export function discoverAppToolsPipes() {
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', OWNER_SCRIPT, '-Discover'], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const owners = JSON.parse(raw);
  if (!Array.isArray(owners)) throw new Error('PIPE_DISCOVERY_FAILED');
  const pipes = owners.filter((o) => /^\\\\\.\\pipe\\codex-app-tools-[A-Za-z0-9-]+$/.test(o.pipePath));
  if (pipes.length === 0) {
    throw new Error('NO_APP_TOOLS_PIPE: is the ChatGPT (OpenAI Codex) desktop app running?');
  }
  return pipes;
}

/** Refuse pipes whose server is not the packaged ChatGPT desktop app. */
export function assertTrustedOwner(owner) {
  const exe = (owner.executablePath || '').replace(/\//g, '\\');
  const name = (owner.name || '').toLowerCase();
  if (name !== 'chatgpt.exe' || !/windowsapps\\openai\.codex_/i.test(exe)) {
    throw new Error(`PIPE_IDENTITY_FAILED: server ${name} ${exe} is not the packaged ChatGPT app`);
  }
  return true;
}

/** One JSON-RPC call over the pipe. */
export function requestNative(pipePath, method, params = undefined, timeoutMs = 20000) {
  const id = randomUUID();
  const frame = encodeFrame({ id, jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipePath);
    let pending = Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(() => finish(new Error(`PIPE_TIMEOUT after ${timeoutMs}ms`)), timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      socket.removeAllListeners();
      if (!socket.destroyed) socket.destroy();
    }
    function finish(err, value) {
      if (settled) return;
      settled = true;
      cleanup();
      err ? reject(err) : resolve(value);
    }
    socket.once('connect', () => socket.write(frame));
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      let decoded;
      try {
        decoded = decodeFrames(pending);
      } catch (error) {
        return finish(new Error(`INVALID_PIPE_RESPONSE: ${error.message}`));
      }
      pending = decoded.rest;
      for (const message of decoded.messages) {
        if (message.id !== id) continue;
        if (message.error) {
          return finish(new Error(`APP_RPC_ERROR: ${message.error.message} (code=${JSON.stringify(message.error.code)})`));
        }
        return finish(null, message.result);
      }
    });
    socket.once('error', (error) => finish(new Error(`PIPE_ERROR: ${error.message}`)));
    socket.once('close', () => finish(new Error('PIPE_CLOSED before response')));
  });
}

/** tools/list with owner validation. */
export async function listNativeTools(pipes) {
  const candidates = pipes ?? discoverAppToolsPipes();
  const results = [];
  for (const owner of candidates) {
    try {
      assertTrustedOwner(owner);
      const result = await requestNative(owner.pipePath, 'tools/list', { threadStartKind: 'all' }, 15000);
      results.push({ pipePath: owner.pipePath, pid: owner.processId, tools: result?.tools ?? result });
    } catch (error) {
      results.push({ pipePath: owner.pipePath, pid: owner.processId, error: error.message });
    }
  }
  return results;
}

/** Build the tools/call envelope. `envelopeThreadId` MUST be an existing codex thread. */
export function buildCallParams(tool, args, envelopeThreadId) {
  return {
    arguments: args ?? {},
    callId: `codex-bus-${randomUUID()}`,
    namespace: 'codex_app',
    threadId: envelopeThreadId,
    tool,
    turnId: `codex-bus-${randomUUID()}`,
    callerSource: 'codex',
  };
}

/** Call an app tool with discovery + owner validation. */
export async function callAppTool(tool, args, envelopeThreadId, { timeoutMs = 60000 } = {}) {
  const pipes = discoverAppToolsPipes();
  assertTrustedOwner(pipes[0]);
  const result = await requestNative(pipes[0].pipePath, 'tools/call', buildCallParams(tool, args, envelopeThreadId), timeoutMs);
  const text = result?.contentItems?.find((c) => typeof c?.text === 'string')?.text;
  return { success: result?.success === true, text, raw: result };
}

// CLI:
//   node app-tools-client.mjs list
//   node app-tools-client.mjs call <tool> <json-args> <envelope-codex-thread-id>
async function main() {
  const [cmd, tool, argsJson, envelopeThreadId] = process.argv.slice(2);
  if (cmd === 'list') {
    const results = await listNativeTools();
    process.stdout.write(JSON.stringify(results, null, 2));
    if (results.length === 0 || results.every((r) => r.error)) process.exitCode = 1;
    return;
  }
  if (cmd === 'call') {
    if (!tool) throw new Error('usage: call <tool> <json-args> <envelope-codex-thread-id>');
    if (!envelopeThreadId) {
      throw new Error('envelope thread id required: use an EXISTING codex thread id as call context (random/missing ids are rejected by the app)');
    }
    const args = argsJson ? JSON.parse(argsJson) : {};
    const out = await callAppTool(tool, args, envelopeThreadId);
    process.stdout.write(JSON.stringify(out, null, 2));
    return;
  }
  console.error('usage: app-tools-client.mjs list | call <tool> <json-args> <envelope-codex-thread-id>');
  process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
