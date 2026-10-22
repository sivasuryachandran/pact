from pact.canonical import action_hash
from pact.product_discovery import (
    compare_products,
    get_product,
    parse_product_query,
    reviews,
    search_products,
)
from pact.service import PactService
from pact.state import StateStore
from pact.tokens import TokenManager


PHRASINGS = [
    "Find a laptop under $1500 with at least 16GB RAM",
    "I need a laptop below $1,500 and 512GB storage",
    "Recommend a lightweight Windows notebook under 1500 dollars",
    "Show me a Lenovo laptop with 16 GB memory",
    "I want a Mac laptop under $1300 with long battery",
    "Find a student computer with at least 8GB RAM",
    "Need a gaming laptop with 32GB RAM and RTX graphics",
    "Laptop less than $1000 with 512GB SSD",
    "A work laptop under $2,000, preferably Dell",
    "Find an Apple notebook with a 13 inch display",
    "Laptop under $1200, under 4 lbs, Windows",
    "I need 16GB RAM and 1TB storage for work",
    "Show only laptops currently in stock under $1500",
    "Recommend a school laptop with 10 hours battery",
    "Find a laptop with at least 14 inch screen",
    "I prefer Lenovo and need 16GB RAM",
    "Looking for a lightweight computer below $900",
    "Find a Windows gaming notebook under $1600",
    "Need a business laptop with 512GB drive",
    "Show laptops under $1500 with 16GB memory and 14 inch screen",
]


def test_twenty_natural_phrasings_produce_safe_structured_queries():
    for phrase in PHRASINGS:
        query = parse_product_query(phrase)
        assert query.category == "laptop"
        assert isinstance(query.hard_constraints, dict)
        assert query.contradictions == []
        assert query.as_dict()["currency"] == "USD"


def test_units_contradictions_and_hard_filtering():
    query = parse_product_query("laptop under $1500 with 1TB storage and at least 16GB RAM")
    assert query.budget_max_cents == 150000
    assert query.storage_gb_min == 1024
    assert query.ram_gb_min == 16
    assert search_products(query)
    contradictory = parse_product_query("laptop over $2000 under $1000")
    assert contradictory.contradictions
    assert search_products(contradictory) == []
    gaming = parse_product_query("gaming laptop with Ryzen 7 and RTX 4060")
    assert gaming.cpu == "ryzen 7"
    assert gaming.gpu == "rtx 4060"
    assert [item["product_id"] for item in search_products(gaming)] == ["pact-laptop-asus-gaming"]


def test_deterministic_ranking_and_evidence_do_not_invent_review_text():
    query = parse_product_query("laptop under $1500 with at least 16GB RAM")
    first = search_products(query)
    second = search_products(query)
    assert [item["product_id"] for item in first] == [item["product_id"] for item in second]
    assert first[0]["fit_score"] >= first[-1]["fit_score"]
    unknown = get_product("pact-laptop-apple-air")
    assert unknown["availability"] == "unknown"
    review = reviews("pact-laptop-hp-14")
    assert review["review_text_available"] is False
    assert review["review_text"] is None


def test_compare_is_two_to_five_products_and_revisions_are_evidence():
    result = compare_products(["pact-laptop-lenovo-14", "pact-laptop-dell-15"])
    assert len(result["products"]) == 2
    assert result["products"][0]["product_revision"]
    assert result["products"][0]["evidence"]["provider"] == "pact_sandbox"


def test_product_action_hash_binds_revision_quantity_shipping_and_payment():
    base = {"request_id": "r", "household_id": "h", "member_id": "m", "session_id": "s", "actor_role": "teen", "subject_id": "m", "subject_role": "teen", "action": "purchase", "resource": "laptop", "merchant": "PACT Sandbox Catalog", "merchant_type": "catalog", "category": "laptop", "amount_cents": 129900, "currency": "USD", "surface": "shared_web_demo", "audience": "household", "product_id": "pact-laptop-lenovo-14", "product_revision": "lenovo-14-r3", "quantity": 1, "shipping_option": "standard", "payment_method_id": "pm-1", "payment_provider": "mock", "provider": "pact_sandbox", "device_id": "d", "rule_version": 1, "timestamp": "2026-10-19T00:00:00Z", "idempotency_key": "once"}
    assert len({action_hash(base), action_hash({**base, "quantity": 2, "amount_cents": 259800}), action_hash({**base, "shipping_option": "expedited"}), action_hash({**base, "payment_method_id": "pm-2"}), action_hash({**base, "product_revision": "stale"})}) == 5


def test_purchase_request_revalidates_exact_product_and_cross_member_approval():
    service = PactService(StateStore("house-1"), token_manager=TokenManager("product-test-secret"))
    maya = {"household_id": "house-1", "member_id": "maya", "session_id": "maya-session", "role": "teen", "can_approve": False, "can_manage_rules": False, "can_access_private": False}
    siva = {"household_id": "house-1", "member_id": "siva", "session_id": "siva-session", "role": "adult", "can_approve": True, "can_manage_rules": True, "can_access_private": True, "account_role": "owner"}
    request = service.create_purchase_request("pact-laptop-lenovo-14", caller=maya)
    assert request["decision"]["decision"] == "ask"
    pending = service.request_approval(request["request"], request["decision"]["decision_token"], caller=maya)
    approved = service.approve(pending["approval"]["approval_id"], "spoofed", caller=siva)
    assert approved["approval"]["approved_by"] == "siva"
    tampered = {**request["request"], "amount_cents": request["request"]["amount_cents"] + 100}
    refused = service.execute_action(tampered, request["decision"]["decision_token"], approved["approval_token"], caller=maya)
    assert refused["executed"] is False
    executed = service.execute_action(request["request"], request["decision"]["decision_token"], approved["approval_token"], caller=maya)
    assert executed["executed"] is True
    replay = service.execute_action(request["request"], request["decision"]["decision_token"], approved["approval_token"], caller=maya)
    assert replay["executed"] is False


def test_every_purchase_binding_mutation_is_refused_before_execution():
    service = PactService(StateStore("house-1"), token_manager=TokenManager("product-binding-secret"))
    maya = {"household_id": "house-1", "member_id": "maya", "session_id": "maya-session", "role": "teen", "can_approve": False, "can_manage_rules": False, "can_access_private": False}
    siva = {"household_id": "house-1", "member_id": "siva", "session_id": "siva-session", "role": "adult", "can_approve": True, "can_manage_rules": True, "can_access_private": True, "account_role": "owner"}
    request = service.create_purchase_request("pact-laptop-dell-15", caller=maya)
    pending = service.request_approval(request["request"], request["decision"]["decision_token"], caller=maya)
    approved = service.approve(pending["approval"]["approval_id"], "siva", caller=siva)
    for changes in ({"product_revision": "dell-15-stale"}, {"quantity": 2, "amount_cents": request["request"]["amount_cents"] * 2}, {"shipping_option": "expedited"}, {"payment_method_id": "pm-other"}, {"rule_version": 99}, {"product_id": "pact-laptop-asus-gaming"}):
        refused = service.execute_action({**request["request"], **changes}, request["decision"]["decision_token"], approved["approval_token"], caller=maya)
        assert refused["executed"] is False, changes
