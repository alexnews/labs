#!/bin/bash
# Deploy an app on a labs server.
# Usage:  LABS_ROOT=/usr/local/www/labs ./deploy.sh <app-slug>
#   e.g.  LABS_ROOT=/usr/local/www/labs ./deploy.sh gym-churn
#
# Assumes the systemd service is installed as `labs-<slug>.service`.

set -euo pipefail

: "${LABS_ROOT:?LABS_ROOT must be set, e.g. /usr/local/www/labs}"

APP="${1:-}"
if [ -z "$APP" ]; then
    echo "Usage: LABS_ROOT=<path> $0 <app-slug>"
    echo "Available apps:"
    ls "$LABS_ROOT/apps/"
    exit 1
fi

APP_DIR="$LABS_ROOT/apps/$APP"

if [ ! -d "$APP_DIR" ]; then
    echo "ERROR: App directory not found: $APP_DIR"
    exit 1
fi

echo "=== Deploying $APP ==="

cd "$APP_DIR"

# Pull latest (assumes git pull was run from the repo root before this)

# Create venv if missing
if [ ! -d "venv" ]; then
    echo "--- Creating venv ---"
    python3 -m venv venv
fi

# Install/update deps
echo "--- Installing requirements ---"
./venv/bin/pip install --quiet --upgrade pip
./venv/bin/pip install --quiet -r requirements.txt

# Restart systemd service
echo "--- Restarting service ---"
SERVICE="labs-$APP.service"
sudo systemctl restart "$SERVICE"
sudo systemctl status "$SERVICE" --no-pager -l | head -10

echo "=== $APP deployed ==="
