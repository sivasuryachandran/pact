#!/usr/bin/env python3
"""Official MCP Python SDK client check against a running PACT server.

Registers a throwaway account, creates a household, then connects with the SDK's Streamable HTTP
client using that account's session. Prints the negotiated protocol and tool count. Exits nonzero
if initialize, tools/list or an authenticated tools/call fails.
"""

from __future__ import annotations

import asyncio
import importlib.metadata
import os
import secrets
import sys

import httpx
import httpx2
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

BASE = os.environ.get("PACT_URL", "http://127.0.0.1:8787").rstrip("/")


async def main() -> int:
    suffix = secrets.token_hex(4)
    http = httpx.Client(base_url=BASE, headers={"Origin": BASE}, timeout=30)
    password = "Sdk-" + secrets.token_urlsafe(18)
    registered = http.post("/api/auth/register", json={"username": f"sdk_{suffix}", "email": f"sdk_{suffix}@example.test", "password": password, "display_name": "SDK Check"})
    csrf = http.cookies.get("PACT_CSRF", "")
    created = http.post("/api/households/create", json={"name": f"SDK Home {suffix}"}, headers={"X-PACT-CSRF": csrf})
    if registered.status_code != 200 or created.status_code != 200:
        print("FAIL: could not create the throwaway account")
        return 1
    cookies = "; ".join(f"{k}={v}" for k, v in http.cookies.items())
    endpoint = f"{BASE}/mcp"
    async with httpx2.AsyncClient(headers={"Cookie": cookies, "Origin": BASE}) as client:
        async with streamable_http_client(endpoint, http_client=client) as streams:
            async with ClientSession(*streams) as session:
                initialized = await session.initialize()
                tools = await session.list_tools()
                result = await session.call_tool("search_catalog", {"query": "laptop", "limit": 3})
    ok = str(initialized.protocol_version) >= "2025-11-25" and len(tools.tools) > 0 and bool(result.structured_content) and not result.is_error
    print(f"sdk: mcp {importlib.metadata.version('mcp')}")
    print(f"endpoint: /mcp (Streamable HTTP)")
    print(f"negotiated_protocol: {initialized.protocol_version}")
    print(f"tools_listed: {len(tools.tools)}")
    print(f"authenticated_tools_call: {'search_catalog ok' if ok else 'failed'}")
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
