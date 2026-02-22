#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$PROJECT_DIR/frontend"

echo "=== vibedocs: Promotion ==="
echo ""

# [1/6] Check git status
echo "[1/6] Checking git status..."
cd "$PROJECT_DIR"
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    echo "      WARNING: Uncommitted changes detected. Consider committing first."
    echo ""
else
    echo "      Working tree clean."
fi

# [2/6] Install backend dependencies
echo "[2/6] Installing backend dependencies..."
cd "$PROJECT_DIR"
npm install --omit=dev 2>&1 | tail -1
echo "      Backend dependencies installed."

# [3/6] Build frontend
echo "[3/6] Building frontend..."
cd "$FRONTEND_DIR"
npm install 2>&1 | tail -1
npx vite build 2>&1 | tail -3
echo "      Frontend build complete."

# [4/6] Validate build artifacts
echo "[4/6] Validating build artifacts..."
DIST_DIR="$FRONTEND_DIR/dist"
ERRORS=0

if [[ ! -f "$DIST_DIR/index.html" ]]; then
    echo "      ERROR: index.html not found in $DIST_DIR"
    ERRORS=$((ERRORS + 1))
fi

if [[ ! -d "$DIST_DIR/assets" ]]; then
    echo "      ERROR: assets/ directory not found in $DIST_DIR"
    ERRORS=$((ERRORS + 1))
fi

JS_COUNT=$(find "$DIST_DIR/assets" -name "*.js" 2>/dev/null | wc -l)
CSS_COUNT=$(find "$DIST_DIR/assets" -name "*.css" 2>/dev/null | wc -l)

if [[ "$JS_COUNT" -eq 0 ]]; then
    echo "      ERROR: No JS files found in assets/"
    ERRORS=$((ERRORS + 1))
fi

if [[ "$CSS_COUNT" -eq 0 ]]; then
    echo "      ERROR: No CSS files found in assets/"
    ERRORS=$((ERRORS + 1))
fi

if [[ "$ERRORS" -gt 0 ]]; then
    echo "      FAILED: $ERRORS validation error(s). Aborting."
    exit 1
fi
echo "      Build valid: index.html + ${JS_COUNT} JS + ${CSS_COUNT} CSS files."

# [5/6] Restart systemd service
echo "[5/6] Restarting vibedocs service..."
systemctl --user daemon-reload
systemctl --user restart vibedocs
echo "      Service restarted."

# [6/6] Health check
echo "[6/6] Running health check..."
RETRIES=10
DELAY=2
URL="http://localhost:8080/api/projects"

for i in $(seq 1 $RETRIES); do
    if curl -sf "$URL" > /dev/null 2>&1; then
        echo "      Health check passed on attempt $i."
        break
    fi
    if [[ "$i" -eq "$RETRIES" ]]; then
        echo "      FAILED: Health check did not pass after $((RETRIES * DELAY))s."
        echo ""
        echo "      Debug commands:"
        echo "        systemctl --user status vibedocs"
        echo "        journalctl --user -u vibedocs --no-pager -n 30"
        exit 1
    fi
    sleep "$DELAY"
done

echo ""
echo "=== Promotion Complete ==="
echo ""
echo "  Status:  systemctl --user status vibedocs"
echo "  Logs:    journalctl --user -u vibedocs -f"
echo "  URL:     http://localhost:8080"
