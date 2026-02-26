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
- `pi/` — optional Raspberry Pi kiosk scripts

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

### Health Check
- `GET /healthz`

## Quick Test
```bash
npm run test:curl
```

## License
MIT
