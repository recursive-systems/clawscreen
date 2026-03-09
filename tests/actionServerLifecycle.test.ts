import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 18941;
const base = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof spawn>;

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('server did not start');
}

test.before(async () => {
  server = spawn('npx', ['tsx', 'server/server.ts'], {
    env: {
      ...process.env,
      A2UI_PORT: String(port),
      OPENCLAW_GATEWAY_RPC_TIMEOUT_MS: '1000',
      OPENCLAW_GATEWAY_RESPONSE_TIMEOUT_MS: '1000'
    },
    stdio: 'ignore'
  });
  await waitForServer();
});

test.after(() => {
  if (server && !server.killed) server.kill('SIGTERM');
});

test('action route supports pause control status', async () => {
  const res = await fetch(`${base}/a2ui/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: '0.8',
      event: { id: 'evt_1', type: 'button.click', timestamp: new Date().toISOString() },
      control: { signal: 'pause' }
    })
  });
  assert.equal(res.ok, true);
  const payload = await res.json() as any;
  assert.equal(payload.task.status, 'paused');
});

test('auth.required returns input_required with negotiated modality', async () => {
  const res = await fetch(`${base}/a2ui/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: '0.8',
      accepted_modalities: ['oauth_redirect', 'form'],
      event: { id: 'evt_2', type: 'auth.required', timestamp: new Date().toISOString() }
    })
  });
  assert.equal(res.ok, true);
  const payload = await res.json() as any;
  assert.equal(payload.task.status, 'input_required');
  assert.equal(payload.task.input_required.modality, 'oauth_redirect');
});

test('task.interrupt returns completed interrupt outcome with payload', async () => {
  const res = await fetch(`${base}/a2ui/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: '0.9',
      event: {
        id: 'evt_interrupt',
        type: 'task.interrupt',
        timestamp: new Date().toISOString(),
        payload: { reason: 'mfa_required', field: 'otp_code' }
      }
    })
  });
  assert.equal(res.ok, true);
  const payload = await res.json() as any;
  assert.equal(payload.task.status, 'completed');
  assert.equal(payload.task.outcome, 'interrupt');
  assert.equal(payload.task.interrupt.reason, 'mfa_required');
  assert.deepEqual(payload.task.interrupt.payload, { reason: 'mfa_required', field: 'otp_code' });
});

test('resume control returns completed success outcome with resume context echoed', async () => {
  const res = await fetch(`${base}/a2ui/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: '0.9',
      event: { id: 'evt_resume', type: 'task.resume', timestamp: new Date().toISOString() },
      control: { signal: 'resume' },
      resume: {
        thread_id: 'thread_123',
        interrupt_id: 'interrupt_evt_interrupt',
        payload: { otp_code: '123456' }
      }
    })
  });
  assert.equal(res.ok, true);
  const payload = await res.json() as any;
  assert.equal(payload.task.status, 'completed');
  assert.equal(payload.task.outcome, 'success');
  assert.equal(payload.task.resume.thread_id, 'thread_123');
  assert.equal(payload.task.resume.interrupt_id, 'interrupt_evt_interrupt');
  assert.equal(payload.task.artifact.messages[1].screen.title, 'Task resumed');
});

test('resume control rejects missing interrupt context', async () => {
  const res = await fetch(`${base}/a2ui/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: '0.9',
      event: { id: 'evt_bad_resume', type: 'task.resume', timestamp: new Date().toISOString() },
      control: { signal: 'resume' }
    })
  });
  assert.equal(res.status, 400);
  const payload = await res.json() as any;
  assert.match(payload.error.message, /resume\.interrupt_id|resume_token/);
});
