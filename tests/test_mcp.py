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



def test_mcp_trace_never_records_tokens_even_inside_nested_decisions():
    """Regression: create_purchase_request returns a nested decision object that carries a signed token."""
    import json
    import time

    from pact.server import _mcp_event
    from pact.service import PactService
    from pact.state import StateStore
    from pact.tokens import TokenManager

    service = PactService(StateStore("house-trace"), token_manager=TokenManager("trace-secret"))
    secret = "eyJ" + "A" * 80
    result = {"request": {"request_id": "purchase-1", "amount_cents": 100}, "decision": {"decision": "ask", "decision_token": secret}, "approval_token": secret, "order": {"order_id": "order-1", "client_secret": secret}}
    _mcp_event("create_purchase_request", {"decision_token": secret, "product_id": "p"}, result, service, {"member_id": "maya", "household_id": "house-trace"}, time.perf_counter())
    event = service.store.snapshot()["mcp_events"][-1] if "mcp_events" in service.store.snapshot() else service.store.mcp_events[-1]
    assert secret not in json.dumps(event)
    assert event["policy_decision"] == "ask" and event["order_id"] == "order-1"
