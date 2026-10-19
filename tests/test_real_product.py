import sqlite3

import pytest

from pact.auth import AccountStore, AuthError, verify_password
from pact.compiler import deterministic_compile


def make_store(tmp_path):
    return AccountStore(str(tmp_path / "accounts.sqlite3"))


def register(store, username, role=None):
    store.register(username, f"{username}@example.test", "a secure password 123", username.title())
    context, raw, csrf = store.authenticate(username, "a secure password 123")
    if role:
        household = store.create_household(context, "Shared Home")
        context = store.resolve_session(raw)
        invite = store.create_invite(context, role)
        return context, raw, csrf, household, invite
    return context, raw, csrf


def test_registration_hashes_password_and_login_failures(tmp_path):
    store = make_store(tmp_path)
    user = store.register("siva", "siva@example.test", "a secure password 123", "Siva")
    with sqlite3.connect(store.db_path) as db:
        row = db.execute("SELECT password_hash FROM pact_users WHERE user_id=?", (user["user_id"],)).fetchone()
    assert row and row[0].startswith("scrypt$") and "a secure password 123" not in row[0]
    assert verify_password("a secure password 123", row[0])
    with pytest.raises(AuthError, match="invalid"):
        store.authenticate("siva", "wrong password")


def test_persistent_session_survives_store_restart(tmp_path):
    path = tmp_path / "accounts.sqlite3"
    first = AccountStore(str(path))
    first.register("siva", "siva@example.test", "a secure password 123")
    _, raw, _ = first.authenticate("siva", "a secure password 123")
    restarted = AccountStore(str(path))
    assert restarted.resolve_session(raw) is not None
    assert restarted.revoke_session(raw) is True
    assert restarted.resolve_session(raw) is None


def test_household_creation_and_invite_is_single_use(tmp_path):
    store = make_store(tmp_path)
    owner, _, _, household, invite = register(store, "siva", "teen")
    store.register("maya", "maya@example.test", "a secure password 123")
    maya, _, _ = store.authenticate("maya", "a secure password 123")
    joined = store.accept_invite(maya, invite["code"])
    assert joined["household_id"] == household["household_id"]
    with pytest.raises(AuthError, match="used"):
        store.accept_invite(maya, invite["code"])
    revoked = store.create_invite(owner, "child")
    store.revoke_invite(owner, revoked["invite_id"])
    with pytest.raises(AuthError, match="revoked"):
        store.accept_invite(maya, revoked["code"])


def test_invite_expiry_is_enforced(tmp_path):
    store = make_store(tmp_path)
    owner, _, _, _, invite = register(store, "siva", "caregiver")
    store.register("nora", "nora@example.test", "a secure password 123")
    nora, _, _ = store.authenticate("nora", "a secure password 123")
    with sqlite3.connect(store.db_path) as db:
        db.execute("UPDATE pact_invites SET expires_at=? WHERE invite_id=?", ("2000-01-01T00:00:00Z", invite["invite_id"]))
    with pytest.raises(AuthError, match="expired"):
        store.accept_invite(nora, invite["code"])


def test_personal_preferences_are_private_and_shared_requires_consent(tmp_path):
    store = make_store(tmp_path)
    owner, _, _, household, invite = register(store, "siva", "teen")
    store.register("maya", "maya@example.test", "a secure password 123")
    maya, _, _ = store.authenticate("maya", "a secure password 123")
    store.accept_invite(maya, invite["code"])
    maya = store.resolve_session(maya.session_id)
    store.update_profile(maya, {"interest": "music"}, {"favorite": "concerts"}, False)
    members = store.household_members(household["household_id"])
    maya_member = next(item for item in members if item["id"] == maya.user_id)
    assert maya_member["shared_preferences"] == {}
    store.update_profile(maya, shared={"favorite": "concerts"}, share_consent=True)
    maya_member = next(item for item in store.household_members(household["household_id"]) if item["id"] == maya.user_id)
    assert maya_member["shared_preferences"] == {"favorite": "concerts"}
    assert "personal" not in maya_member and "preferences" not in maya_member


def test_ask_rule_approver_binds_to_authenticated_creator():
    proposal = deterministic_compile("Ask me before booking anything over $100.", "user-owner-123")
    assert proposal["rule"]["approver"] == "user-owner-123"

