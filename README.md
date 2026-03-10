# ClawScreen

Modern TypeScript app for prompt-to-screen HUD generation via OpenClaw Gateway.

## Stack
- **Frontend:** Vite + TypeScript
- **Backend:** Express + TypeScript
- **Runtime:** Node.js 20+

## Project Structure
- `src/` — frontend TypeScript app
- `server/` — backend TypeScript API bridge
- `dist/client` — built frontend output
- `dist/server` — compiled backend output
- `pi/` — Raspberry Pi kiosk + systemd templates

## Requirements
- Node.js 20+
- OpenClaw installed and running (`openclaw gateway status`)

## Install
```bash
git clone https://github.com/recursive-systems/clawscreen.git
cd clawscreen
npm install
```

## Development
Run frontend + backend together:
```bash
npm run dev
```

- Frontend: `http://127.0.0.1:18842`
- Backend API: `http://127.0.0.1:18841`

## Production Build
```bash
npm run build
npm run start
```

Backend serves the built frontend from `dist/client`.

## Environment Variables
- `A2UI_PORT` (default: `18841`)
- `A2UI_HOST` (default: `0.0.0.0`)
- `OPENCLAW_GATEWAY_URL` (optional)
- `OPENCLAW_GATEWAY_TOKEN` (optional)
- `OPENCLAW_AGENT_ID` (default: `main`)
- `OPENCLAW_GATEWAY_SESSION_KEY` (default: `agent:<agentId>:clawscreen-a2ui`)
- `OPENCLAW_GATEWAY_RPC_TIMEOUT_MS` (default: `30000`)
- `OPENCLAW_GATEWAY_RESPONSE_TIMEOUT_MS` (default: `45000`)

## API
### `POST /a2ui/generate`
```json
{
  "prompt": "Show me everything I need before leaving in 20 minutes.",
  "context": { "persona": "parent" }
}
```

### `POST /a2ui/action`
Structured action lifecycle endpoint with intent-aware responses. Supports:
- `refresh.request`
- `view.switch`
- `focus.plan`
- `alerts.ack`

### Health Check
- `GET /healthz`

## HUD Quality Pipeline
ClawScreen now enforces quality in two layers:

1. **Server guardrails** (`server/generationGuardrails.ts`)
- Ensures required sections: summary, priorities, timeline, alerts, metric
- Auto-repairs incomplete blocks
- Applies text/list length limits
- Keeps max 10 top-level blocks and preserves required sections when trimming

2. **Frontend composition** (`src/protocol/hudComposer.ts`)
- Converts arbitrary valid payloads into a robust HUD layout
- Preserves actionable controls while ensuring consistent glanceable structure

## Kiosk and Appliance Mode
### Runtime modes
- `?mode=kiosk` for fixed-location appliance UI
- `?mode=admin` for full controls/debug

Kiosk unlock options:
- Press and hold the clock zone
- `Ctrl/Cmd + Shift + K`

### Raspberry Pi browser kiosk setup
```bash
./pi/setup_kiosk.sh <CLAWSCREEN_HOST_OR_IP> [PORT]
```

### systemd deployment templates
Files:
- `pi/clawscreen.service`
- `pi/clawscreen-watchdog.service`
- `pi/clawscreen-watchdog.timer`

Install on target host:
```bash
sudo ./pi/install_systemd_services.sh
```

## Operational Reliability Features
- Backend health polling and online/offline status badge in HUD
- Data freshness indicators (`fresh`, `aging`, `stale`) based on update timestamps
- Last-known-good and heuristic fallback rendering paths when generation fails

## Quick Test
```bash
npm run test:curl
npm test
npm run typecheck
```

## License
MIT
