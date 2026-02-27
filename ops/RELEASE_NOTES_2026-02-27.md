# ClawScreen Weekly — 2026-02-27

**Theme:** Stabilize the A2UI runtime, expand safe component support, and establish autonomous product operations.

## Shipped
- ✅ Expanded safe renderer support for new A2UI block types: `image`, `icon`, `row`, `column`, `section`.
- ✅ Upgraded generation prompt policy to favor tool-backed live data and explicit type-selection.
- ✅ Hardened gateway behavior to avoid terminal polling stalls and parse embedded JSON safely.
- ✅ Added Product OS operations docs + cron cadence for autonomous planning, health checks, and ship reporting.

## Changed
- 🔁 Image handling now preserves payload through normalization and renders with `object-fit: contain` (no aggressive cropping).
- 🔁 Server normalization now keeps layout/media structures (children/src/caption/icon) instead of collapsing them.
- 🔁 Polling lifecycle now exits earlier on terminal non-JSON responses and retries with clearer feedback.

## Reliability
- 🛠 Fixed major runtime pain points: EADDRINUSE collisions, long polling loops, and false heuristic fallbacks.
- 📉 Improved practical stability of `/a2ui/generate` under tool-use and mixed output patterns.

## What we learned
- 🧠 Prompt constraints and server normalizers must evolve together; otherwise new block types appear in prompts but vanish in output.
- 🧠 A2UI-style systems need strict trust boundaries and also rich fallback behavior for imperfect model output.
- 🧠 Product velocity improves materially when roadmap + delegation + reporting are systematized in cron.

## Next up
- ⏭ Phase B: event envelope + interactive action loop (button/input -> LLM-decided next UI).
- ⏭ Add trust UX metadata (source/freshness badges) in rendered surfaces.
- ⏭ Continue daily deep research to refine roadmap priorities with implementation-ready briefs.

## Known rough edges
- ⚠ Interactive controls are not fully wired yet (visual support exists; full action loop is next).
- ⚠ Dev-mode hot reload can still create transient interruptions during live edits.

## Preview
- UI: http://100.125.46.74:18842
- Repo: https://github.com/recursive-systems/clawscreen
