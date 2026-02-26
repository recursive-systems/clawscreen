# ClawScreen — A2UI Prompt-to-Screen v1

This prototype now uses an **OpenClaw-native backend bridge** (no direct OpenAI key required):

`HUD prompt -> POST /a2ui/generate -> local bridge -> OpenClaw Gateway RPC -> configured model backend -> normalized/safe A2UI JSON -> HUD render`

## What changed

- Replaced OpenAI SDK bridge with OpenClaw Gateway RPC bridge
- Kept frontend-compatible endpoint: `POST /a2ui/generate`
- Uses local OpenClaw auth/config (`openclaw gateway`) by default
- Supports optional explicit gateway overrides via env (`OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`)
- Prompts model for strict JSON, then server-side normalizes + validates to A2UI shape
- Preserves output safety filtering against script/event-handler/javascript URL injection
- Removed `OPENAI_API_KEY` requirement from normal operation

## Files

- `app.js` — frontend endpoint candidates (already bridge-first)
- `backend/server.js` — OpenClaw gateway bridge, normalization, safety filtering
- `backend/static-server.js` — static frontend host for split-port dev
- `package.json` — scripts/dependencies (OpenAI SDK removed)

## Requirements

- Node.js 20+
- OpenClaw installed and gateway running on host

### Required for normal operation

- `openclaw gateway status` must show **running**
- Gateway must be reachable by this machine/process

### Optional environment variables

- `A2UI_PORT` (default: `18841`)
- `A2UI_HOST` (default: `0.0.0.0`)
- `FRONTEND_PORT` (default: `18842`)
- `FRONTEND_HOST` (default: `0.0.0.0`)
- `OPENCLAW_GATEWAY_URL` (optional override; example: `ws://127.0.0.1:18789`)
- `OPENCLAW_GATEWAY_TOKEN` (optional override; uses local config if unset)
- `OPENCLAW_AGENT_ID` (default: `main`)
- `OPENCLAW_GATEWAY_SESSION_KEY` (default: `agent:<agentId>:clawscreen-a2ui`)
- `OPENCLAW_GATEWAY_RPC_TIMEOUT_MS` (default: `30000`)
- `OPENCLAW_GATEWAY_RESPONSE_TIMEOUT_MS` (default: `45000`)

## Install

```bash
git clone https://github.com/recursive-systems/clawscreen.git
cd clawscreen
npm install
```

## Run (option A: backend serves HUD + API on one port)

```bash
npm run start:backend
```

Open: `http://127.0.0.1:18841/`

## Run (option B: split frontend/backend ports)

Terminal 1:
```bash
npm run start:backend
```

Terminal 2:
```bash
npm run start:frontend
```

Open: `http://127.0.0.1:18842/`

(Frontend calls backend at `/a2ui/generate` or `http://127.0.0.1:18841/a2ui/generate`.)

## API contract

### Request

`POST /a2ui/generate`

```json
{
  "prompt": "Show me everything I need before leaving in 20 minutes.",
  "context": {
    "now": "2026-02-26T18:00:00.000Z",
    "persona": "parent"
  }
}
```

### Success response shape

```json
{
  "ok": true,
  "provider": "openclaw-gateway",
  "a2ui": {
    "version": "0.8",
    "screen": {
      "title": "...",
      "subtitle": "...",
      "blocks": []
    }
  }
}
```

### Gateway unavailable response

```json
{
  "ok": false,
  "error": {
    "code": "gateway_unavailable",
    "message": "..."
  }
}
```

## Live curl test

Start backend:

```bash
npm run start:backend
```

Then in another terminal:

```bash
curl -sS -X POST http://127.0.0.1:18841/a2ui/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Show me everything I need before leaving in 20 minutes.","context":{"persona":"parent"}}' | jq .
```

Expected: `ok: true`, `provider: "openclaw-gateway"`, and `a2ui.screen.blocks` populated.

## Troubleshooting

### 1) Gateway not running / unreachable

```bash
openclaw gateway status
openclaw gateway start
```

If needed, set explicit URL/token:

```bash
export OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
export OPENCLAW_GATEWAY_TOKEN=<token>
npm run start:backend
```

### 2) Slow response / timeout

Increase timeouts:

```bash
export OPENCLAW_GATEWAY_RPC_TIMEOUT_MS=45000
export OPENCLAW_GATEWAY_RESPONSE_TIMEOUT_MS=90000
npm run start:backend
```

### 3) Bridge returns fallback summary only

Model output may have been malformed or non-JSON. The bridge enforces strict parse + normalization and falls back safely.

### 4) Session key / agent mismatch

If using non-default agent, set both consistently:

```bash
export OPENCLAW_AGENT_ID=product
export OPENCLAW_GATEWAY_SESSION_KEY=agent:product:clawscreen-a2ui
npm run start:backend
```

## Safety notes

- Backend enforces normalized A2UI-compatible JSON shape
- Block types are constrained/coerced (`text`, `list`, `metric`, `card`, `notes`, `divider`)
- Dangerous patterns are stripped from text (`<script>`, `javascript:`, inline `on*=` handlers)
- No eval/script execution path in backend output
