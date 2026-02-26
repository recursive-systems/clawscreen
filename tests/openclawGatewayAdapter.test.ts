import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenClawGateway, type OpenClawGatewayConfig } from '../server/adapters/openclawGateway';

test('openclaw gateway adapter builds CLI call with configured transport options', async () => {
  const calls: Array<{ file: string; args: string[]; options: { maxBuffer: number; timeout: number } }> = [];
  const config: OpenClawGatewayConfig = {
    url: 'https://gateway.example',
    token: 'secret-token',
    agentId: 'main',
    sessionKey: 'agent:main:clawscreen-a2ui',
    rpcTimeoutMs: 3210,
    responseTimeoutMs: 45000
  };

  const gateway = createOpenClawGateway(config, async (file, args, options) => {
    calls.push({ file, args, options });
    return { stdout: '{"ok":true}', stderr: '' };
  });

  await gateway.chatSend({ message: 'hi', deliver: false, idempotencyKey: 'id-1', timeoutMs: 9000 }, 'session-x');

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.file, 'openclaw');
  assert.equal(call.options.timeout, 5210);
  assert.ok(call.args.includes('--url'));
  assert.ok(call.args.includes('https://gateway.example'));
  assert.ok(call.args.includes('--token'));
  assert.ok(call.args.includes('secret-token'));

  const paramsIndex = call.args.indexOf('--params');
  assert.ok(paramsIndex >= 0);
  const parsedParams = JSON.parse(call.args[paramsIndex + 1]);
  assert.deepEqual(parsedParams, {
    sessionKey: 'session-x',
    message: 'hi',
    deliver: false,
    idempotencyKey: 'id-1',
    timeoutMs: 9000
  });
});

test('openclaw gateway adapter wraps transport failures with method context', async () => {
  const config: OpenClawGatewayConfig = {
    url: '',
    token: '',
    agentId: 'main',
    sessionKey: 'agent:main:clawscreen-a2ui',
    rpcTimeoutMs: 1000,
    responseTimeoutMs: 2000
  };

  const gateway = createOpenClawGateway(config, async () => {
    throw { stderr: 'rpc failed', stdout: 'trace-id=abc' };
  });

  await assert.rejects(
    () => gateway.call('chat.history', { sessionKey: config.sessionKey }),
    /gateway call failed \(chat\.history\): rpc failed \| trace-id=abc/
  );
});
