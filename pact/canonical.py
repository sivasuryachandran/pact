"""Canonical representations used by policy hashes and signed tokens."""

from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_prefixed(value: Any) -> str:
    raw = value if isinstance(value, str) else canonical_json(value)
    return "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def normalized_action(action: dict[str, Any]) -> dict[str, Any]:
    """Keep only the signed action surface; user-controlled extras are excluded."""
    return {
        "request_id": str(action.get("request_id", "")),
        "household_id": str(action.get("household_id", "")),
        "member_id": str(action.get("member_id", "")),
        "session_id": str(action.get("session_id", "")),
        "actor_role": str(action.get("actor_role", "")),
        "subject_id": str(action.get("subject_id", "")),
        "subject_role": str(action.get("subject_role", "")).lower(),
        "action": str(action.get("action", "")).lower(),
        "resource": str(action.get("resource", "")).lower(),
        "merchant": str(action.get("merchant", "")).lower(),
        "merchant_type": str(action.get("merchant_type", "")).lower(),
        "payment_method_id": str(action.get("payment_method_id", "")),
        "device_id": str(action.get("device_id", "")),
        "provider": str(action.get("provider", "")).lower(),
        "catalog_provider": str(action.get("catalog_provider", "")).lower(),
        "payment_provider": str(action.get("payment_provider", "")).lower(),
        "product_id": str(action.get("product_id", "")),
        "product_revision": str(action.get("product_revision", "")),
        "quantity": int(action.get("quantity", 1) or 1),
        "shipping_option": str(action.get("shipping_option", "standard")).lower(),
        "rule_version": int(action["rule_version"]) if action.get("rule_version") is not None else None,
        "category": str(action.get("category", "")).lower(),
        "spending_period": str(action.get("spending_period", "")).lower(),
        "amount_cents": int(action["amount_cents"]) if action.get("amount_cents") is not None else None,
        "currency": str(action.get("currency", "")).upper(),
        "device": str(action.get("device", "")).lower() if action.get("device") is not None else None,
        "audience": str(action.get("audience", "")).lower(),
        "surface": str(action.get("surface", "")).lower(),
        "plan_id": str(action.get("plan_id", "")),
        "addon": str(action.get("addon", "")).lower(),
        "beneficiary": str(action.get("beneficiary", "")).lower(),
        "conversation_id": str(action.get("conversation_id", "")),
        "timestamp": str(action.get("timestamp", "")),
        "idempotency_key": str(action.get("idempotency_key", "")),
    }


def action_hash(action: dict[str, Any]) -> str:
    return sha256_prefixed(normalized_action(action))


def ruleset_hash(rules: list[dict[str, Any]]) -> str:
    active = [r for r in rules if r.get("confirmed") is True]
    return sha256_prefixed(sorted(active, key=lambda r: (r.get("rule_id", ""), int(r.get("version", 0)))))

