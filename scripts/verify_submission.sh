#!/usr/bin/env bash
# Deterministic submission check. Builds, runs every test suite, starts a throwaway normal-mode
# server (temporary SQLite, mock payments, Bedrock off) and runs the MCP, laptop-purchase and
# browser checks against it. Prints PASS/FAIL per step and exits nonzero if any step fails.
# It needs no credentials and never prints environment values.
#
#   scripts/verify_submission.sh              # everything
#   VERIFY_SKIP_BROWSER=1 scripts/verify_submission.sh   # skip the Playwright browser suites
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PY="${PYTHON:-.venv/bin/python}"
[ -x "$PY" ] || PY="python3"
TMP="$(mktemp -d)"
SERVER_PID=""
PASS=0
FAIL=0
FAILED_STEPS=()

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

step() { # step "name" command...
  local name="$1"; shift
  local log="$TMP/$(echo "$name" | tr -c 'A-Za-z0-9' '_').log"
  if "$@" >"$log" 2>&1; then
    local last; last="$(grep -E 'passed|PASS|attempts|bypasses|Tests ' "$log" | tail -n1 | tr -s ' ' | cut -c1-110 || true)"
    printf 'PASS  %s%s\n' "$name" "${last:+   [$last]}"; PASS=$((PASS + 1))
  else
    printf 'FAIL  %s\n' "$name"; FAIL=$((FAIL + 1)); FAILED_STEPS+=("$name")
    # Show the first error block (what failed), then the tail (the summary).
    grep -m1 -B2 -A14 -E 'Error:|AssertionError|FAILED' "$log" | sed 's/^/        /' || true
    echo '        ...'
    tail -n 15 "$log" | sed 's/^/        /'
  fi
}

free_port() { "$PY" - <<'PYEOF'
import socket
s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()
PYEOF
}

echo "PACT submission verification"
echo "python: $("$PY" --version 2>&1)   node: $(node --version)   npm: $(npm --version)"
echo

step "npm run build"                         npm run build
step "pytest (all suites)"                   "$PY" -m pytest
step "bypass/security suite (240 attempts)"  "$PY" -m pytest -q -s tests/test_bypass.py
step "signal unit tests"                     npm run test:signal
step "git diff --check"                      git diff --check
step "PACT_FINAL_STRESS_TEST.md unchanged"   git diff --quiet -- PACT_FINAL_STRESS_TEST.md

# Throwaway normal-mode server: no seeded demo identities, mock payments, Bedrock off.
PORT="$(free_port)"
BASE="http://127.0.0.1:${PORT}"
env -u PYTEST_CURRENT_TEST -u PACT_DEMO_MODE -u QLOO_API_KEY -u NVIDIA_API_KEY \
  PACT_PORT="$PORT" PACT_SQLITE_PATH="$TMP/verify.sqlite3" PACT_BEDROCK_ENABLED=0 \
  PACT_PAYMENT_PROVIDER=mock PACT_TOKEN_SECRET="verify-$(date +%s)" PACT_ALLOWED_ORIGINS="$BASE" \
  "$PY" -m pact.server >"$TMP/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 80); do
  curl -fsS "$BASE/health" >/dev/null 2>&1 && break
  sleep 0.25
done

step "server /health"                        curl -fsS "$BASE/health"
step "MCP SDK client: initialize, tools/list, tools/call" env PACT_URL="$BASE" "$PY" scripts/mcp_sdk_check.py
step "laptop purchase flow (5 accounts, MCP, tamper, receipt)" env PACT_URL="$BASE" "$PY" scripts/submission_flow.py --json "$TMP/flow.json"

if [ "${VERIFY_SKIP_BROWSER:-0}" != "1" ]; then
  step "signal Playwright"                   npm run e2e:signal
  step "real-account browser E2E (Playwright)" env PACT_E2E_BASE_URL="$BASE" npm run test:e2e:real
else
  echo "SKIP  browser suites (VERIFY_SKIP_BROWSER=1)"
fi

# The server log must never contain credentials. These are patterns, not values.
step "no credentials in server log"          bash -c "! grep -E 'AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|Bearer [A-Za-z0-9._-]{20,}' '$TMP/server.log'"

echo
echo "RESULT: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  printf 'FAILED: %s\n' "${FAILED_STEPS[@]}"
  exit 1
fi
echo "PASS: submission verification complete"
