import pytest

from pact.compiler import deterministic_compile
from pact.service import PactService
from pact.state import StateStore
from pact.tokens import TokenManager


class StubCompiler:
    status = {"attempted": False, "available": False, "region": None, "model_id": None, "reason": "test stub"}

    def compile(self, source_text, created_by="siva"):
        result = deterministic_compile(source_text, created_by)
        result["compiler"] = "deterministic-test-stub"
        return result


@pytest.fixture
def service():
    return PactService(StateStore(), StubCompiler(), TokenManager("test-secret"))


def make_action(**overrides):
    action = {
        "request_id": "req-test",
        "household_id": "house-1",
        "subject_id": "maya",
        "subject_role": "teen",
        "action": "booking",
        "resource": "hotel",
        "merchant": "Mock Travel",
        "amount_cents": 15000,
        "currency": "USD",
        "device": None,
        "audience": "household",
        "surface": "shared_web_demo",
        "timestamp": "2026-10-17T12:00:00Z",
        "idempotency_key": "once-test",
    }
    action.update(overrides)
    return action

