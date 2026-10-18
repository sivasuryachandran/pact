import importlib.metadata

import pytest

from pact.server import get_rules, propose_rule, runtime_status, server


@pytest.mark.asyncio
async def test_mcp_tools_and_runtime_metadata():
    tools = await server.list_tools()
    names = {tool.name for tool in tools}
    assert names == {"get_rules", "propose_rule", "confirm_rule", "check_action", "request_approval", "approve", "execute_action", "get_receipts"}
    result = get_rules()
    assert "household" in result
    status = runtime_status()
    assert tuple(int(x) for x in importlib.metadata.version("mcp").split(".")[:2]) >= (1, 20)
    assert status["protocol"]["latest_supported"] in {"2026-07-28", "2025-11-25"}

