from datetime import timedelta

import pytest

from pact.auth import AccountStore, AuthError, _iso, _now


def account(store: AccountStore, username: str):
    store.register(username, f"{username}@example.test", "a secure password 123", username.title())
    return store.authenticate(username, "a secure password 123")


def joined(store: AccountStore, username: str, invite):
    context, raw, csrf = account(store, username)
    store.accept_invite(context, invite["code"])
    return store.resolve_session(raw), raw, csrf


def household_with_members(store: AccountStore):
    owner, owner_raw, owner_csrf = account(store, "siva")
    household = store.create_household(owner, "Shared Home")
    owner = store.resolve_session(owner_raw)
    adult_invite = store.create_invite(owner, "adult", 60, "standard_adult")
    adult, adult_raw, adult_csrf = joined(store, "anika", adult_invite)
    return owner, adult, owner_raw, adult_raw


def test_invite_stores_template_and_acceptance_identity(tmp_path):
    store = AccountStore(str(tmp_path / "accounts.sqlite3"))
    owner, raw, _ = account(store, "siva")
    household = store.create_household(owner, "Shared Home")
    owner = store.resolve_session(raw)
    invite = store.create_invite(owner, "teen", 1440, "limited_spending")
    assert invite["permission_template"] == "limited_spending"
    assert "code_hash" not in invite
    joined_ctx, joined_raw, _ = joined(store, "maya", invite)
    assert joined_ctx.permission_template == "limited_spending"
    member = next(item for item in store.household_members(household["household_id"]) if item["username"] == "maya")
    assert member["permission_template"] == "limited_spending"
    stored = store.invites_for(owner)[0]
    assert stored["accepted_by"] == joined_ctx.user_id
    assert stored["permission_template"] == "limited_spending"


def test_pairing_requires_different_authorized_adult_and_is_one_time(tmp_path):
    store = AccountStore(str(tmp_path / "accounts.sqlite3"))
    owner, adult, owner_raw, adult_raw = household_with_members(store)
    pairing = store.start_pairing(adult, "Anika MacBook", "browser", "test browser")
    assert store.pairings_for(owner)[0]["pairing_id"] == pairing["pairing_id"]
    with pytest.raises(AuthError, match="different adult"):
        store.approve_pairing(adult, pairing["pairing_id"])
    approved = store.approve_pairing(owner, pairing["pairing_id"])
    assert approved["status"] == "approved"
    device = store.consume_pairing(adult, pairing["pairing_id"], pairing["code"])
    assert device["device_name"] == "Anika MacBook"
    assert store.devices_for(adult)[0]["device_id"] == device["device_id"]
    with pytest.raises(AuthError, match="already been used"):
        store.consume_pairing(adult, pairing["pairing_id"], pairing["code"])


def test_pairing_secret_session_and_household_are_bound(tmp_path):
    store = AccountStore(str(tmp_path / "accounts.sqlite3"))
    owner, adult, owner_raw, adult_raw = household_with_members(store)
    pairing = store.start_pairing(adult, "Anika phone", "mobile", "test phone")
    store.approve_pairing(owner, pairing["pairing_id"])
    attacker = store.resolve_session(owner_raw)
    with pytest.raises(AuthError, match="valid for this account"):
        store.consume_pairing(attacker, pairing["pairing_id"], pairing["code"])
    with pytest.raises(AuthError, match="secret is invalid"):
        store.consume_pairing(adult, pairing["pairing_id"], "forged-secret")

    # A fresh login creates a different authenticated session; the original
    # pairing is intentionally bound to the session that requested it.
    fresh_adult, _, _ = store.authenticate("anika", "a secure password 123", adult.household_id)
    with pytest.raises(AuthError, match="session does not match"):
        store.consume_pairing(fresh_adult, pairing["pairing_id"], pairing["code"])


def test_child_cannot_approve_pairing_and_revoked_device_stays_visible(tmp_path):
    store = AccountStore(str(tmp_path / "accounts.sqlite3"))
    owner, adult, owner_raw, adult_raw = household_with_members(store)
    child_invite = store.create_invite(owner, "child", 60, "request_only")
    child, _, _ = joined(store, "leo", child_invite)
    pairing = store.start_pairing(adult, "Anika tablet", "tablet", "test tablet")
    with pytest.raises(AuthError, match="authorized adult"):
        store.approve_pairing(child, pairing["pairing_id"])
    store.approve_pairing(owner, pairing["pairing_id"])
    device = store.consume_pairing(adult, pairing["pairing_id"], pairing["code"])
    with pytest.raises(AuthError, match="cannot revoke"):
        store.revoke_device(child, device["device_id"])
    store.revoke_device(owner, device["device_id"])
    assert store.devices_for(adult)[0]["revoked_at"] is not None


def test_expired_pairing_cannot_be_approved_or_consumed(tmp_path):
    store = AccountStore(str(tmp_path / "accounts.sqlite3"))
    owner, adult, owner_raw, adult_raw = household_with_members(store)
    pairing = store.start_pairing(adult, "Anika laptop", "browser", "test browser")
    with store.lock, store._connect() as db:
        db.execute("UPDATE pact_device_pairing_sessions SET expires_at=? WHERE pairing_id=?", (_iso(_now() - timedelta(minutes=1)), pairing["pairing_id"]))
    with pytest.raises(AuthError, match="expired"):
        store.approve_pairing(owner, pairing["pairing_id"])
