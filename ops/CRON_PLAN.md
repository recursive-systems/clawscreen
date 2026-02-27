# Cron Plan (Product OS)

Timezone: America/Chicago

## 1) Daily planning + dispatch (Mon-Fri 09:05)
- Select top 1-2 items from `ops/ROADMAP.yaml`
- Send implementation brief to `agent:dev:discord:channel:1475880024111583243`
- Post short plan update in #clawscreen
- Cron job: `clawscreen-plan-dispatch` (`ba20ffc3-f0f7-40b0-ac5a-d9ad7199dfa8`)

## 2) Midday health check (Daily 13:10)
- Verify:
  - `GET /healthz` on 18841
  - `POST /a2ui/generate` smoke success
  - no recent EADDRINUSE/polling-loop errors in dev log
- Post pass/fail + key issue if failed
- Cron job: `clawscreen-midday-health` (`d65db536-721f-4dc6-86e3-dfa18e17c4a4`)

## 3) Evening verify + ship report (Daily 18:10)
- Run `npm test`, `npm run typecheck`, `npm run build`
- Report shipped commits + preview links
- Cron job: `clawscreen-evening-ship-report` (`7150e61c-aed3-4daf-9e5b-0a5989a96ad5`)

## 4) Weekly roadmap sync (Sun 19:00)
- Summarize progress by lane (reliability/interaction/trust_ux)
- Propose next 3 priorities
- Cron job: `clawscreen-weekly-roadmap-sync` (`706a7fec-55d2-4667-8306-b4b5505195b4`)
