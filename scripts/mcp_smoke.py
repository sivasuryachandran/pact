"""Run against a running PACT server and report negotiated MCP details."""

from __future__ import annotations

import asyncio
import importlib.metadata

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


async def main() -> None:
    async with streamable_http_client("http://127.0.0.1:8787/mcp") as streams:
        async with ClientSession(*streams) as session:
            initialized = await session.initialize()
            tools = await session.list_tools()
            result = await session.call_tool("get_rules", {})
            print(f"mcp_sdk_version: {importlib.metadata.version('mcp')}")
            print(f"negotiated_protocol: {initialized.protocol_version}")
            print("endpoint: http://127.0.0.1:8787/mcp")
            print("tools: " + ", ".join(tool.name for tool in tools.tools))
            print(f"get_rules_structured_output: {bool(result.structured_content)}")


if __name__ == "__main__":
    asyncio.run(main())

