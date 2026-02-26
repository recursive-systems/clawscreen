# Acceptance Checklist — Family HUD v1

## A) Local Host Dev Validation
- [ ] `python3 -m http.server 8080` serves HUD locally.
- [ ] Clock/time updates every second.
- [ ] Date renders correctly.
- [ ] Manual **Refresh** button works.
- [ ] With no live endpoints, status bar reports fallback/partial state.
- [ ] Schedule/weather/priorities still render from fallback data.

## B) Pi Kiosk Setup Validation
- [ ] `pi/setup_kiosk.sh <GATEWAY_HOST_OR_IP>` completes.
- [ ] `~/.config/lxsession/LXDE-pi/autostart` includes kiosk command.
- [ ] `curl -I http://<HOST>:18789/__openclaw__/canvas/` returns success from Pi.

## C) 3 Reboot Reliability Test (Required)
Record each reboot cycle:

| Cycle | Auto-login | Chromium kiosk auto-launch | Canvas URL loaded | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 1 | ☐ | ☐ | ☐ | ☐ | |
| 2 | ☐ | ☐ | ☐ | ☐ | |
| 3 | ☐ | ☐ | ☐ | ☐ | |

Acceptance criteria:
- [ ] 3/3 cycles pass with no keyboard/mouse intervention.

## D) Basic Burn-in / Fallback
- [ ] 2–4 hour run without browser crash.
- [ ] Screen does not sleep.
- [ ] If gateway/data is briefly unavailable, HUD stays usable via cache/fallback.
