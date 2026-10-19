"""Run against a running PACT server and report negotiated MCP details."""

from __future__ import annotations

import asyncio
import importlib.metadata
import os

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
import httpx2


async def main() -> None:
    endpoint = os.getenv("PACT_MCP_ENDPOINT", "http://127.0.0.1:8787/mcp")
    session_token = os.getenv("PACT_MCP_SESSION", "")
    headers = {"X-PACT-Session": session_token} if session_token else {}
    async with httpx2.AsyncClient(headers=headers) as http_client:
        async with streamable_http_client(endpoint, http_client=http_client) as streams:
            async with ClientSession(*streams) as session:
                initialized = await session.initialize()
                tools = await session.list_tools()
                result = await session.call_tool("get_rules", {})
                print(f"mcp_sdk_version: {importlib.metadata.version('mcp')}")
                print(f"negotiated_protocol: {initialized.protocol_version}")
                print(f"endpoint: {endpoint}")
                print(f"authenticated_session: {bool(session_token)}")
                print("tools: " + ", ".join(tool.name for tool in tools.tools))
                print(f"get_rules_structured_output: {bool(result.structured_content)}")


if __name__ == "__main__":
    asyncio.run(main())

