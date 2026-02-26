import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type OpenClawGatewayConfig = {
  url: string;
  token: string;
  agentId: string;
  sessionKey: string;
  rpcTimeoutMs: number;
  responseTimeoutMs: number;
};

type ExecLike = (
  file: string,
  args: string[],
  options: { maxBuffer: number; timeout: number }
) => Promise<{ stdout: string; stderr: string }>;

export function getOpenClawGatewayConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OpenClawGatewayConfig {
  const agentId = env.OPENCLAW_AGENT_ID || 'main';
  return {
    url: env.OPENCLAW_GATEWAY_URL || '',
    token: env.OPENCLAW_GATEWAY_TOKEN || '',
    agentId,
    sessionKey: env.OPENCLAW_GATEWAY_SESSION_KEY || `agent:${agentId}:clawscreen-a2ui`,
    rpcTimeoutMs: Number(env.OPENCLAW_GATEWAY_RPC_TIMEOUT_MS || 30000),
    responseTimeoutMs: Number(env.OPENCLAW_GATEWAY_RESPONSE_TIMEOUT_MS || 45000)
  };
}

export function createOpenClawGateway(config: OpenClawGatewayConfig, exec: ExecLike = execFileAsync as ExecLike) {
  async function call(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const args = ['gateway', 'call', method, '--json', '--params', JSON.stringify(params), '--timeout', String(config.rpcTimeoutMs)];
    if (config.url) args.push('--url', config.url);
    if (config.token) args.push('--token', config.token);

    try {
      const { stdout, stderr } = await exec('openclaw', args, {
        maxBuffer: 1024 * 1024 * 2,
        timeout: config.rpcTimeoutMs + 2000
      });

      if (stderr && stderr.trim()) console.warn(`[clawscreen] gateway stderr: ${stderr.trim()}`);
      return JSON.parse(stdout || '{}');
    } catch (error: any) {
      const stderr = error?.stderr ? String(error.stderr).trim() : '';
      const stdout = error?.stdout ? String(error.stdout).trim() : '';
      const details = [stderr, stdout].filter(Boolean).join(' | ');
      throw new Error(`gateway call failed (${method})${details ? `: ${details}` : ''}`);
    }
  }

  return {
    config,
    call,
    chatHistory(sessionKey = config.sessionKey): Promise<Record<string, unknown>> {
      return call('chat.history', { sessionKey });
    },
    chatSend(
      payload: {
        message: string;
        deliver: boolean;
        idempotencyKey: string;
        timeoutMs: number;
      },
      sessionKey = config.sessionKey
    ): Promise<Record<string, unknown>> {
      return call('chat.send', { sessionKey, ...payload });
    }
  };
}
