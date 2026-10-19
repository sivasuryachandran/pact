"""Local account, household, invite, session, and preference persistence.

This is intentionally a small hackathon authentication system. It is real
local authentication (passwords are scrypt hashes and sessions are persisted
as hashes), but it is not a claim of production identity assurance.
"""

from __future__ import annotations

import copy
import hashlib
import hmac
import json
import secrets
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any


class AuthError(ValueError):
    pass


ROLES = {"adult", "teen", "child", "caregiver"}
ACCOUNT_ROLES = {"owner", "co_parent", "member", "caregiver"}


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _iso(moment: datetime | None = None) -> str:
    return (moment or _now()).isoformat().replace("+00:00", "Z")


def _canonical(value: Any) -> str:
    return str(value or "").strip().lower()


def _hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    if not isinstance(password, str) or len(password) < 8 or len(password) > 256:
        raise AuthError("password must be between 8 and 256 characters")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
    return "scrypt$16384$8$1$" + salt.hex() + "$" + digest.hex()


def verify_password(password: str, encoded: str) -> bool:
    try:
        method, n, r, p, salt_hex, digest_hex = encoded.split("$", 5)
        if method != "scrypt":
            return False
        candidate = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=int(n),
            r=int(r),
            p=int(p),
        ).hex()
        return hmac.compare_digest(candidate, digest_hex)
    except (TypeError, ValueError):
        return False


@dataclass(frozen=True)
class AuthContext:
    session_id: str
    user_id: str
    username: str
    email: str
    display_name: str
    household_id: str | None
    membership_id: str | None
    role: str | None
    account_role: str | None
    can_approve: bool
    can_manage_rules: bool
    can_access_private: bool
    issued_at: str
    expires_at: str

    @property
    def member_id(self) -> str:
        return self.user_id

    def caller(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "household_id": self.household_id,
            "membership_id": self.membership_id,
            "member_id": self.user_id,
            "name": self.display_name,
            "username": self.username,
            "email": self.email,
            "role": self.role,
            "account_role": self.account_role,
            "can_approve": self.can_approve,
            "can_manage_rules": self.can_manage_rules,
            "can_access_private": self.can_access_private,
        }

    def public(self) -> dict[str, Any]:
        return {
            "session_active": True,
            "user_id": self.user_id,
            "username": self.username,
            "email": self.email,
            "display_name": self.display_name,
            "household_id": self.household_id,
            "membership_id": self.membership_id,
            "role": self.role,
            "account_role": self.account_role,
            "can_approve": self.can_approve,
            "can_manage_rules": self.can_manage_rules,
            "can_access_private": self.can_access_private,
            "issued_at": self.issued_at,
            "expires_at": self.expires_at,
        }


class AccountStore:
    """SQLite-backed local accounts and household membership."""

    def __init__(self, db_path: str = "pact-data.sqlite3", session_ttl_seconds: int = 60 * 60 * 24 * 14) -> None:
        self.db_path = db_path
        self.session_ttl_seconds = session_ttl_seconds
        self.lock = threading.RLock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.db_path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def _init_db(self) -> None:
        with self.lock, self._connect() as db:
            db.executescript(
                """
                PRAGMA foreign_keys = ON;
                CREATE TABLE IF NOT EXISTS pact_users (
                    user_id TEXT PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    email TEXT UNIQUE,
                    display_name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS pact_households (
                    household_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_by TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(created_by) REFERENCES pact_users(user_id)
                );
                CREATE TABLE IF NOT EXISTS pact_memberships (
                    membership_id TEXT PRIMARY KEY,
                    household_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    account_role TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(household_id, user_id),
                    FOREIGN KEY(household_id) REFERENCES pact_households(household_id),
                    FOREIGN KEY(user_id) REFERENCES pact_users(user_id)
                );
                CREATE TABLE IF NOT EXISTS pact_sessions (
                    session_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    household_id TEXT,
                    membership_id TEXT,
                    csrf_hash TEXT NOT NULL,
                    issued_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    revoked_at TEXT,
                    FOREIGN KEY(user_id) REFERENCES pact_users(user_id)
                );
                CREATE TABLE IF NOT EXISTS pact_invites (
                    invite_id TEXT PRIMARY KEY,
                    household_id TEXT NOT NULL,
                    inviter_membership_id TEXT NOT NULL,
                    code_hash TEXT NOT NULL UNIQUE,
                    role TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    accepted_at TEXT,
                    revoked_at TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(household_id) REFERENCES pact_households(household_id),
                    FOREIGN KEY(inviter_membership_id) REFERENCES pact_memberships(membership_id)
                );
                CREATE TABLE IF NOT EXISTS pact_profiles (
                    user_id TEXT NOT NULL,
                    household_id TEXT NOT NULL,
                    personal_json TEXT NOT NULL,
                    shared_json TEXT NOT NULL,
                    share_consent INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(user_id, household_id),
                    FOREIGN KEY(user_id) REFERENCES pact_users(user_id),
                    FOREIGN KEY(household_id) REFERENCES pact_households(household_id)
                );
                CREATE INDEX IF NOT EXISTS pact_sessions_user_idx ON pact_sessions(user_id);
                CREATE INDEX IF NOT EXISTS pact_memberships_user_idx ON pact_memberships(user_id);
                CREATE INDEX IF NOT EXISTS pact_invites_household_idx ON pact_invites(household_id);
                """
            )

    def register(self, username: str, email: str, password: str, display_name: str | None = None) -> dict[str, Any]:
        username = _canonical(username)
        email = _canonical(email)
        display_name = (display_name or username).strip()[:80]
        if len(username) < 3 or len(username) > 64 or not username.replace("_", "").replace("-", "").isalnum():
            raise AuthError("username must be 3-64 letters, numbers, hyphens, or underscores")
        if email and ("@" not in email or len(email) > 254):
            raise AuthError("email must be a valid-looking address")
        password_hash = hash_password(password)
        user_id = "user-" + secrets.token_urlsafe(16)
        with self.lock, self._connect() as db:
            try:
                db.execute(
                    "INSERT INTO pact_users(user_id,username,email,display_name,password_hash,created_at) VALUES(?,?,?,?,?,?)",
                    (user_id, username, email or None, display_name or username, password_hash, _iso()),
                )
            except sqlite3.IntegrityError as exc:
                raise AuthError("username or email is already registered") from exc
        return {"user_id": user_id, "username": username, "email": email, "display_name": display_name or username}

    def _user_row(self, identifier: str) -> sqlite3.Row | None:
        value = _canonical(identifier)
        with self._connect() as db:
            return db.execute("SELECT * FROM pact_users WHERE username = ? OR email = ?", (value, value)).fetchone()

    def authenticate(self, identifier: str, password: str, household_id: str | None = None) -> tuple[AuthContext, str, str]:
        row = self._user_row(identifier)
        if row is None or not verify_password(password, row["password_hash"]):
            raise AuthError("invalid username/email or password")
        memberships = self.memberships_for_user(row["user_id"])
        selected = None
        if household_id:
            selected = next((item for item in memberships if item["household_id"] == household_id), None)
            if selected is None:
                raise AuthError("you are not a member of that household")
        elif len(memberships) == 1:
            selected = memberships[0]
        elif len(memberships) > 1:
            raise AuthError("choose a household before signing in")
        return self._new_session(row, selected)

    def _new_session(self, user: sqlite3.Row, membership: dict[str, Any] | None) -> tuple[AuthContext, str, str]:
        raw = secrets.token_urlsafe(36)
        csrf = secrets.token_urlsafe(24)
        issued = _now()
        expires = issued + timedelta(seconds=self.session_ttl_seconds)
        household_id = membership.get("household_id") if membership else None
        membership_id = membership.get("membership_id") if membership else None
        with self.lock, self._connect() as db:
            db.execute(
                "INSERT INTO pact_sessions(session_hash,user_id,household_id,membership_id,csrf_hash,issued_at,expires_at) VALUES(?,?,?,?,?,?,?)",
                (_hash_secret(raw), user["user_id"], household_id, membership_id, _hash_secret(csrf), _iso(issued), _iso(expires)),
            )
        return self.resolve_session(raw), raw, csrf  # type: ignore[return-value]

    def resolve_session(self, raw_session: str | None) -> AuthContext | None:
        if not raw_session:
            return None
        with self.lock, self._connect() as db:
            row = db.execute(
                """
                SELECT s.*, u.username, u.email, u.display_name,
                       m.role, m.account_role
                FROM pact_sessions s JOIN pact_users u ON u.user_id=s.user_id
                LEFT JOIN pact_memberships m ON m.membership_id=s.membership_id
                WHERE s.session_hash = ? AND s.revoked_at IS NULL
                """,
                (_hash_secret(raw_session),),
            ).fetchone()
            if row is None:
                return None
            if datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00")) <= _now():
                db.execute("UPDATE pact_sessions SET revoked_at = ? WHERE session_hash = ?", (_iso(), _hash_secret(raw_session)))
                return None
        role = row["role"]
        account_role = row["account_role"]
        return AuthContext(
            session_id=raw_session,
            user_id=row["user_id"],
            username=row["username"],
            email=row["email"] or "",
            display_name=row["display_name"],
            household_id=row["household_id"],
            membership_id=row["membership_id"],
            role=role,
            account_role=account_role,
            can_approve=role == "adult",
            can_manage_rules=account_role == "owner",
            can_access_private=role == "adult",
            issued_at=row["issued_at"],
            expires_at=row["expires_at"],
        )

    def csrf_valid(self, raw_session: str | None, csrf: str | None) -> bool:
        if not raw_session or not csrf:
            return False
        with self.lock, self._connect() as db:
            row = db.execute("SELECT csrf_hash FROM pact_sessions WHERE session_hash = ? AND revoked_at IS NULL", (_hash_secret(raw_session),)).fetchone()
        return bool(row and hmac.compare_digest(row["csrf_hash"], _hash_secret(csrf)))

    def revoke_session(self, raw_session: str | None) -> bool:
        if not raw_session:
            return False
        with self.lock, self._connect() as db:
            result = db.execute("UPDATE pact_sessions SET revoked_at = ? WHERE session_hash = ? AND revoked_at IS NULL", (_iso(), _hash_secret(raw_session)))
            return result.rowcount == 1

    def memberships_for_user(self, user_id: str) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT m.*, h.name AS household_name FROM pact_memberships m JOIN pact_households h ON h.household_id=m.household_id WHERE m.user_id=? ORDER BY m.created_at",
                (user_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def households_for_user(self, user_id: str) -> list[dict[str, Any]]:
        return [{"household_id": x["household_id"], "name": x["household_name"], "role": x["role"], "account_role": x["account_role"], "membership_id": x["membership_id"]} for x in self.memberships_for_user(user_id)]

    def _require_membership(self, ctx: AuthContext, household_id: str | None = None) -> dict[str, Any]:
        target = household_id or ctx.household_id
        if not target:
            raise AuthError("create or join a household first")
        item = next((x for x in self.memberships_for_user(ctx.user_id) if x["household_id"] == target), None)
        if item is None:
            raise AuthError("you are not a member of this household")
        return item

    def create_household(self, ctx: AuthContext, name: str) -> dict[str, Any]:
        name = str(name or "").strip()
        if not 2 <= len(name) <= 80:
            raise AuthError("household name must be 2-80 characters")
        household_id = "house-" + secrets.token_urlsafe(16)
        membership_id = "membership-" + secrets.token_urlsafe(12)
        with self.lock, self._connect() as db:
            db.execute("INSERT INTO pact_households(household_id,name,created_by,created_at) VALUES(?,?,?,?)", (household_id, name, ctx.user_id, _iso()))
            db.execute("INSERT INTO pact_memberships(membership_id,household_id,user_id,role,account_role,created_at) VALUES(?,?,?,?,?,?)", (membership_id, household_id, ctx.user_id, "adult", "owner", _iso()))
            db.execute("INSERT INTO pact_profiles(user_id,household_id,personal_json,shared_json,share_consent,updated_at) VALUES(?,?,?,?,?,?)", (ctx.user_id, household_id, "{}", "{}", 0, _iso()))
            self._update_session_household(db, ctx.session_id, household_id, membership_id)
        return {"household_id": household_id, "name": name, "membership_id": membership_id, "role": "adult", "account_role": "owner"}

    def _update_session_household(self, db: sqlite3.Connection, raw_session: str, household_id: str, membership_id: str) -> None:
        db.execute("UPDATE pact_sessions SET household_id=?, membership_id=? WHERE session_hash=?", (household_id, membership_id, _hash_secret(raw_session)))

    def create_invite(self, ctx: AuthContext, role: str, expires_minutes: int = 60) -> dict[str, Any]:
        membership = self._require_membership(ctx)
        if membership["account_role"] not in {"owner", "co_parent"}:
            raise AuthError("only the owner or co-parent can invite household members")
        if role not in ROLES:
            raise AuthError("invite role must be adult, teen, child, or caregiver")
        expires_minutes = max(5, min(int(expires_minutes), 7 * 24 * 60))
        raw_code = secrets.token_urlsafe(12)
        invite_id = "invite-" + secrets.token_urlsafe(12)
        expires = _now() + timedelta(minutes=expires_minutes)
        with self.lock, self._connect() as db:
            db.execute("INSERT INTO pact_invites(invite_id,household_id,inviter_membership_id,code_hash,role,expires_at,created_at) VALUES(?,?,?,?,?,?,?)", (invite_id, membership["household_id"], membership["membership_id"], _hash_secret(raw_code), role, _iso(expires), _iso()))
        return {"invite_id": invite_id, "household_id": membership["household_id"], "role": role, "expires_at": _iso(expires), "code": raw_code}

    def accept_invite(self, ctx: AuthContext, code: str) -> dict[str, Any]:
        code = str(code or "").strip()
        with self.lock, self._connect() as db:
            row = db.execute("SELECT * FROM pact_invites WHERE code_hash=?", (_hash_secret(code),)).fetchone()
            if row is None:
                raise AuthError("invite is invalid")
            if row["accepted_at"] or row["revoked_at"]:
                raise AuthError("invite is already used or revoked")
            if datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00")) <= _now():
                raise AuthError("invite has expired")
            if db.execute("SELECT 1 FROM pact_memberships WHERE household_id=? AND user_id=?", (row["household_id"], ctx.user_id)).fetchone():
                raise AuthError("you are already in this household")
            membership_id = "membership-" + secrets.token_urlsafe(12)
            account_role = "co_parent" if row["role"] == "adult" else ("caregiver" if row["role"] == "caregiver" else "member")
            db.execute("INSERT INTO pact_memberships(membership_id,household_id,user_id,role,account_role,created_at) VALUES(?,?,?,?,?,?)", (membership_id, row["household_id"], ctx.user_id, row["role"], account_role, _iso()))
            db.execute("INSERT INTO pact_profiles(user_id,household_id,personal_json,shared_json,share_consent,updated_at) VALUES(?,?,?,?,?,?)", (ctx.user_id, row["household_id"], "{}", "{}", 0, _iso()))
            db.execute("UPDATE pact_invites SET accepted_at=? WHERE invite_id=? AND accepted_at IS NULL", (_iso(), row["invite_id"]))
            if db.total_changes < 3:
                raise AuthError("invite could not be accepted")
            self._update_session_household(db, ctx.session_id, row["household_id"], membership_id)
        return {"household_id": row["household_id"], "membership_id": membership_id, "role": row["role"], "account_role": account_role}

    def revoke_invite(self, ctx: AuthContext, invite_id: str) -> None:
        membership = self._require_membership(ctx)
        if membership["account_role"] not in {"owner", "co_parent"}:
            raise AuthError("only the owner or co-parent can revoke invites")
        with self.lock, self._connect() as db:
            result = db.execute("UPDATE pact_invites SET revoked_at=? WHERE invite_id=? AND household_id=? AND accepted_at IS NULL", (_iso(), invite_id, membership["household_id"]))
            if result.rowcount != 1:
                raise AuthError("invite not found or already used")

    def invites_for(self, ctx: AuthContext) -> list[dict[str, Any]]:
        membership = self._require_membership(ctx)
        with self._connect() as db:
            rows = db.execute("SELECT invite_id,household_id,role,expires_at,accepted_at,revoked_at,created_at FROM pact_invites WHERE household_id=? ORDER BY created_at DESC", (membership["household_id"],)).fetchall()
        return [dict(row) for row in rows]

    def profile(self, ctx: AuthContext) -> dict[str, Any]:
        membership = self._require_membership(ctx)
        with self._connect() as db:
            row = db.execute("SELECT personal_json,shared_json,share_consent,updated_at FROM pact_profiles WHERE user_id=? AND household_id=?", (ctx.user_id, membership["household_id"])).fetchone()
        if row is None:
            return {"personal": {}, "shared": {}, "share_consent": False}
        return {"personal": json.loads(row["personal_json"]), "shared": json.loads(row["shared_json"]), "share_consent": bool(row["share_consent"]), "updated_at": row["updated_at"]}

    def update_profile(self, ctx: AuthContext, personal: dict[str, Any] | None = None, shared: dict[str, Any] | None = None, share_consent: bool | None = None) -> dict[str, Any]:
        membership = self._require_membership(ctx)
        current = self.profile(ctx)
        if personal is not None:
            current["personal"] = copy.deepcopy(personal)
        if shared is not None:
            current["shared"] = copy.deepcopy(shared)
        if share_consent is not None:
            current["share_consent"] = bool(share_consent)
        with self.lock, self._connect() as db:
            db.execute("INSERT INTO pact_profiles(user_id,household_id,personal_json,shared_json,share_consent,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,household_id) DO UPDATE SET personal_json=excluded.personal_json,shared_json=excluded.shared_json,share_consent=excluded.share_consent,updated_at=excluded.updated_at", (ctx.user_id, membership["household_id"], json.dumps(current["personal"], sort_keys=True), json.dumps(current["shared"], sort_keys=True), int(current["share_consent"]), _iso()))
        return self.profile(ctx)

    def household_members(self, household_id: str) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                """
                SELECT m.*, u.username, u.email, u.display_name,
                       p.shared_json, p.share_consent
                FROM pact_memberships m JOIN pact_users u ON u.user_id=m.user_id
                LEFT JOIN pact_profiles p ON p.user_id=m.user_id AND p.household_id=m.household_id
                WHERE m.household_id=? ORDER BY m.created_at
                """,
                (household_id,),
            ).fetchall()
        members = []
        for row in rows:
            shared = json.loads(row["shared_json"] or "{}") if row["share_consent"] else {}
            members.append({
                "id": row["user_id"],
                "name": row["display_name"],
                "username": row["username"],
                "role": row["role"],
                "account_role": row["account_role"],
                "can_approve": row["role"] == "adult",
                "can_manage_rules": row["account_role"] == "owner",
                "can_access_private": row["role"] == "adult",
                "shared_preferences": shared,
                "preferences_shared": bool(row["share_consent"]),
            })
        return members

    def household_public(self, household_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT household_id,name,created_by,created_at FROM pact_households WHERE household_id=?", (household_id,)).fetchone()
        if row is None:
            raise AuthError("household not found")
        return {**dict(row), "members": self.household_members(household_id)}

    def household_exists(self, household_id: str) -> bool:
        with self._connect() as db:
            return db.execute("SELECT 1 FROM pact_households WHERE household_id=?", (household_id,)).fetchone() is not None

