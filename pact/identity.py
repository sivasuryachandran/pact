"""Demo-grade server-issued household identities and sessions.

This is intentionally not production authentication. It provides separate,
server-issued sessions for the five seeded demo members so authorization tests
can exercise real household boundaries without storing plaintext passwords or
pretending to implement OAuth.
"""

from __future__ import annotations

import copy
import secrets
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any


DEMO_HOUSEHOLD_ID = "demo-household"


def _member(
    member_id: str,
    name: str,
    role: str,
    account_role: str,
    preferences: dict[str, Any],
    *,
    can_approve: bool = False,
    can_manage_rules: bool = False,
    can_access_private: bool = False,
) -> dict[str, Any]:
    return {
        "id": member_id,
        "name": name,
        "role": role,
        "account_role": account_role,
        "preferences": preferences,
        "can_approve": can_approve,
        "can_manage_rules": can_manage_rules,
        "can_access_private": can_access_private,
    }


def seeded_demo_members() -> list[dict[str, Any]]:
    return [
        _member("siva", "Siva", "adult", "owner", {"diet": "vegetarian", "style": "budget-conscious", "interest": "documentaries"}, can_approve=True, can_manage_rules=True, can_access_private=True),
        _member("anika", "Anika", "adult", "co_parent", {"interest": "sports", "style": "live events", "threshold": "$250"}, can_approve=True, can_access_private=True),
        _member("maya", "Maya", "teen", "teen", {"interest": "games, music, fashion", "allowance_cents": 3000}),
        _member("leo", "Leo", "child", "child", {"interest": "age-appropriate cartoons and books"}),
        _member("nora", "Nora", "caregiver", "caregiver", {"interest": "accessibility and groceries"}),
    ]


@dataclass(frozen=True)
class SessionContext:
    session_id: str
    household_id: str
    member_id: str
    name: str
    role: str
    account_role: str
    preferences: dict[str, Any]
    can_approve: bool
    can_manage_rules: bool
    can_access_private: bool
    issued_at: str
    expires_at: str

    def public(self) -> dict[str, Any]:
        value = dict(self.__dict__)
        value["preferences"] = copy.deepcopy(self.preferences)
        return value

    def caller(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "household_id": self.household_id,
            "member_id": self.member_id,
            "name": self.name,
            "role": self.role,
            "account_role": self.account_role,
            "preferences": copy.deepcopy(self.preferences),
            "can_approve": self.can_approve,
            "can_manage_rules": self.can_manage_rules,
            "can_access_private": self.can_access_private,
        }


class IdentityError(ValueError):
    pass


class DemoIdentityManager:
    def __init__(self, ttl_seconds: int = 60 * 60 * 24 * 7) -> None:
        self.ttl_seconds = ttl_seconds
        self._sessions: dict[str, SessionContext] = {}
        self._revoked: set[str] = set()
        self._lock = threading.RLock()
        self._members = {item["id"]: item for item in seeded_demo_members()}

    def members(self) -> list[dict[str, Any]]:
        with self._lock:
            return copy.deepcopy(list(self._members.values()))

    def issue(self, member_id: str, household_id: str = DEMO_HOUSEHOLD_ID) -> SessionContext:
        with self._lock:
            member = self._members.get(member_id)
            if member is None:
                raise IdentityError("unknown demo member")
            issued = datetime.now(timezone.utc).replace(microsecond=0)
            session_id = "sess-" + secrets.token_urlsafe(30)
            context = SessionContext(
                session_id=session_id,
                household_id=household_id,
                member_id=member["id"],
                name=member["name"],
                role=member["role"],
                account_role=member["account_role"],
                preferences=copy.deepcopy(member["preferences"]),
                can_approve=bool(member["can_approve"]),
                can_manage_rules=bool(member["can_manage_rules"]),
                can_access_private=bool(member["can_access_private"]),
                issued_at=issued.isoformat().replace("+00:00", "Z"),
                expires_at=(issued + timedelta(seconds=self.ttl_seconds)).isoformat().replace("+00:00", "Z"),
            )
            self._sessions[session_id] = context
            return context

    def resolve(self, session_id: str | None) -> SessionContext | None:
        if not session_id:
            return None
        with self._lock:
            if session_id in self._revoked:
                return None
            context = self._sessions.get(session_id)
            if context is None:
                return None
            if datetime.fromisoformat(context.expires_at.replace("Z", "+00:00")) <= datetime.now(timezone.utc):
                self._revoked.add(session_id)
                self._sessions.pop(session_id, None)
                return None
            return context

    def revoke(self, session_id: str | None) -> bool:
        if not session_id:
            return False
        with self._lock:
            existed = session_id in self._sessions and session_id not in self._revoked
            self._revoked.add(session_id)
            self._sessions.pop(session_id, None)
            return existed

