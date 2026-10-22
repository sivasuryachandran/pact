import pytest

from pact.marketplace import get_product, product_matches_action, search_catalog
from pact.payment_providers import AmazonPaySandboxProvider, MockPaymentProvider, provider_status
from pact.service import PactService
from pact.state import StateStore
from pact.tokens import TokenManager


def test_local_catalog_is_deterministic_and_not_amazon_retail():
    results = search_catalog("headphones")
    assert [item["product_id"] for item in results] == ["pact-headphones-18"]
    assert results[0]["availability"] == "simulated"
    assert results[0]["merchant"] == "PACT Marketplace"
    assert get_product("missing") is None


def test_product_binding_requires_exact_amount_and_merchant():
    product = get_product("pact-headphones-18")
    assert product is not None
    action = {"merchant": product["merchant"], "category": product["category"], "merchant_type": product["merchant_type"], "currency": "USD", "amount_cents": 1800}
    assert product_matches_action(product, action)
    assert not product_matches_action(product, {**action, "amount_cents": 1801})
    assert not product_matches_action(product, {**action, "merchant": "Amazon.com"})


@pytest.mark.parametrize("outcome", ["success", "declined", "abandoned", "cancelled"])
def test_mock_provider_never_conflates_failure_with_success(monkeypatch, outcome):
    monkeypatch.setenv("PACT_MOCK_PAYMENT_OUTCOME", outcome)
    result = MockPaymentProvider().checkout({"idempotency_key": "payment-once"}, get_product("pact-headphones-18"))
    assert result.status == outcome
    assert (result.status == "success") is (outcome == "success")


def test_amazon_provider_requires_server_side_configuration(monkeypatch):
    for key in ("AMAZON_PAY_MERCHANT_ID", "AMAZON_PAY_PUBLIC_KEY_ID", "AMAZON_PAY_PRIVATE_KEY_PATH"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("PACT_PAYMENT_PROVIDER", "amazon_pay_sandbox")
    status = provider_status()
    assert status["available"] is False
    assert "incomplete" in status["reason"]
    assert AmazonPaySandboxProvider().status()["available"] is False


def test_mock_marketplace_checkout_is_inside_the_existing_signed_execution_path(monkeypatch):
    monkeypatch.setenv("PACT_PAYMENT_PROVIDER", "mock")
    service = PactService(StateStore("house-1"), token_manager=TokenManager("marketplace-test-secret"))
    owner = {"household_id": "house-1", "member_id": "siva", "session_id": "siva-session", "role": "adult", "account_role": "owner", "can_manage_rules": True, "can_approve": True, "can_access_private": True}
    card = service.wallet.add_card({"display_name": "Family Visa", "brand": "Visa", "last4": "4242", "expiry_month": 12, "expiry_year": 2030, "assigned_member_ids": ["maya"]}, owner)
    service.wallet.add_permission({"member_id": "maya", "payment_method_id": card["payment_method_id"], "category": "electronics", "amount_limit_cents": 2500, "decision": "allow"}, owner)
    action = {"request_id": "marketplace-request", "household_id": "house-1", "subject_id": "maya", "subject_role": "teen", "action": "purchase", "resource": "electronics", "merchant": "PACT Marketplace", "merchant_type": "marketplace", "category": "electronics", "amount_cents": 1800, "currency": "USD", "surface": "shared_web_demo", "payment_method_id": card["payment_method_id"], "product_id": "pact-headphones-18", "provider": "mock", "device_id": "device-maya", "idempotency_key": "marketplace-once"}
    checked = service.check_action(action, owner)
    assert checked["decision"] == "allow"
    executed = service.execute_action(action, checked["decision_token"], caller=owner)
    assert executed["executed"] is True
    assert executed["payment"]["provider"] == "mock"
    assert executed["payment"]["status"] == "success"


def test_mock_prepare_checkout_is_pending_until_execute(monkeypatch):
    monkeypatch.setenv("PACT_PAYMENT_PROVIDER", "mock")
    service = PactService(StateStore("house-1"), token_manager=TokenManager("marketplace-prepare-secret"))
    owner = {"household_id": "house-1", "member_id": "siva", "session_id": "siva-session", "role": "adult", "account_role": "owner", "can_manage_rules": True, "can_approve": True, "can_access_private": True}
    card = service.wallet.add_card({"display_name": "Family Visa", "brand": "Visa", "last4": "4242", "expiry_month": 12, "expiry_year": 2030, "assigned_member_ids": ["maya"]}, owner)
    service.wallet.add_permission({"member_id": "maya", "payment_method_id": card["payment_method_id"], "category": "electronics", "amount_limit_cents": 2500, "decision": "allow"}, owner)
    action = {"request_id": "marketplace-prepare", "household_id": "house-1", "subject_id": "maya", "subject_role": "teen", "action": "purchase", "resource": "electronics", "merchant": "PACT Marketplace", "merchant_type": "marketplace", "category": "electronics", "amount_cents": 1800, "currency": "USD", "surface": "shared_web_demo", "payment_method_id": card["payment_method_id"], "product_id": "pact-headphones-18", "provider": "mock", "idempotency_key": "marketplace-prepare-once"}
    checked = service.check_action(action, owner)
    prepared = service.prepare_checkout({"action": action}, checked["decision_token"], caller=owner)
    assert prepared["order"]["status"] == "pending"
    assert service.get_order_status(prepared["order"]["order_id"], owner)["order"]["status"] == "pending"


def test_provider_failure_never_creates_successful_receipt(monkeypatch):
    monkeypatch.setenv("PACT_PAYMENT_PROVIDER", "mock")
    monkeypatch.setenv("PACT_MOCK_PAYMENT_OUTCOME", "declined")
    service = PactService(StateStore("house-1"), token_manager=TokenManager("marketplace-failure-secret"))
    owner = {"household_id": "house-1", "member_id": "siva", "session_id": "siva-session", "role": "adult", "account_role": "owner", "can_manage_rules": True, "can_approve": True, "can_access_private": True}
    card = service.wallet.add_card({"display_name": "Family Visa", "brand": "Visa", "last4": "4242", "expiry_month": 12, "expiry_year": 2030, "assigned_member_ids": ["maya"]}, owner)
    service.wallet.add_permission({"member_id": "maya", "payment_method_id": card["payment_method_id"], "category": "electronics", "amount_limit_cents": 2500, "decision": "allow"}, owner)
    action = {"request_id": "marketplace-failure", "household_id": "house-1", "subject_id": "maya", "subject_role": "teen", "action": "purchase", "resource": "electronics", "merchant": "PACT Marketplace", "merchant_type": "marketplace", "category": "electronics", "amount_cents": 1800, "currency": "USD", "surface": "shared_web_demo", "payment_method_id": card["payment_method_id"], "product_id": "pact-headphones-18", "provider": "mock", "idempotency_key": "marketplace-failure-once"}
    checked = service.check_action(action, owner)
    result = service.execute_action(action, checked["decision_token"], caller=owner)
    assert result["executed"] is False
    assert result["receipt"]["result"] == "rejected"
    assert not any(receipt["result"] == "executed" and receipt["redacted_parameters"].get("product_id") == "pact-headphones-18" for receipt in service.store.receipts)
