# Cron Plan (Product OS)

Timezone: America/Chicago

## -1) Daily self-optimizer (Daily 07:20)
- Review recent memory + ops docs + shipped commits for execution friction
- Apply low-risk process improvements to roadmap/templates/checklists
- Log learnings and post concise optimization report
- Cron job: `clawscreen-self-optimizer` (`88ace0c6-9a2f-408b-9192-1e47c9dce031`)

## 0) Daily deep research + roadmap enrichment (Daily 08:45)
- Brief deep-research agent on A2UI evolution + agentic UI patterns + competitive references
- Synthesize findings into roadmap updates (P0/P1/P2)
- Dispatch one engineering-ready task from highest-value insight
- Post concise research+execution update in #clawscreen with preview link
- Cron job: `clawscreen-daily-deep-research` (`637dd3cc-7b99-4373-8144-0000f4cf7090`)

## 1) Daily planning + dispatch (Mon-Fri 09:05)
- Select top 1-2 items from `ops/ROADMAP.yaml`
- Send implementation brief to `agent:dev:discord:channel:1475880024111583243`
- Post short plan update in #clawscreen
- Cron job: `clawscreen-plan-dispatch` (`ba20ffc3-f0f7-40b0-ac5a-d9ad7199dfa8`)

## 1.5) Weekday implementation sprint (AM 10:30, PM 15:30)
- Execute roadmap items via Engineering Brain with hard ship requirements
- Require code + tests/typecheck/build + commit/push
- Post ship updates with preview link
- Cron jobs:
  - `clawscreen-implementation-sprint-am` (`5725fd16-b7a1-4a54-bb74-d181aa0311b2`)
  - `clawscreen-implementation-sprint-pm` (`f9c614d1-6db4-4b29-8aaf-ea083cb2c8ed`)

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
