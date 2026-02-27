# ClawScreen Autonomy Policy

## Mode
Managed autonomy: execute continuously in scheduled cycles; escalate only for strategic decisions/risky actions.

## Can run without asking
- Code changes in this repo
- Tests/typecheck/build/smoke checks
- Roadmap/backlog/docs updates
- Delegating coding tasks to Engineering agent (`dev`)

## Must ask first
- New external integrations requiring new credentials/scopes
- Public announcements/posts outside this channel
- Destructive infra/system actions beyond this project runtime

## Delivery rhythm
- Plan -> Delegate -> Verify -> Ship -> Report
- Keep updates concise and link-first (commit/repo preview URLs)

## Definition of done
- Pass quality gates in `ops/ROADMAP.yaml`
- Include short changelog summary
- Share preview links
