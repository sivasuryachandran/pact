from concurrent.futures import ThreadPoolExecutor

from pact.addons import GiftCart, VenueBook
from pact.compiler import deterministic_compile
from pact.service import PactService
from pact.state import SQLiteStateStore, StateStore
from pact.tokens import TokenManager


class StubCompiler:
    status = {"attempted": False, "available": False, "region": None, "model_id": None, "reason": "test stub"}

    def compile(self, source_text, created_by="siva"):
        result = deterministic_compile(source_text, created_by)
        result["compiler"] = "deterministic-test-stub"
        return result


def make_service(store=None):
    return PactService(store or StateStore(), StubCompiler(), TokenManager("sandbox-test"))


def action(**overrides):
    value = {
        "request_id": "sandbox-request",
        "household_id": "house-1",
        "subject_id": "maya",
        "subject_role": "teen",
        "action": "purchase",
        "resource": "snack",
        "merchant": "Mock Store",
        "amount_cents": 1200,
        "currency": "USD",
        "device": None,
        "audience": "household",
        "surface": "shared_web_demo",
        "idempotency_key": "sandbox-once",
    }
    value.update(overrides)
    return value


def add_allow(service):
    proposal = service.propose_rule("Allow Maya to purchase snacks under $20.")
    service.confirm_rule(proposal["proposal_hash"])


def test_mock_addons_emit_pact_bound_actions():
    venue = VenueBook().reservation_action(
        household_id="house-1",
        requester="maya",
        requester_role="teen",
        plan_id="plan-1",
        conversation_id="conversation-1",
        surface="living_room",
        request_id="venue-1",
        idempotency_key="venue-once",
        timestamp="2026-01-01T00:00:00+00:00",
    )
    gift = GiftCart().purchase_action(
        household_id="house-1",
        requester="maya",
        requester_role="teen",
        plan_id="plan-1",
        conversation_id="conversation-1",
        surface="maya_tablet",
        request_id="gift-1",
        idempotency_key="gift-once",
        timestamp="2026-01-01T00:00:00+00:00",
    )
    assert venue["addon"] == "VenueBook" and venue["amount_cents"] == 12000
    assert gift["addon"] == "GiftCart" and gift["amount_cents"] == 4000
    assert venue["plan_id"] == gift["plan_id"] == "plan-1"


def test_sqlite_sandbox_persists_and_resets(tmp_path):
    path = str(tmp_path / "pact.sqlite3")
    first = SQLiteStateStore(path, "visitor-a")
    first.save_plan({"plan_id": "plan-a", "budget_cents": 15000, "title": "Synthetic", "beneficiary": "maya", "household_id": first.household_id, "status": "active"})
    second = SQLiteStateStore(path, "visitor-b")
    assert second.get_plan("plan-a") is None
    reopened = SQLiteStateStore(path, "visitor-a")
    assert reopened.get_plan("plan-a")["budget_cents"] == 15000
    reopened.reset()
    assert reopened.get_plan("plan-a") is None


def test_plan_exposure_holds_approved_booking_and_denies_over_budget():
    service = make_service()
    plan = service.create_plan(budget_cents=15000)
    booking = action(request_id="venue", idempotency_key="venue", action="booking", resource="funzone", merchant="VenueBook", amount_cents=12000, plan_id=plan["plan_id"], addon="VenueBook", beneficiary="maya")
    decision = service.check_action(booking)
    assert decision["decision"] == "ask"
    pending = service.request_approval(booking, decision["decision_token"])
    approved = service.approve(pending["approval"]["approval_id"], "siva")
    assert approved["approval"]["status"] == "approved"
    assert service.get_plan(plan["plan_id"])["exposure_cents"] == 12000
    decorations = action(request_id="gift", idempotency_key="gift", action="purchase", resource="decorations", merchant="GiftCart", amount_cents=4000, plan_id=plan["plan_id"], addon="GiftCart", beneficiary="maya")
    assert service.check_action(decorations)["decision"] == "deny"


def test_concurrent_exact_execution_claims_once():
    service = make_service()
    add_allow(service)
    request = action()
    first = service.check_action(request)
    second = service.check_action({**request, "request_id": "sandbox-request-2"})

    def execute(pair):
        current, token = pair
        return service.execute_action(current, token)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(execute, [(request, first["decision_token"]), ({**request, "request_id": "sandbox-request-2"}, second["decision_token"])]))
    assert sum(int(result["executed"]) for result in results) == 1
    assert sum(int(not result["executed"]) for result in results) == 1


def test_policy_preview_is_synthetic_and_has_attack_cases():
    service = make_service()
    proposal = service.propose_rule("Ask me before booking anything over $100.")
    preview = service.policy_preview(proposal["proposal_hash"])
    assert preview["synthetic_replay"] is True
    assert preview["committed_spending_cents"] == 0
    assert any("split" in item.lower() for item in preview["detected_loopholes"])
    assert {item["decision"] for item in preview["actions"]} <= {"allow", "ask", "deny"}


def test_bedrock_cap_uses_labeled_deterministic_fallback():
    service = PactService(StateStore(), StubCompiler(), TokenManager("cap-test"), bedrock_gate=lambda: False)
    proposal = service.propose_rule("Ask me before booking anything over $100.")
    assert proposal["status"] == "candidate"
    assert proposal["compiler"] == "deterministic-cap-fallback"
    assert "cap" in proposal["fallback_reason"]


def test_autonomy_is_earned_and_never_activates_automatically():
    service = make_service()
    proposal = service.propose_rule("Ask me before booking anything over $100.")
    service.confirm_rule(proposal["proposal_hash"])
    for index in range(5):
        request = action(request_id=f"approval-{index}", idempotency_key=f"approval-{index}", action="booking", resource="funzone", merchant="VenueBook", amount_cents=12000, beneficiary="maya")
        decision = service.check_action(request)
        pending = service.request_approval(request, decision["decision_token"])
        service.approve(pending["approval"]["approval_id"], "siva")
    eligible = service.autonomy_proposal("booking", "maya")
    assert eligible["status"] == "eligible"
    assert eligible["activated"] is False
    failed = service.execute_action(request, "forged")
    assert failed["executed"] is False
    assert service.autonomy_proposal("booking", "maya")["status"] == "not_eligible"
