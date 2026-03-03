# Delegation Templates

## Product -> Engineering (Context -> Goal -> Constraints -> Ask)

Context:
- repo/path:
- current state:
- roadmap item id(s):
- why now (user impact/risk):

Goal:
- what should be shipped:
- explicit acceptance criteria:

Constraints:
- keep API compatibility
- preserve safety model
- minimal diff unless required
- run tests/typecheck/build
- no "done" until commit hash + verification evidence is provided
- assign exactly one delivery owner
- include ETA for first shippable slice (or explicit blocker)
- prioritize UI quality and polish when user-facing surfaces are touched
- explicitly encourage frontend-design skill usage for layout/visual refinement tasks

Ask:
- implement, commit, push
- return summary + changed files + risks
- include rollback note (how to revert safely if regression is detected)
- return verification block:
  - delivery owner:
  - ETA (local time):
  - commit(s):
  - verification timestamp (local):
  - `npm test`:
  - `npm run typecheck`:
  - `npm run build`:
  - preview/runtime smoke result:
  - rollback note:
  - roadmap item status updated (`done`/`in progress`/`blocked` + note):

## Product -> Product Brain (Context -> Options -> Recommendation -> Ask)

Context:
- problem and user impact

Options:
- A:
- B:

Recommendation:
- preferred option and why

Ask:
- decision + priority order
