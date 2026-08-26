#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo ./scripts/install_systemd.sh [service-user]"
  exit 1
fi
SERVICE_USER="${1:-${SUDO_USER:-pi}}"
PROJECT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEMPLATE="$PROJECT_PATH/services/backend/scripts/smart-attendance-api.service"
TARGET="/etc/systemd/system/smart-attendance-api.service"

sed -e "s|REPLACE_SERVICE_USER|$SERVICE_USER|g" -e "s|REPLACE_PROJECT_PATH|$PROJECT_PATH|g" "$TEMPLATE" > "$TARGET"
systemctl daemon-reload
systemctl enable --now smart-attendance-api.service
echo "Installed smart-attendance-api for user $SERVICE_USER."
