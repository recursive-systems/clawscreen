# Demo Script — Prompt -> Plan -> Action -> Result

Duration target: 35-45 seconds

## Setup
- Open: http://100.125.46.74:18842
- Ensure app shows healthy status and prompt box is visible.

## Script

### 1) Prompt (0-8s)
Narration:
"Here’s ClawScreen taking a plain-language request and turning it into an operable interface."

Type prompt:
"Create a travel command center with a section title Travel, a row of two metrics, a column of next actions, and an image preview for mountain sunrise."

Click **Generate**.

### 2) Plan UI (8-18s)
Narration:
"Instead of a long chat response, it returns structured UI blocks that can be rendered and updated safely."

Highlight:
- section heading
- row metrics
- action list column
- image block

### 3) Action / Evidence (18-30s)
Narration:
"The screen is generated from typed A2UI-style payloads with trusted rendering rules."

Click **Show Raw** briefly and point out block `type` entries:
- section
- row
- metric
- column
- list
- image

Close raw modal.

### 4) Result + Trust (30-45s)
Narration:
"The key is control and reliability: structured output, safe rendering, and clear behavior when model output isn’t perfect."

Optional closing line:
"ClawScreen turns AI conversations into observable, operable workflows."

## Recording tips
- Keep mouse movements minimal and intentional.
- Pause 1 second on each UI region you mention.
- If generation is slow, mention: "tool-backed generation is running" and continue once blocks render.
