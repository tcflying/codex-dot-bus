import assert from 'node:assert/strict';
import test from 'node:test';
import { formatToolResult, main } from './app-tools-client.mjs';

test('protocol failure flags preserve errors and make the CLI fail', async () => {
  const cases = [
    { success: false, contentItems: [{ text: 'Some requested entity was not found: thread not found' }] },
    { isError: true, content: [{ type: 'text', text: 'thread not found' }] },
    { success: true, isError: true, contentItems: [{ text: 'rejected' }] },
    { success: true, contentItems: [{ text: 'The previous error was fixed; thread not found is a quoted example.' }] },
  ];
  for (const raw of cases) {
    const out = formatToolResult(raw);
    assert.equal(out.success, raw.success === true && raw.isError !== true);
    assert.equal(out.raw, raw);
    assert.equal(out.text, (raw.contentItems ?? raw.content)[0].text);
    const originalWrite = process.stdout.write;
    const originalExitCode = process.exitCode;
    let printed = '';
    try {
      process.exitCode = undefined;
      process.stdout.write = (chunk) => { printed += chunk; return true; };
      await main(['call', 'read_thread', '{"threadId":"target"}', 'sender'], async (...args) => {
        assert.deepEqual(args, ['read_thread', { threadId: 'target' }, 'sender']);
        return out;
      });
      assert.deepEqual(JSON.parse(printed), out);
      assert.equal(process.exitCode ?? 0, out.success ? 0 : 1);
    } finally {
      process.stdout.write = originalWrite;
      process.exitCode = originalExitCode;
    }
  }
});

test('an absent success flag cannot be promoted to success', () => {
  assert.equal(formatToolResult(undefined).success, false);
  assert.equal(formatToolResult({ contentItems: [{ text: 'success' }] }).success, false);
});
