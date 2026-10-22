import importlib.metadata

import pytest

from pact.server import _mcp_voice_fields, get_rules, propose_rule, runtime_status, server


@pytest.mark.asyncio
async def test_mcp_tools_and_runtime_metadata():
    tools = await server.list_tools()
    names = {tool.name for tool in tools}
    assert {"get_rules", "propose_rule", "confirm_rule", "check_action", "request_approval", "approve", "execute_action", "get_receipts"}.issubset(names)
    assert {"search_catalog", "get_product", "compare_products", "get_availability", "get_product_reviews", "create_purchase_request", "get_product_recommendation_context", "get_order_status", "get_memory_context", "list_memories", "list_shared_memories", "remember_preference", "forget_preference"}.issubset(names)
    result = get_rules()
    assert "household" in result
    assert isinstance(result.get("mcp_events"), list)
    status = runtime_status()
    assert tuple(int(x) for x in importlib.metadata.version("mcp").split(".")[:2]) >= (1, 20)
    assert status["protocol"]["latest_supported"] in {"2026-07-28", "2025-11-25"}


def test_mcp_action_results_are_voice_ready_without_tokens():
    check = _mcp_voice_fields("check_action", {"decision": "ask", "reason": "adult approval required", "decision_token": "secret"})
    assert check["requires_approval"] is True
    assert check["next_step"] == "adult_approval"
    assert "decision_token" not in check["spoken_summary"]
    execute = _mcp_voice_fields("execute_action", {"executed": False, "error": "token rejected", "decision_token": "secret"})
    assert execute["spoken_summary"] == "The action was refused. Nothing was executed."

