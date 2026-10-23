"""Runs the real laptop-purchase flow against a normal-mode server over HTTP and MCP.

The server is a subprocess with a throwaway SQLite file and a mock payment provider. PYTEST_CURRENT_TEST
is stripped from its environment so the seeded demo identities are NOT enabled: every member must
register and log in like a real account.
"""

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture(scope="module")
def live_server(tmp_path_factory):
    port = _free_port()
    base = f"http://127.0.0.1:{port}"
    env = {k: v for k, v in os.environ.items() if k not in {"PYTEST_CURRENT_TEST", "PACT_DEMO_MODE", "QLOO_API_KEY", "NVIDIA_API_KEY"}}
    env.update({"PACT_PORT": str(port), "PACT_SQLITE_PATH": str(tmp_path_factory.mktemp("flow") / "flow.sqlite3"), "PACT_BEDROCK_ENABLED": "0", "PACT_PAYMENT_PROVIDER": "mock", "PACT_TOKEN_SECRET": "pytest-flow-only", "PACT_ALLOWED_ORIGINS": base})
    process = subprocess.Popen([sys.executable, "-m", "pact.server"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                if httpx.get(f"{base}/health", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.25)
        else:
            pytest.fail("PACT server did not start")
        yield base
    finally:
        process.terminate()
        process.wait(timeout=10)


def test_mcp_endpoint_negotiates_current_protocol_and_lists_tools(live_server):
    headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": "2025-11-25", "Origin": live_server}
    body = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "pytest", "version": "1"}}}
    response = httpx.post(f"{live_server}/mcp", json=body, headers=headers, timeout=10)
    assert response.status_code == 200 and response.headers.get("mcp-session-id")
    line = next(l for l in response.text.split("\n") if l.startswith("data:"))
    result = json.loads(line[5:])["result"]
    assert result["protocolVersion"] >= "2025-11-25" and result["serverInfo"]["name"] == "PACT"


def test_laptop_purchase_flow_passes_every_step(live_server):
    done = subprocess.run([sys.executable, str(ROOT / "scripts" / "submission_flow.py")], env={**os.environ, "PACT_URL": live_server}, capture_output=True, text=True, timeout=240)
    assert done.returncode == 0, done.stdout[-3000:] + done.stderr[-1000:]
    assert "FAIL" not in done.stdout and "PASS:" in done.stdout
