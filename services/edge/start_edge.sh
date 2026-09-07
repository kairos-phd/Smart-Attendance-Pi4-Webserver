#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
elif [ -f "../backend/.venv/bin/activate" ]; then
    source ../backend/.venv/bin/activate
else
    echo "Creating virtual environment in $SCRIPT_DIR/.venv..."
    python3 -m venv .venv
    source .venv/bin/activate
    pip install --upgrade pip
    pip install -e .
fi

exec python3 -m attendance_edge.main "$@"
