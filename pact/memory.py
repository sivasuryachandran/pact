"""Small, explicit household memory with strict scope boundaries.

Memory is personalization context only. It is never consulted by the policy
engine as authorization input and never changes an action, budget, approval,
or token.
"""

from __future__ import annotations

import copy
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from .state import StateStore, now_iso


class MemoryError(ValueError):
    pass


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _safe_text(value: Any, field: str, limit: int) -> str:
    if not isinstance(value, str):
        raise MemoryError(f"{field} must be text")
    value = " ".join(value.split()).strip()
    if not value or len(value) > limit:
        raise MemoryError(f"{field} must be 1-{limit} characters")
    return value


class MemoryService:
    def __init__(self, store: StateStore) -> None:
        self.store = store

    @staticmethod
    def _caller(caller: dict[str, Any] | None) -> dict[str, Any]:
        if not caller or not caller.get("member_id") or not caller.get("household_id"):
            raise MemoryError("authenticated household context required")
        return caller

    def _visible(self, caller: dict[str, Any], include_shared: bool = True) -> list[dict[str, Any]]:
        current = self._caller(caller)
        now = datetime.now(timezone.utc)
        visible: list[dict[str, Any]] = []
        for item in self.store.list_memories():
            expires = _parse(item.get("expires_at"))
            if expires and expires <= now:
                self.store.delete_memory(item["memory_id"])
                continue
            if item.get("household_id") != current.get("household_id"):
                continue
            if item.get("scope") == "private_member" and item.get("owner_member_id") != current.get("member_id"):
                continue
            if item.get("scope") == "shared_household" and not include_shared:
                continue
            safe = copy.deepcopy(item)
            safe.pop("value_json", None)
            safe["value"] = json.loads(item["value_json"])
            visible.append(safe)
        return sorted(visible, key=lambda item: item.get("updated_at", ""), reverse=True)

    def context(self, caller: dict[str, Any]) -> dict[str, Any]:
        visible = self._visible(caller)
        return {
            "private": [item for item in visible if item.get("scope") == "private_member"],
            "shared": [item for item in visible if item.get("scope") == "shared_household"],
            "scope": "private_member+shared_household",
        }

    def list_current(self, caller: dict[str, Any]) -> list[dict[str, Any]]:
        return self._visible(caller)

    def list_shared(self, caller: dict[str, Any]) -> list[dict[str, Any]]:
        return [item for item in self._visible(caller) if item.get("scope") == "shared_household"]

    def remember(
        self,
        caller: dict[str, Any],
        key: Any,
        value: Any,
        *,
        scope: str = "private_member",
        confirmed: bool = False,
        expires_in_days: int | None = 90,
    ) -> dict[str, Any]:
        current = self._caller(caller)
        key_text = _safe_text(key, "key", 80)
        if len(json.dumps(value, ensure_ascii=False)) > 1000:
            raise MemoryError("memory value is too large")
        if scope not in {"private_member", "shared_household"}:
            raise MemoryError("scope must be private_member or shared_household")
        if scope == "shared_household" and not (current.get("can_approve") or current.get("can_manage_rules")):
            raise MemoryError("only an authorized adult can save shared household memory")
        if not confirmed:
            return {
                "status": "confirmation_required",
                "scope": scope,
                "key": key_text,
                "spoken_summary": f"I can remember {key_text} as {scope.replace('_', ' ')} memory. Should I save it?",
                "next_step": "confirm_memory",
            }
        if expires_in_days is not None and not 1 <= int(expires_in_days) <= 365:
            raise MemoryError("expires_in_days must be between 1 and 365")
        created = now_iso()
        memory_id = "mem-" + secrets.token_urlsafe(12)
        expires = (datetime.now(timezone.utc) + timedelta(days=int(expires_in_days))).replace(microsecond=0).isoformat().replace("+00:00", "Z") if expires_in_days else None
        record = {
            "memory_id": memory_id,
            "household_id": current["household_id"],
            "member_id": current["member_id"],
            "scope": scope,
            "owner_member_id": current["member_id"] if scope == "private_member" else None,
            "key": key_text,
            "value_json": json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            "source": "explicit",
            "consent_state": "confirmed",
            "created_at": created,
            "updated_at": created,
            "expires_at": expires,
            "created_by": current["member_id"],
            "version": 1,
        }
        self.store.save_memory(record)
        self.store.add_trust_event({"event": "memory_saved", "memory_id": memory_id, "scope": scope, "member_id": current["member_id"], "household_id": current["household_id"], "key_hash": hashlib.sha256(key_text.encode()).hexdigest()[:16], "timestamp": created})
        result = copy.deepcopy(record)
        result.pop("value_json", None)
        result["value"] = value
        result.update({"status": "saved", "spoken_summary": "Saved. This memory can personalize PACT, but it cannot authorize an action.", "next_step": "none"})
        return result

    def forget(self, caller: dict[str, Any], memory_id: str) -> dict[str, Any]:
        current = self._caller(caller)
        record = self.store.get_memory(memory_id)
        if not record or record.get("household_id") != current.get("household_id"):
            raise MemoryError("memory not found")
        if record.get("scope") == "private_member" and record.get("owner_member_id") != current.get("member_id"):
            raise MemoryError("private memory is not accessible")
        if record.get("scope") == "shared_household" and not (current.get("can_approve") or current.get("can_manage_rules")):
            raise MemoryError("only an authorized adult can forget shared household memory")
        self.store.delete_memory(memory_id)
        self.store.add_trust_event({"event": "memory_forgotten", "memory_id": memory_id, "scope": record.get("scope"), "member_id": current["member_id"], "household_id": current["household_id"], "timestamp": now_iso()})
        return {"status": "forgotten", "memory_id": memory_id, "spoken_summary": "Forgotten. It will no longer be used as household context."}
