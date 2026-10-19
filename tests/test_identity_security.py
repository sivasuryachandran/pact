from concurrent.futures import ThreadPoolExecutor

import pytest
import httpx

from pact.compiler import deterministic_compile
from pact.identity import DemoIdentityManager
from pact.permissions import PermissionError
from pact.service import PactService
from pact.state import StateStore
from pact.tokens import TokenManager
from pact.server import create_app


class StubCompiler:
    status = {"attempted": False, "available": False, "region": None, "model_id": None, "reason": "test stub"}

    def compile(self, source_text, created_by="siva"):
        result = deterministic_compile(source_text, created_by)
        result["compiler"] = "deterministic-test-stub"
        return result


def make_service(household_id="demo-household"):
    return PactService(StateStore(household_id), StubCompiler(), TokenManager("identity-test-secret"))


def action(**overrides):
    value = {
        "request_id": "identity-request",
        "subject_id": "maya",
        "subject_role": "teen",
        "action": "purchase",
        "resource": "snack",
        "merchant": "Mock Store",
        "amount_cents": 1200,
        "currency": "USD",
        "surface": "shared_web_demo",
        "idempotency_key": "identity-once",
    }
    value.update(overrides)
    return value


def test_five_server_issued_sessions_are_independent_and_have_preferences():
    identities = DemoIdentityManager()
    sessions = [identities.issue(member_id) for member_id in ("siva", "anika", "maya", "leo", "nora")]
    assert len({session.session_id for session in sessions}) == 5
    assert [session.role for session in sessions] == ["adult", "adult", "teen", "child", "caregiver"]
    assert sessions[2].preferences["interest"] == "games, music, fashion"
    assert identities.resolve(sessions[0].session_id).member_id == "siva"


def test_profile_storage_is_keyed_by_member_not_a_shared_profile():
    service = make_service()
    service.store.update_profile("maya", {"favorite": "music"})
    service.store.update_profile("leo", {"favorite": "books"})
    assert service.store.get_profile("maya") == {"favorite": "music"}
    assert service.store.get_profile("leo") == {"favorite": "books"}


def test_teen_cannot_manage_rules_or_approve():
    identities = DemoIdentityManager()
    owner = identities.issue("siva")
    teen = identities.issue("maya")
    service = make_service()
    proposal = service.propose_rule("Ask me before booking anything for Maya over $100.", "siva")
    with pytest.raises(PermissionError):
        service.confirm_rule(proposal["proposal_hash"], caller=teen.caller())
    service.confirm_rule(proposal["proposal_hash"], caller=owner.caller())
    decision = service.check_action({**action(action="booking", amount_cents=12000, request_id="approval-request", idempotency_key="approval-once")}, caller=teen.caller())
    pending = service.request_approval({**action(action="booking", amount_cents=12000, request_id="approval-request", idempotency_key="approval-once")}, decision["decision_token"], caller=teen.caller())
    with pytest.raises(PermissionError):
        service.approve(pending["approval"]["approval_id"], "maya", caller=teen.caller())


def test_cross_session_and_cross_household_tokens_fail():
    identities = DemoIdentityManager()
    owner = identities.issue("siva", "house-a")
    teen = identities.issue("maya", "house-a")
    other = identities.issue("siva", "house-b")
    service_a = make_service("house-a")
    service_b = make_service("house-b")
    proposal = service_a.propose_rule("Allow Maya to purchase snacks under $20.", "siva")
    service_a.confirm_rule(proposal["proposal_hash"], caller=owner.caller())
    request = action(request_id="cross-session", idempotency_key="cross-session-once")
    decision = service_a.check_action(request, caller=teen.caller())
    assert service_a.execute_action(request, decision["decision_token"], caller=owner.caller())["executed"] is False
    assert service_b.execute_action(request, decision["decision_token"], caller=other.caller())["executed"] is False


def test_revoked_approval_token_cannot_execute():
    identities = DemoIdentityManager()
    owner = identities.issue("siva")
    teen = identities.issue("maya")
    service = make_service()
    proposal = service.propose_rule("Ask me before booking anything for Maya over $100.", "siva")
    service.confirm_rule(proposal["proposal_hash"], caller=owner.caller())
    request = action(action="booking", amount_cents=12000, request_id="revoke-request", idempotency_key="revoke-once")
    decision = service.check_action(request, caller=teen.caller())
    pending = service.request_approval(request, decision["decision_token"], caller=teen.caller())
    approved = service.approve(pending["approval"]["approval_id"], "siva", caller=owner.caller())
    service.approve(pending["approval"]["approval_id"], "siva", False, caller=owner.caller())
    result = service.execute_action(request, decision["decision_token"], approved["approval_token"], caller=teen.caller())
    assert result["executed"] is False
    assert "revoked" in result["error"] or "not approved" in result["error"]


def test_concurrent_approval_updates_supersede_older_token():
    identities = DemoIdentityManager()
    owner = identities.issue("siva")
    teen = identities.issue("maya")
    service = make_service()
    proposal = service.propose_rule("Ask me before booking anything for Maya over $100.", "siva")
    service.confirm_rule(proposal["proposal_hash"], caller=owner.caller())
    request = action(action="booking", amount_cents=12000, request_id="approval-race", idempotency_key="approval-race")
    decision = service.check_action(request, caller=teen.caller())
    pending = service.request_approval(request, decision["decision_token"], caller=teen.caller())
    with ThreadPoolExecutor(max_workers=2) as pool:
        approvals = list(pool.map(lambda _: service.approve(pending["approval"]["approval_id"], "siva", caller=owner.caller()), [1, 2]))
    assert approvals[0]["approval"]["approval_version"] != approvals[1]["approval"]["approval_version"]
    old = service.execute_action(request, decision["decision_token"], approvals[0]["approval_token"], caller=teen.caller())
    latest = service.execute_action(request, decision["decision_token"], approvals[1]["approval_token"], caller=teen.caller())
    assert old["executed"] is False
    assert latest["executed"] is True


def test_cumulative_budget_is_rechecked_atomically_at_execution():
    identities = DemoIdentityManager()
    owner = identities.issue("siva")
    teen = identities.issue("maya")
    service = make_service()
    proposal = service.propose_rule("Allow Maya to purchase snacks under $60 per day.", "siva")
    service.confirm_rule(proposal["proposal_hash"], caller=owner.caller())
    first = action(request_id="budget-1", idempotency_key="budget-1", amount_cents=6000)
    second = action(request_id="budget-2", idempotency_key="budget-2", amount_cents=6000)
    first_decision = service.check_action(first, caller=teen.caller())
    second_decision = service.check_action(second, caller=teen.caller())
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda pair: service.execute_action(pair[0], pair[1], caller=teen.caller()), [(first, first_decision["decision_token"]), (second, second_decision["decision_token"])]))
    assert sum(int(item["executed"]) for item in results) == 1
    assert sum(item["redacted_parameters"].get("amount_cents") or 0 for item in service.store.receipts if item.get("result") == "executed") == 6000


def test_caregiver_cannot_read_private_receipts():
    identities = DemoIdentityManager()
    owner = identities.issue("siva")
    caregiver = identities.issue("nora")
    service = make_service()
    private = {**action(action="view_private", amount_cents=None, currency="", request_id="private", idempotency_key="private-once", subject_id="siva", subject_role="adult", surface="personal")}
    service.check_action(private, caller=owner.caller())
    receipts = service.get_receipts(caller=caregiver.caller())
    assert all(item.get("action") != "view_private" for item in receipts["receipts"])


def test_logout_invalidates_server_issued_session():
    identities = DemoIdentityManager()
    session = identities.issue("maya")
    assert identities.resolve(session.session_id) is not None
    assert identities.revoke(session.session_id) is True
    assert identities.resolve(session.session_id) is None
    assert identities.revoke(session.session_id) is False


@pytest.mark.asyncio
async def test_http_demo_accounts_are_isolated_and_role_checked():
    app = create_app()
    clients = {}
    try:
        for member_id in ("siva", "anika", "maya", "leo", "nora"):
            client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8787")
            login = await client.post("/api/demo-login", json={"member_id": member_id})
            assert login.status_code == 200
            status = await client.get("/api/status")
            assert status.json()["identity"]["member_id"] == member_id
            clients[member_id] = client
        assert len({client.cookies.get("PACT_SESSION_ID") for client in clients.values()}) == 5

        assert (await clients["maya"].post("/api/settings", json={"profile": {"favorite": "music"}})).status_code == 200
        leo_settings = await clients["leo"].get("/api/settings")
        assert leo_settings.json()["profile"].get("favorite") != "music"
        assert (await clients["maya"].post("/api/settings", json={"members": []})).status_code == 403

        old_session = clients["maya"].cookies.get("PACT_SESSION_ID")
        assert (await clients["maya"].post("/api/session/logout")).status_code == 200
        expired = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8787", headers={"Cookie": f"PACT_SESSION_ID={old_session}"})
        try:
            status = await expired.get("/api/status")
            assert status.json()["identity"]["auto_demo"] is True
        finally:
            await expired.aclose()
    finally:
        for client in clients.values():
            await client.aclose()

