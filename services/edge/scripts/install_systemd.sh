#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo ./scripts/install_systemd.sh [service-user]"
  exit 1
fi
SERVICE_USER="${1:-${SUDO_USER:-pi}}"
PROJECT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEMPLATE="$PROJECT_PATH/services/edge/scripts/smart-attendance-edge.service"
TARGET="/etc/systemd/system/smart-attendance-edge.service"

sed -e "s|REPLACE_SERVICE_USER|$SERVICE_USER|g" -e "s|REPLACE_PROJECT_PATH|$PROJECT_PATH|g" "$TEMPLATE" > "$TARGET"
usermod -aG video "$SERVICE_USER"
systemctl daemon-reload
systemctl enable --now smart-attendance-edge.service
echo "Installed smart-attendance-edge for user $SERVICE_USER. Log out/in once if camera video-group permissions are new."
