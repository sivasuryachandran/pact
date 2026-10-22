"""Mock-only household wallet and permission projection.

Payment data is intentionally limited to display metadata. The wallet never
accepts or stores a PAN, CVV, PIN, or other raw payment credential. Permission
records are converted into ordinary PACT policy rules so the existing
deterministic evaluator remains the only allow/ask/deny authority.
"""

from __future__ import annotations

import copy
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Protocol

from .state import StateStore, now_iso
from .payment_providers import provider_status as current_payment_provider_status


class WalletError(ValueError):
    pass


class PaymentProvider(Protocol):
    name: str

    def reference(self, payment_method_id: str) -> str: ...


class MockPaymentProvider:
    """A local provider that returns deterministic-looking simulated references."""

    name = "mock"

    def reference(self, payment_method_id: str) -> str:
        return f"mock_{payment_method_id}"


def _provider() -> MockPaymentProvider:
    # Mock is the only supported provider in this product pass. An unset
    # variable is treated as mock so local demos stay runnable.
    if os.getenv("PACT_PAYMENT_PROVIDER", "mock").strip().lower() != "mock":
        raise WalletError("only the mock payment provider is enabled")
    return MockPaymentProvider()


def _actor(caller: dict[str, Any] | None) -> str:
    return str((caller or {}).get("member_id") or "system")


def _iso_or_empty(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise WalletError("date must be an ISO timestamp") from exc
    return text


class WalletService:
    def __init__(self, store: StateStore) -> None:
        self.store = store

    @property
    def cards(self) -> dict[str, dict[str, Any]]:
        return self.store.wallet.setdefault("cards", {})

    @property
    def permissions(self) -> dict[str, dict[str, Any]]:
        return self.store.wallet.setdefault("permissions", {})

    @property
    def activity(self) -> list[dict[str, Any]]:
        return self.store.wallet.setdefault("activity", [])

    def _members(self) -> list[dict[str, Any]]:
        return list(self.store.household.get("members", []))

    def _member(self, member_id: str) -> dict[str, Any] | None:
        return next((item for item in self._members() if str(item.get("id")) == str(member_id)), None)

    def _require_owner(self, caller: dict[str, Any] | None) -> None:
        if caller is None:
            return
        if caller.get("account_role") != "owner" and not caller.get("can_manage_rules"):
            raise WalletError("only the household owner can manage simulated cards and permissions")

    def _record(self, event: str, caller: dict[str, Any] | None, **fields: Any) -> None:
        self.activity.append({
            "event_id": "wallet-event-" + uuid.uuid4().hex[:10],
            "event": event,
            "actor_id": _actor(caller),
            "household_id": self.store.household_id,
            "timestamp": now_iso(),
            **fields,
        })
        self.activity[:] = self.activity[-200:]

    def _bump_policy(self) -> None:
        self.store.policy_version += 1
        self.store._persist()

    def _card_view(self, card: dict[str, Any], caller: dict[str, Any] | None) -> dict[str, Any]:
        value = copy.deepcopy(card)
        # Cards are never visible to children. Caregivers and teens only see
        # cards explicitly assigned to them, with metadata rather than secrets.
        role = (caller or {}).get("role")
        member_id = (caller or {}).get("member_id")
        assigned = card.get("assigned_member_ids", [])
        if role == "child":
            return {}
        if role in {"teen", "caregiver"} and member_id not in assigned:
            return {}
        value["simulated"] = True
        value["label"] = "Simulated payment method"
        value.pop("created_by", None) if role not in {None, "adult"} else None
        return value

    def _visible_cards(self, caller: dict[str, Any] | None) -> list[dict[str, Any]]:
        return [view for card in self.cards.values() if (view := self._card_view(card, caller))]

    def dashboard(self, caller: dict[str, Any] | None = None) -> dict[str, Any]:
        role = (caller or {}).get("role")
        owner = (caller or {}).get("account_role") == "owner"
        visible_permissions = list(self.permissions.values()) if owner or role == "adult" else [item for item in self.permissions.values() if item.get("member_id") == (caller or {}).get("member_id")]
        members = []
        for member in self._members():
            safe = {key: copy.deepcopy(value) for key, value in member.items() if key not in {"preferences", "personal_preferences"}}
            member_id = str(member.get("id"))
            member_perms = [item for item in self.permissions.values() if item.get("member_id") == member_id and item.get("active", True)]
            safe["spending_access"] = {
                "allow": sum(item.get("decision") == "allow" for item in member_perms),
                "ask": sum(item.get("decision") == "ask" for item in member_perms),
                "block": sum(item.get("decision") == "block" for item in member_perms),
            }
            safe["approval_authority"] = bool(member.get("can_approve"))
            safe["online"] = member_id == (caller or {}).get("member_id")
            members.append(safe)
        return {
            "provider": current_payment_provider_status().get("name", "mock"),
            "provider_label": "Simulated payment methods" if current_payment_provider_status().get("simulated", True) else "External sandbox provider status",
            "household": {"household_id": self.store.household_id, "name": self.store.household.get("name", "Shared household")},
            "owner_id": next((item.get("id") for item in members if item.get("account_role") == "owner"), None),
            "members": members,
            "cards": self._visible_cards(caller),
            "permissions": copy.deepcopy(visible_permissions),
            "activity": copy.deepcopy(self.activity[-40:][::-1]),
            "receipts": copy.deepcopy(self.store.get_receipts(40)),
            "policy_version": self.store.policy_version,
        }

    def add_card(self, payload: dict[str, Any], caller: dict[str, Any] | None = None) -> dict[str, Any]:
        self._require_owner(caller)
        provider = _provider()
        forbidden = {"pan", "card_number", "number", "cvv", "cvc", "pin", "security_code", "raw_credential"}
        if any(key in payload and payload.get(key) not in (None, "") for key in forbidden):
            raise WalletError("raw card numbers, CVV, PIN, and payment credentials are not accepted")
        display_name = str(payload.get("display_name", "")).strip()[:80]
        brand = str(payload.get("brand", "")).strip()[:30]
        last4 = str(payload.get("last4", "")).strip()
        month = int(payload.get("expiry_month", 0))
        year = int(payload.get("expiry_year", 0))
        if not display_name or not brand or not re.fullmatch(r"\d{4}", last4):
            raise WalletError("display name, brand, and a masked four-digit last4 are required")
        if month not in range(1, 13) or year < datetime.now(timezone.utc).year:
            raise WalletError("expiry month/year is invalid")
        assigned = payload.get("assigned_member_ids", [])
        if not isinstance(assigned, list):
            raise WalletError("assigned_member_ids must be a list")
        member_ids = {str(item.get("id")) for item in self._members()}
        assigned = list(dict.fromkeys(str(item) for item in assigned if str(item) in member_ids))
        if not assigned and caller and caller.get("member_id"):
            assigned = [str(caller["member_id"])]
        payment_method_id = "pm-" + uuid.uuid4().hex[:12]
        card = {
            "payment_method_id": payment_method_id,
            "household_id": self.store.household_id,
            "display_name": display_name,
            "brand": brand,
            "last4": last4,
            "expiry_month": month,
            "expiry_year": year,
            "provider": provider.name,
            "provider_reference": provider.reference(payment_method_id),
            "status": "active",
            "assigned_member_ids": assigned,
            "created_by": _actor(caller),
            "created_at": now_iso(),
            "simulated": True,
            "label": "Simulated payment method",
        }
        with self.store.lock:
            self.cards[payment_method_id] = card
            self._record("card_added", caller, payment_method_id=payment_method_id, display_name=display_name)
            self._bump_policy()
        return copy.deepcopy(card)

    def update_card(self, payment_method_id: str, payload: dict[str, Any], caller: dict[str, Any] | None = None) -> dict[str, Any]:
        self._require_owner(caller)
        with self.store.lock:
            card = self.cards.get(payment_method_id)
            if not card:
                raise WalletError("payment method not found")
            if "display_name" in payload:
                card["display_name"] = str(payload["display_name"]).strip()[:80] or card["display_name"]
            if "status" in payload:
                status = str(payload["status"])
                if status not in {"active", "inactive"}:
                    raise WalletError("card status must be active or inactive")
                card["status"] = status
            if "assigned_member_ids" in payload:
                assigned = payload["assigned_member_ids"]
                if not isinstance(assigned, list):
                    raise WalletError("assigned_member_ids must be a list")
                member_ids = {str(item.get("id")) for item in self._members()}
                card["assigned_member_ids"] = list(dict.fromkeys(str(item) for item in assigned if str(item) in member_ids))
            card["updated_at"] = now_iso()
            self._record("card_updated", caller, payment_method_id=payment_method_id, status=card["status"])
            self._bump_policy()
            return copy.deepcopy(card)

    def delete_card(self, payment_method_id: str, caller: dict[str, Any] | None = None) -> None:
        self._require_owner(caller)
        with self.store.lock:
            if payment_method_id not in self.cards:
                raise WalletError("payment method not found")
            in_use = any(item.get("payment_method_id") == payment_method_id and item.get("active", True) for item in self.permissions.values())
            if in_use:
                raise WalletError("card is used by an active permission; deactivate the permission first")
            self.cards.pop(payment_method_id)
            self._record("card_removed", caller, payment_method_id=payment_method_id)
            self._bump_policy()

    def add_permission(self, payload: dict[str, Any], caller: dict[str, Any] | None = None) -> dict[str, Any]:
        self._require_owner(caller)
        member_id = str(payload.get("member_id", ""))
        if not self._member(member_id):
            raise WalletError("member is not in this household")
        decision = str(payload.get("decision", "ask")).lower()
        if decision not in {"allow", "ask", "block"}:
            raise WalletError("decision must be allow, ask, or block")
        card_id = str(payload.get("payment_method_id", ""))
        if card_id and card_id not in self.cards:
            raise WalletError("payment method not found")
        amount = payload.get("amount_limit_cents")
        amount = None if amount in (None, "") else int(amount)
        if amount is not None and amount < 0:
            raise WalletError("amount limit cannot be negative")
        approvers = payload.get("approver_ids", [])
        if isinstance(approvers, str):
            approvers = [approvers]
        if not isinstance(approvers, list):
            raise WalletError("approver_ids must be a list")
        valid_ids = {str(item.get("id")) for item in self._members()}
        approvers = list(dict.fromkeys(str(item) for item in approvers if str(item) in valid_ids))
        if decision == "ask" and not approvers:
            approvers = [str(next((item.get("id") for item in self._members() if item.get("account_role") == "owner"), "siva"))]
        permission_id = "perm-" + uuid.uuid4().hex[:12]
        permission = {
            "permission_id": permission_id,
            "household_id": self.store.household_id,
            "member_id": member_id,
            "payment_method_id": card_id,
            "category": str(payload.get("category", "purchases")).strip().lower()[:60],
            "merchant": str(payload.get("merchant", "")).strip()[:80],
            "merchant_type": str(payload.get("merchant_type", "")).strip().lower()[:60],
            "amount_limit_cents": amount,
            "period": str(payload.get("period", "one_time")).lower(),
            "decision": decision,
            "approver_ids": approvers,
            "active": bool(payload.get("active", True)),
            "starts_at": _iso_or_empty(payload.get("starts_at")),
            "expires_at": _iso_or_empty(payload.get("expires_at")),
            "version": 1,
            "created_by": _actor(caller),
            "created_at": now_iso(),
        }
        if permission["period"] not in {"one_time", "day", "week", "month"}:
            raise WalletError("period must be one_time, day, week, or month")
        with self.store.lock:
            self.permissions[permission_id] = permission
            self._record("permission_created", caller, permission_id=permission_id, member_id=member_id, decision=decision)
            self._bump_policy()
        return copy.deepcopy(permission)

    def update_permission(self, permission_id: str, payload: dict[str, Any], caller: dict[str, Any] | None = None) -> dict[str, Any]:
        self._require_owner(caller)
        with self.store.lock:
            permission = self.permissions.get(permission_id)
            if not permission:
                raise WalletError("permission not found")
            if "active" in payload:
                permission["active"] = bool(payload["active"])
            if "decision" in payload and str(payload["decision"]) in {"allow", "ask", "block"}:
                permission["decision"] = str(payload["decision"])
            permission["version"] = int(permission.get("version", 1)) + 1
            permission["updated_at"] = now_iso()
            self._record("permission_updated", caller, permission_id=permission_id, active=permission["active"])
            self._bump_policy()
            return copy.deepcopy(permission)

    def delete_permission(self, permission_id: str, caller: dict[str, Any] | None = None) -> None:
        """Retire a permission without deleting the audit history."""
        self._require_owner(caller)
        with self.store.lock:
            permission = self.permissions.get(permission_id)
            if not permission:
                raise WalletError("permission not found")
            permission["active"] = False
            permission["version"] = int(permission.get("version", 1)) + 1
            permission["updated_at"] = now_iso()
            self._record("permission_revoked", caller, permission_id=permission_id)
            self._bump_policy()

    def policy_context(self, action: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
        payment_method_id = str(action.get("payment_method_id") or "")
        if not payment_method_id:
            return [], None
        card = self.cards.get(payment_method_id)
        if not card:
            return [], "Payment method is not registered in this household."
        if card.get("status") != "active":
            return [], "Payment method is inactive."
        subject_id = str(action.get("subject_id") or action.get("member_id") or "")
        assigned = card.get("assigned_member_ids", [])
        if assigned and subject_id not in {str(item) for item in assigned}:
            return [], "Payment method is not assigned to this household member."
        member = self._member(subject_id)
        if member is None:
            return [], "Action subject is not a member of this household."
        role = str((member or {}).get("role") or action.get("subject_role") or "teen")
        rules = []
        now = datetime.now(timezone.utc)
        for item in self.permissions.values():
            if not item.get("active", True) or str(item.get("member_id")) != subject_id:
                continue
            if item.get("payment_method_id") and item["payment_method_id"] != payment_method_id:
                continue
            if item.get("category") and item["category"] not in {str(action.get("category", "")).lower(), str(action.get("resource", "")).lower()}:
                continue
            if item.get("merchant") and item["merchant"].lower() != str(action.get("merchant", "")).lower():
                continue
            if item.get("merchant_type") and item["merchant_type"].lower() != str(action.get("merchant_type", "")).lower():
                continue
            if item.get("starts_at") and datetime.fromisoformat(item["starts_at"].replace("Z", "+00:00")) > now:
                continue
            if item.get("expires_at") and datetime.fromisoformat(item["expires_at"].replace("Z", "+00:00")) <= now:
                continue
            conditions: dict[str, Any] = {
                "member_id": item["member_id"],
                "payment_method_id": payment_method_id,
                "category": item.get("category", ""),
                "currency": str(action.get("currency") or "USD"),
            }
            if item.get("merchant"):
                conditions["merchant_allowlist"] = [item["merchant"]]
            if item.get("merchant_type"):
                conditions["merchant_type"] = item["merchant_type"]
            if item.get("amount_limit_cents") is not None:
                conditions["amount_lte_cents"] = int(item["amount_limit_cents"])
                # A one-time amount is also cumulative: a new idempotency key
                # must not turn one allowance into unlimited repeated spend.
                conditions["cumulative_limit_cents"] = int(item["amount_limit_cents"])
                if item.get("period") != "one_time":
                    conditions["cumulative_window"] = item.get("period")
            rules.append({
                "rule_id": f"wallet-{item['permission_id']}-v{item.get('version', 1)}",
                "version": int(item.get("version", 1)),
                "source_text": "Structured household wallet permission",
                "subject": {"kind": "role", "value": role},
                "action": action.get("action", "purchase"),
                "resource": "*",
                "conditions": conditions,
                "effect": "deny" if item.get("decision") == "block" else item.get("decision", "ask"),
                "approver": (item.get("approver_ids") or ["siva"])[0] if item.get("decision") == "ask" else None,
                "confirmed": True,
                "proposal_hash": "wallet-permission",
                "created_by": item.get("created_by", "system"),
                "created_at": item.get("created_at", now_iso()),
            })
        return rules, None
