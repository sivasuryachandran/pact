import pytest

from pact.service import PactService
from pact.state import StateStore
from pact.tokens import TokenManager
from pact.wallet import WalletError


def owner():
    return {
        "household_id": "house-1",
        "member_id": "siva",
        "session_id": "session-owner",
        "role": "adult",
        "account_role": "owner",
        "can_manage_rules": True,
        "can_approve": True,
        "can_access_private": True,
    }


def purchase(payment_method_id: str, amount: int = 2500, **extra):
    value = {
        "request_id": "wallet-request",
        "household_id": "house-1",
        "subject_id": "maya",
        "subject_role": "teen",
        "action": "purchase",
        "resource": "purchases",
        "category": "purchases",
        "merchant": "Mock Shop",
        "amount_cents": amount,
        "currency": "USD",
        "surface": "shared_web_demo",
        "payment_method_id": payment_method_id,
        "spending_period": "week",
        "idempotency_key": "wallet-once",
    }
    value.update(extra)
    return value


@pytest.fixture
def service(monkeypatch):
    monkeypatch.setenv("PACT_PAYMENT_PROVIDER", "mock")
    return PactService(StateStore("house-1"), token_manager=TokenManager("wallet-test-secret"))


def test_mock_card_stores_only_masked_metadata_and_permission_is_deterministic(service):
    card = service.wallet.add_card({
        "display_name": "Maya allowance",
        "brand": "Visa",
        "last4": "4242",
        "expiry_month": 12,
        "expiry_year": 2030,
        "assigned_member_ids": ["maya"],
    }, owner())
    assert card["simulated"] is True
    assert card["provider"] == "mock"
    assert card["provider_reference"].startswith("mock_")
    assert not {"pan", "card_number", "cvv", "cvc", "pin"}.intersection(card)

    service.wallet.add_permission({
        "member_id": "maya",
        "payment_method_id": card["payment_method_id"],
        "category": "purchases",
        "amount_limit_cents": 5000,
        "period": "week",
        "decision": "allow",
    }, owner())
    assert service.check_action(purchase(card["payment_method_id"]), owner())["decision"] == "allow"
    assert service.check_action(purchase(card["payment_method_id"], amount=5001), owner())["decision"] == "ask"


def test_card_assignment_and_owner_boundary_fail_closed(service):
    with pytest.raises(WalletError, match="raw card"):
        service.wallet.add_card({"display_name": "bad", "brand": "Visa", "last4": "4242", "expiry_month": 1, "expiry_year": 2030, "pan": "4111111111111111"}, owner())
    with pytest.raises(WalletError, match="owner"):
        service.wallet.add_card({"display_name": "bad", "brand": "Visa", "last4": "4242", "expiry_month": 1, "expiry_year": 2030}, {**owner(), "member_id": "maya", "account_role": "member", "can_manage_rules": False})


def test_wallet_deny_precedes_wallet_allow(service):
    card = service.wallet.add_card({"display_name": "House card", "brand": "Visa", "last4": "1111", "expiry_month": 1, "expiry_year": 2030, "assigned_member_ids": ["maya"]}, owner())
    base = {"member_id": "maya", "payment_method_id": card["payment_method_id"], "category": "purchases", "amount_limit_cents": 5000}
    service.wallet.add_permission({**base, "decision": "allow"}, owner())
    service.wallet.add_permission({**base, "decision": "block", "merchant": "Mock Shop"}, owner())
    assert service.check_action(purchase(card["payment_method_id"]), owner())["decision"] == "deny"
