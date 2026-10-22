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
PERMISSION_TEMPLATES = {
    "owner_full_access": "Owner controls",
    "standard_adult": "Standard adult",
    "limited_spending": "Limited spending",
    "request_only": "Request only",
    "caregiver_explicit": "Caregiver — explicit actions",
}


def default_permission_template(role: str) -> str:
    return {
        "adult": "standard_adult",
        "teen": "limited_spending",
        "child": "request_only",
        "caregiver": "caregiver_explicit",
    }.get(role, "request_only")


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
    permission_template: str
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
            "permission_template": self.permission_template,
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
            "permission_template": self.permission_template,
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
                    permission_template TEXT NOT NULL DEFAULT 'request_only',
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
                    permission_template TEXT NOT NULL DEFAULT 'request_only',
                    invited_by TEXT,
                    expires_at TEXT NOT NULL,
                    accepted_at TEXT,
                    accepted_by TEXT,
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
                CREATE TABLE IF NOT EXISTS pact_devices (
                    device_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    household_id TEXT NOT NULL,
                    device_name TEXT NOT NULL,
                    device_type TEXT NOT NULL,
                    user_agent_summary TEXT NOT NULL,
                    session_hash TEXT NOT NULL,
                    trusted_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    revoked_at TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(user_id) REFERENCES pact_users(user_id),
                    FOREIGN KEY(household_id) REFERENCES pact_households(household_id)
                );
                CREATE TABLE IF NOT EXISTS pact_device_pairing_sessions (
                    pairing_id TEXT PRIMARY KEY,
                    household_id TEXT NOT NULL,
                    requesting_user_id TEXT NOT NULL,
                    pairing_secret_hash TEXT NOT NULL UNIQUE,
                    device_name TEXT NOT NULL,
                    device_type TEXT NOT NULL,
                    user_agent_summary TEXT NOT NULL,
                    session_hash TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    approved_by TEXT,
                    approved_at TEXT,
                    consumed_at TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(household_id) REFERENCES pact_households(household_id),
                    FOREIGN KEY(requesting_user_id) REFERENCES pact_users(user_id)
                );
                CREATE INDEX IF NOT EXISTS pact_sessions_user_idx ON pact_sessions(user_id);
                CREATE INDEX IF NOT EXISTS pact_memberships_user_idx ON pact_memberships(user_id);
                CREATE INDEX IF NOT EXISTS pact_invites_household_idx ON pact_invites(household_id);
                CREATE INDEX IF NOT EXISTS pact_devices_household_idx ON pact_devices(household_id);
                CREATE INDEX IF NOT EXISTS pact_pairing_household_idx ON pact_device_pairing_sessions(household_id);
                """
            )
            self._ensure_column(db, "pact_memberships", "permission_template", "TEXT NOT NULL DEFAULT 'request_only'")
            self._ensure_column(db, "pact_invites", "permission_template", "TEXT NOT NULL DEFAULT 'request_only'")
            self._ensure_column(db, "pact_invites", "invited_by", "TEXT")
            self._ensure_column(db, "pact_invites", "accepted_by", "TEXT")
            db.execute("UPDATE pact_memberships SET permission_template='owner_full_access' WHERE account_role='owner' AND permission_template='request_only'")

    @staticmethod
    def _ensure_column(db: sqlite3.Connection, table: str, column: str, definition: str) -> None:
        columns = {row[1] for row in db.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in columns:
            db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

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
                       m.role, m.account_role, m.permission_template
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
            permission_template=row["permission_template"] or default_permission_template(role or ""),
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
            db.execute("INSERT INTO pact_memberships(membership_id,household_id,user_id,role,account_role,permission_template,created_at) VALUES(?,?,?,?,?,?,?)", (membership_id, household_id, ctx.user_id, "adult", "owner", "owner_full_access", _iso()))
            db.execute("INSERT INTO pact_profiles(user_id,household_id,personal_json,shared_json,share_consent,updated_at) VALUES(?,?,?,?,?,?)", (ctx.user_id, household_id, "{}", "{}", 0, _iso()))
            self._update_session_household(db, ctx.session_id, household_id, membership_id)
        return {"household_id": household_id, "name": name, "membership_id": membership_id, "role": "adult", "account_role": "owner"}

    def _update_session_household(self, db: sqlite3.Connection, raw_session: str, household_id: str, membership_id: str) -> None:
        db.execute("UPDATE pact_sessions SET household_id=?, membership_id=? WHERE session_hash=?", (household_id, membership_id, _hash_secret(raw_session)))

    def create_invite(self, ctx: AuthContext, role: str, expires_minutes: int = 60, permission_template: str | None = None) -> dict[str, Any]:
        membership = self._require_membership(ctx)
        if membership["account_role"] not in {"owner", "co_parent"}:
            raise AuthError("only the owner or co-parent can invite household members")
        if role not in ROLES:
            raise AuthError("invite role must be adult, teen, child, or caregiver")
        permission_template = permission_template or default_permission_template(role)
        if permission_template not in PERMISSION_TEMPLATES:
            raise AuthError("unknown permission template")
        expires_minutes = max(5, min(int(expires_minutes), 7 * 24 * 60))
        raw_code = secrets.token_urlsafe(12)
        invite_id = "invite-" + secrets.token_urlsafe(12)
        expires = _now() + timedelta(minutes=expires_minutes)
        with self.lock, self._connect() as db:
            db.execute("INSERT INTO pact_invites(invite_id,household_id,inviter_membership_id,code_hash,role,permission_template,invited_by,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)", (invite_id, membership["household_id"], membership["membership_id"], _hash_secret(raw_code), role, permission_template, ctx.user_id, _iso(expires), _iso()))
        return {"invite_id": invite_id, "household_id": membership["household_id"], "role": role, "permission_template": permission_template, "expires_at": _iso(expires), "code": raw_code}

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
            db.execute("INSERT INTO pact_memberships(membership_id,household_id,user_id,role,account_role,permission_template,created_at) VALUES(?,?,?,?,?,?,?)", (membership_id, row["household_id"], ctx.user_id, row["role"], account_role, row["permission_template"] or default_permission_template(row["role"]), _iso()))
            db.execute("INSERT INTO pact_profiles(user_id,household_id,personal_json,shared_json,share_consent,updated_at) VALUES(?,?,?,?,?,?)", (ctx.user_id, row["household_id"], "{}", "{}", 0, _iso()))
            db.execute("UPDATE pact_invites SET accepted_at=?, accepted_by=? WHERE invite_id=? AND accepted_at IS NULL", (_iso(), ctx.user_id, row["invite_id"]))
            if db.total_changes < 3:
                raise AuthError("invite could not be accepted")
            self._update_session_household(db, ctx.session_id, row["household_id"], membership_id)
        return {"household_id": row["household_id"], "membership_id": membership_id, "role": row["role"], "account_role": account_role, "permission_template": row["permission_template"] or default_permission_template(row["role"])}

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
            rows = db.execute("SELECT invite_id,household_id,role,permission_template,invited_by,expires_at,accepted_by,accepted_at,revoked_at,created_at FROM pact_invites WHERE household_id=? ORDER BY created_at DESC", (membership["household_id"],)).fetchall()
        return [dict(row) for row in rows]

    def start_pairing(self, ctx: AuthContext, device_name: str, device_type: str, user_agent_summary: str) -> dict[str, Any]:
        membership = self._require_membership(ctx)
        name = str(device_name or "My device").strip()[:80] or "My device"
        kind = str(device_type or "browser").strip()[:40] or "browser"
        ua = str(user_agent_summary or "browser").strip()[:240] or "browser"
        secret = secrets.token_urlsafe(18)
        pairing_id = "pairing-" + secrets.token_urlsafe(12)
        expires = _now() + timedelta(minutes=10)
        with self.lock, self._connect() as db:
            db.execute("INSERT INTO pact_device_pairing_sessions(pairing_id,household_id,requesting_user_id,pairing_secret_hash,device_name,device_type,user_agent_summary,session_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", (pairing_id, membership["household_id"], ctx.user_id, _hash_secret(secret), name, kind, ua, _hash_secret(ctx.session_id), _iso(expires), _iso()))
        return {"pairing_id": pairing_id, "household_id": membership["household_id"], "device_name": name, "device_type": kind, "expires_at": _iso(expires), "code": secret}

    def pairings_for(self, ctx: AuthContext) -> list[dict[str, Any]]:
        membership = self._require_membership(ctx)
        authorized = membership["account_role"] in {"owner", "co_parent"} or membership["role"] == "adult"
        query = "SELECT pairing_id,household_id,requesting_user_id,device_name,device_type,user_agent_summary,expires_at,approved_by,approved_at,consumed_at,created_at FROM pact_device_pairing_sessions WHERE household_id=? AND consumed_at IS NULL ORDER BY created_at DESC"
        params: tuple[Any, ...] = (membership["household_id"],)
        if not authorized:
            query = query.replace(" WHERE household_id=?", " WHERE household_id=? AND requesting_user_id=?")
            params = (membership["household_id"], ctx.user_id)
        with self._connect() as db:
            rows = db.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def approve_pairing(self, ctx: AuthContext, pairing_id: str) -> dict[str, Any]:
        membership = self._require_membership(ctx)
        if membership["account_role"] not in {"owner", "co_parent"} and membership["role"] != "adult":
            raise AuthError("only an authorized adult can approve trusted devices")
        with self.lock, self._connect() as db:
            row = db.execute("SELECT * FROM pact_device_pairing_sessions WHERE pairing_id=? AND household_id=?", (pairing_id, membership["household_id"])).fetchone()
            if row is None or row["consumed_at"]:
                raise AuthError("pairing request is not pending")
            if row["approved_at"]:
                return {"pairing_id": pairing_id, "status": "approved", "approved_at": row["approved_at"]}
            if row["requesting_user_id"] == ctx.user_id:
                raise AuthError("a trusted device requires a different adult approval")
            if datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00")) <= _now():
                raise AuthError("pairing request has expired")
            approved = _iso()
            db.execute("UPDATE pact_device_pairing_sessions SET approved_by=?, approved_at=? WHERE pairing_id=? AND approved_at IS NULL", (ctx.user_id, approved, pairing_id))
        return {"pairing_id": pairing_id, "status": "approved", "approved_at": approved}

    def consume_pairing(self, ctx: AuthContext, pairing_id: str, secret: str) -> dict[str, Any]:
        membership = self._require_membership(ctx)
        with self.lock, self._connect() as db:
            row = db.execute("SELECT * FROM pact_device_pairing_sessions WHERE pairing_id=? AND household_id=?", (pairing_id, membership["household_id"])).fetchone()
            if row is None or row["requesting_user_id"] != ctx.user_id:
                raise AuthError("pairing request is not valid for this account")
            if row["consumed_at"]:
                raise AuthError("pairing request has already been used")
            if not row["approved_at"]:
                raise AuthError("pairing still needs adult approval")
            if datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00")) <= _now():
                raise AuthError("pairing request has expired")
            if not hmac.compare_digest(row["pairing_secret_hash"], _hash_secret(str(secret or ""))):
                raise AuthError("pairing secret is invalid")
            if not hmac.compare_digest(row["session_hash"], _hash_secret(ctx.session_id)):
                raise AuthError("pairing session does not match")
            device_id = "device-" + secrets.token_urlsafe(12)
            now = _iso()
            db.execute("INSERT INTO pact_devices(device_id,user_id,household_id,device_name,device_type,user_agent_summary,session_hash,trusted_at,last_seen_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", (device_id, ctx.user_id, membership["household_id"], row["device_name"], row["device_type"], row["user_agent_summary"], row["session_hash"], now, now, now))
            db.execute("UPDATE pact_device_pairing_sessions SET consumed_at=? WHERE pairing_id=? AND consumed_at IS NULL", (now, pairing_id))
        return {"device_id": device_id, "household_id": membership["household_id"], "device_name": row["device_name"], "device_type": row["device_type"], "trusted_at": now}

    def devices_for(self, ctx: AuthContext) -> list[dict[str, Any]]:
        membership = self._require_membership(ctx)
        authorized = membership["account_role"] in {"owner", "co_parent"} or membership["role"] == "adult"
        query = "SELECT device_id,user_id,household_id,device_name,device_type,user_agent_summary,trusted_at,last_seen_at,revoked_at,created_at FROM pact_devices WHERE household_id=?"
        params: tuple[Any, ...] = (membership["household_id"],)
        if not authorized:
            query += " AND user_id=?"
            params = (membership["household_id"], ctx.user_id)
        with self._connect() as db:
            rows = db.execute(query + " ORDER BY trusted_at DESC", params).fetchall()
        return [dict(row) for row in rows]

    def revoke_device(self, ctx: AuthContext, device_id: str) -> None:
        membership = self._require_membership(ctx)
        with self.lock, self._connect() as db:
            row = db.execute("SELECT user_id FROM pact_devices WHERE device_id=? AND household_id=?", (device_id, membership["household_id"])).fetchone()
            if row is None:
                raise AuthError("device not found")
            authorized = membership["account_role"] in {"owner", "co_parent"} or membership["role"] == "adult"
            if not authorized and row["user_id"] != ctx.user_id:
                raise AuthError("you cannot revoke this device")
            db.execute("UPDATE pact_devices SET revoked_at=? WHERE device_id=? AND revoked_at IS NULL", (_iso(), device_id))

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
                "permission_template": row["permission_template"] or default_permission_template(row["role"]),
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

