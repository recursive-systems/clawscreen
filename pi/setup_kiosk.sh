#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <GATEWAY_HOST_OR_IP>"
  exit 1
fi

GATEWAY_HOST="$1"
CANVAS_URL="http://${GATEWAY_HOST}:18789/__openclaw__/canvas/"
AUTOSTART_DIR="$HOME/.config/lxsession/LXDE-pi"
AUTOSTART_FILE="$AUTOSTART_DIR/autostart"

echo "[1/5] Updating apt and installing kiosk deps..."
sudo apt update
sudo apt install -y chromium-browser unclutter

echo "[2/5] Ensuring autostart directory exists..."
mkdir -p "$AUTOSTART_DIR"

echo "[3/5] Writing kiosk autostart..."
cat > "$AUTOSTART_FILE" <<EOF
@xset s off
@xset -dpms
@xset s noblank
@unclutter -idle 0.5 -root
@chromium-browser --noerrdialogs --disable-infobars --kiosk --incognito --check-for-update-interval=31536000 ${CANVAS_URL}
EOF

echo "[4/5] Validating gateway reachability..."
if curl -I --max-time 5 "$CANVAS_URL" >/dev/null 2>&1; then
  echo "Gateway reachable: $CANVAS_URL"
else
  echo "Warning: gateway not reachable right now ($CANVAS_URL)."
  echo "Kiosk config was still written; verify host/network/firewall before final acceptance."
fi

echo "[5/5] Done. Reboot to test kiosk startup: sudo reboot"
