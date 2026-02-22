#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVICE_FILE="$PROJECT_DIR/systemd/vibedocs.service"
USER_SYSTEMD_DIR="$HOME/.config/systemd/user"
SERVICE_LINK="$USER_SYSTEMD_DIR/vibedocs.service"

echo "=== vibedocs: Service Setup ==="
echo ""

# 1. Verify service file exists
if [[ ! -f "$SERVICE_FILE" ]]; then
    echo "ERROR: Service file not found: $SERVICE_FILE"
    exit 1
fi
echo "[1/4] Service file found: $SERVICE_FILE"

# 2. Create systemd user directory and symlink
mkdir -p "$USER_SYSTEMD_DIR"
if [[ -L "$SERVICE_LINK" ]]; then
    echo "[2/4] Symlink already exists, updating..."
    rm "$SERVICE_LINK"
elif [[ -f "$SERVICE_LINK" ]]; then
    echo "[2/4] Regular file exists at $SERVICE_LINK, replacing with symlink..."
    rm "$SERVICE_LINK"
else
    echo "[2/4] Creating symlink..."
fi
ln -s "$SERVICE_FILE" "$SERVICE_LINK"
echo "      $SERVICE_LINK -> $SERVICE_FILE"

# 3. Enable lingering (services persist after logout, start on boot)
echo "[3/4] Enabling lingering for $(whoami)..."
loginctl enable-linger "$(whoami)"

# 4. Reload systemd and enable service
echo "[4/4] Reloading systemd and enabling service..."
systemctl --user daemon-reload
systemctl --user enable vibedocs

echo ""
echo "=== Setup Complete ==="
echo ""
echo "The service is now installed and enabled (will start on boot)."
echo "To start it now:  systemctl --user start vibedocs"
echo "To check status:  systemctl --user status vibedocs"
echo "To view logs:     journalctl --user -u vibedocs -f"
