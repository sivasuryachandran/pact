#!/usr/bin/env bash
# Start PACT locally with your provider settings.
# Reads a git-ignored `.env` in the repo root if it exists (copy .env.example to .env and fill it in).
# Secrets are never printed. Without a .env the app still runs in demo mode.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
PY="${PYTHON:-.venv/bin/python}"
echo "PACT starting. Providers: Bedrock=${PACT_BEDROCK_ENABLED:-1}, Qloo key set=$([ -n "${QLOO_API_KEY:-}" ] && echo yes || echo no), NVIDIA key set=$([ -n "${NVIDIA_API_KEY:-}" ] && echo yes || echo no)"
exec "$PY" -m pact.server
