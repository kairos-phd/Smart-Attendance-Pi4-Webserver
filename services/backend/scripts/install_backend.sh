#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip wheel
.venv/bin/python -m pip install -e '.[ai]'
echo "Backend environment installed. Configure .env, then start uvicorn app.main:app --host 0.0.0.0 --port 8000"
