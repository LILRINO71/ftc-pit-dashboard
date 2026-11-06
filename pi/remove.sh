#!/bin/bash
# Stops the dashboard from opening on boot.
sed -i '/pit-dashboard/d' ~/.config/labwc/autostart ~/.config/lxsession/LXDE-pi/autostart 2>/dev/null || true
systemctl --user disable --now pit-dashboard.service 2>/dev/null || true
echo "Removed. It won't start on the next boot."
