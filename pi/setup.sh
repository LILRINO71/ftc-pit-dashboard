#!/bin/bash
# Makes the Pi boot straight into the pit dashboard, full screen.
# Usage:  bash pi/setup.sh                 (uses config.js / on-screen settings)
#         bash pi/setup.sh "team=12345&event=USTXHOQ1"
set -e

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$HOME/ftc-pit-dashboard"
PORT=8770

# Running from the USB stick's boot partition: copy it home first
if [ "$SRC" != "$DIR" ]; then
  mkdir -p "$DIR"
  cp -r "$SRC"/. "$DIR"/
fi

# Tiny local web server (the 3D model needs http, not file://)
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/pit-dashboard.service <<EOF
[Unit]
Description=FTC pit dashboard web server

[Service]
ExecStart=/usr/bin/python3 -m http.server $PORT --bind 127.0.0.1 --directory $DIR
Restart=always

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now pit-dashboard.service
sudo loginctl enable-linger "$USER" 2>/dev/null || true

URL="http://localhost:$PORT/${1:+?$1}"

BROWSER="$(command -v chromium || command -v chromium-browser || true)"
if [ -z "$BROWSER" ]; then
  sudo apt-get update
  sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser
  BROWSER="$(command -v chromium || command -v chromium-browser)"
fi

CMD="$BROWSER --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --ignore-gpu-blocklist --enable-gpu-rasterization --check-for-update-interval=31536000 \"$URL\""

# Wayland desktop (newer Raspberry Pi OS)
mkdir -p ~/.config/labwc
touch ~/.config/labwc/autostart
sed -i '/pit-dashboard/d' ~/.config/labwc/autostart
echo "sleep 3; $CMD &  # pit-dashboard" >> ~/.config/labwc/autostart

# X11 desktop (older Raspberry Pi OS)
LX=~/.config/lxsession/LXDE-pi/autostart
mkdir -p "$(dirname "$LX")"
[ -f "$LX" ] || cp /etc/xdg/lxsession/LXDE-pi/autostart "$LX" 2>/dev/null || touch "$LX"
sed -i '/pit-dashboard/d' "$LX"
echo "@$CMD  # pit-dashboard" >> "$LX"

# Keep the screen from going to sleep
sudo raspi-config nonint do_blanking 1 2>/dev/null || true

echo "Done. Reboot to start the dashboard:  sudo reboot"
echo "To stop it starting on boot:  bash $DIR/pi/remove.sh"
