from datetime import datetime, timedelta, timezone

import pytest

from pact.memory import MemoryError


def caller(member_id="maya", household_id="house-1", role="teen", can_approve=False, can_manage_rules=False):
    return {
        "member_id": member_id,
        "household_id": household_id,
        "session_id": f"session-{member_id}",
        "role": role,
        "account_role": "owner" if member_id == "siva" else role,
        "can_approve": can_approve,
        "can_manage_rules": can_manage_rules,
    }


def test_private_memory_requires_confirmation_and_is_member_scoped(service):
    maya = caller()
    result = service.remember_preference(maya, "favorite_color", "violet")
    assert result["status"] == "confirmation_required"
    assert service.get_memory_context(maya)["private"] == []

    saved = service.remember_preference(maya, "favorite_color", "violet", confirmed=True)
    assert saved["status"] == "saved"
    assert saved["value"] == "violet"
    assert [item["key"] for item in service.get_memory_context(maya)["private"]] == ["favorite_color"]
    assert service.get_memory_context(caller("leo", role="child"))["private"] == []


def test_shared_memory_requires_authorized_adult_and_explicit_confirmation(service):
    maya = caller()
    with pytest.raises(MemoryError, match="authorized adult"):
        service.remember_preference(maya, "family_food", "vegetarian", scope="shared_household", confirmed=True)

    siva = caller("siva", role="adult", can_approve=True, can_manage_rules=True)
    pending = service.remember_preference(siva, "family_food", "vegetarian", scope="shared_household")
    assert pending["status"] == "confirmation_required"
    saved = service.remember_preference(siva, "family_food", "vegetarian", scope="shared_household", confirmed=True)
    assert saved["status"] == "saved"
    assert service.get_memory_context(maya)["shared"][0]["key"] == "family_food"


def test_memory_forget_cannot_cross_member_or_household(service):
    maya = caller()
    saved = service.remember_preference(maya, "favorite_color", "violet", confirmed=True)
    with pytest.raises(MemoryError, match="not accessible"):
        service.forget_preference(caller("leo", role="child"), saved["memory_id"])
    with pytest.raises(MemoryError, match="not found"):
        service.forget_preference(caller("maya", household_id="house-2"), saved["memory_id"])
    forgotten = service.forget_preference(maya, saved["memory_id"])
    assert forgotten["status"] == "forgotten"
    assert service.get_memory_context(maya)["private"] == []


def test_expired_memory_is_not_returned(service):
    maya = caller()
    saved = service.remember_preference(maya, "temporary", "today", confirmed=True)
    record = service.store.get_memory(saved["memory_id"])
    record["expires_at"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat().replace("+00:00", "Z")
    service.store.save_memory(record)
    assert service.get_memory_context(maya)["private"] == []


def test_memory_does_not_change_policy_decision(service):
    maya = caller()
    service.remember_preference(maya, "trusted_merchant", "Mock Store", confirmed=True)
    action = {
        "request_id": "memory-no-authority",
        "household_id": "house-1",
        "subject_id": "maya",
        "subject_role": "teen",
        "action": "purchase",
        "resource": "electronics",
        "merchant": "Mock Store",
        "amount_cents": 1200,
        "currency": "USD",
        "surface": "shared_web_demo",
        "idempotency_key": "memory-no-authority-once",
    }
    assert service.check_action(action, caller=maya)["decision"] == "ask"
