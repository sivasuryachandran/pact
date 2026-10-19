"""Tamper-evident demo receipts; not legal or production audit records."""

from __future__ import annotations

from typing import Any

from .canonical import sha256_prefixed
from .state import now_iso


def create_receipt(action: dict[str, Any], decision: str, result: str, rule_id: str | None, approval_id: str | None, token_id: str | None, policy_version: int, reason: str, previous_hash: str | None = None) -> dict[str, Any]:
    redacted = {"merchant": action.get("merchant"), "amount_cents": action.get("amount_cents"), "currency": action.get("currency"), "device": action.get("device"), "resource": action.get("resource"), "plan_id": action.get("plan_id", ""), "addon": action.get("addon", ""), "beneficiary": action.get("beneficiary", action.get("subject_id"))}
    if action.get("surface") == "shared_web_demo" and action.get("action") == "view_private":
        redacted = {"redacted": True, "surface": action.get("surface")}
    receipt = {
        "receipt_id": "rcpt-" + __import__("secrets").token_hex(6),
        "timestamp": now_iso(),
        "household_id": action.get("household_id"),
        "member_id": action.get("member_id"),
        "subject_id": action.get("subject_id"),
        "action": action.get("action"),
        "redacted_parameters": redacted,
        "rule_id": rule_id,
        "decision": decision,
        "approval_id": approval_id,
        "token_id": token_id,
        "policy_version": policy_version,
        "result": result,
        "reason": reason,
    }
    receipt["previous_hash"] = previous_hash
    receipt["receipt_hash"] = sha256_prefixed({k: v for k, v in receipt.items() if k != "receipt_hash"})
    return receipt


def verify_receipt(receipt: dict[str, Any]) -> bool:
    expected = sha256_prefixed({k: v for k, v in receipt.items() if k != "receipt_hash"})
    return expected == receipt.get("receipt_hash")

