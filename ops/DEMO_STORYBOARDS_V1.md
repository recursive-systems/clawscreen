# Demo Storyboards v1

## A) Prompt -> Plan -> Action -> Result (30-45s)
Best for technical evaluation.
1. Prompt (show raw user ask)
2. Plan UI (agent decomposes steps)
3. Action execution (1-2 concrete tool actions)
4. Result (state change + user-visible output)
5. Trust moment (log/trace/approval checkpoint)

## B) Failure Recovery (45-60s)
Best for credibility with engineers.
1. Start normal execution
2. Inject realistic failure (timeout/invalid input/permission)
3. Show recovery path (retry/fallback/escalation/human approve)
4. Land successful completion
5. Close: "This is why UI-level control matters"

## C) Operator Loop (30-50s)
Best for founder-led narrative and safety concerns.
1. Agent proposes action
2. Human reviews/edits/approves
3. Agent continues with updated constraints
4. Final output + audit trail view
5. Tagline: "Autonomous where safe, supervised where needed"

## Production notes
- Record against live preview: http://100.125.46.74:18842
- Keep each snippet single-problem focused
- Always show one trust/reliability signal
