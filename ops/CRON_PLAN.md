# Cron Plan (Product OS)

Timezone: America/Chicago

## 1) Daily planning + dispatch (Mon-Fri 09:00)
- Select top 1-2 items from `ops/ROADMAP.yaml`
- Send implementation brief to `agent:dev:discord:channel:1475880024111583243`
- Post short plan update in #clawscreen

## 2) Midday health check (Daily 13:00)
- Verify:
  - `GET /healthz` on 18841
  - `POST /a2ui/generate` smoke success
  - no recent EADDRINUSE/polling-loop errors in dev log
- Post pass/fail + key issue if failed

## 3) Evening verify + ship report (Daily 18:00)
- Run `npm test`, `npm run typecheck`, `npm run build`
- Report shipped commits + preview links

## 4) Weekly roadmap sync (Sun 19:00)
- Summarize progress by lane (reliability/interaction/trust_ux)
- Propose next 3 priorities
