# A2UI Protocol Notes (Project Reference)

These notes summarize the upstream A2UI protocol direction so ClawScreen stays aligned with the intended ethos.

## Canonical sources
- Google Developers Blog announcement: https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/
- GitHub spec/project: https://github.com/google/A2UI
- Docs intro: https://a2ui.org/introduction/what-is-a2ui/

## What A2UI is
A2UI (Agent-to-UI) is a **declarative protocol** for agent-generated interfaces.
Agents emit structured UI messages/JSON; the host client renders them with native trusted components.

## Core ethos to preserve in ClawScreen
1. **Security first**
   - Treat agent output as data, not executable code.
   - No arbitrary script execution from model output.
   - Restrict renderable UI to approved component types.

2. **Host-controlled rendering**
   - Client keeps full control over style, accessibility, and UX.
   - Avoid iframe-heavy “remote HTML app” patterns when possible.

3. **Incremental, updateable UI**
   - Favor structures that can be progressively updated.
   - Model outputs should be easy to validate, diff, and re-render.

4. **Transport-agnostic interoperability**
   - Payloads should be transport-friendly (A2A/AG-UI/etc.).
   - Keep protocol shape neutral to runtime/framework.

5. **Framework portability**
   - A2UI payloads should map cleanly to web/mobile/native renderers.

## Practical implementation rules for this repo
- Keep strict JSON contract on generation endpoint.
- Normalize incoming payloads before render.
- Enforce block allowlist (`text`, `list`, `metric`, `card`, `notes`, `divider`).
- Strip dangerous patterns (`<script>`, `javascript:`, inline handlers).
- Maintain fallback behavior when generation is invalid/unavailable.

## Version awareness
- Upstream A2UI currently indicates public-preview semantics (v0.8 at time of writing).
- Expect schema and renderer guidance to evolve; design code for adaptation.
