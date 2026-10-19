"""Small, explicit schema validators. The LLM never gets to bypass these."""

from __future__ import annotations

from datetime import datetime
from typing import Any

SUPPORTED_ACTIONS = {"purchase", "booking", "device_control", "view_private", "unlock", "camera"}
EFFECTS = {"allow", "ask", "deny"}
ROLES = {"adult", "teen", "child", "caregiver", "any"}
HIGH_RISK_ACTIONS = {"unlock", "camera", "view_private"}
SURFACES = {"shared_web_demo", "living_room", "dad_phone", "maya_tablet", "personal"}
ADDONS = {"", "VenueBook", "GiftCart"}


class ValidationError(ValueError):
    pass


def _required(data: dict[str, Any], field: str) -> Any:
    if field not in data:
        raise ValidationError(f"missing required field: {field}")
    return data[field]


def validate_rule(rule: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(rule, dict):
        raise ValidationError("rule must be an object")
    for field in ("rule_id", "version", "source_text", "subject", "action", "resource", "conditions", "effect", "approver", "confirmed", "proposal_hash", "created_by", "created_at"):
        _required(rule, field)
    if not isinstance(rule["rule_id"], str) or not rule["rule_id"]:
        raise ValidationError("rule_id must be non-empty")
    if not isinstance(rule["source_text"], str) or not rule["source_text"].strip():
        raise ValidationError("source_text must be non-empty")
    if rule["version"] != 1:
        raise ValidationError("unsupported rule version")
    if rule["action"] not in SUPPORTED_ACTIONS:
        raise ValidationError(f"unsupported action: {rule['action']}")
    if rule["effect"] not in EFFECTS:
        raise ValidationError("effect must be allow, ask, or deny")
    if not isinstance(rule["confirmed"], bool):
        raise ValidationError("confirmed must be boolean")
    subject = rule["subject"]
    if not isinstance(subject, dict) or subject.get("kind") != "role" or subject.get("value") not in ROLES:
        raise ValidationError("subject must be a role with a supported value")
    if not isinstance(rule["conditions"], dict):
        raise ValidationError("conditions must be an object")
    conditions = rule["conditions"]
    for key in ("amount_gt_cents", "amount_lte_cents", "cumulative_limit_cents"):
        if key in conditions and (not isinstance(conditions[key], int) or conditions[key] < 0):
            raise ValidationError(f"{key} must be a non-negative integer")
    if "currency" in conditions and (not isinstance(conditions["currency"], str) or len(conditions["currency"]) != 3):
        raise ValidationError("currency must be a three-letter code")
    if rule["effect"] == "ask" and not isinstance(rule["approver"], str):
        raise ValidationError("ask rules require an approver")
    if rule["effect"] != "ask" and rule["approver"] is not None and not isinstance(rule["approver"], str):
        raise ValidationError("approver must be null or a string")
    try:
        datetime.fromisoformat(str(rule["created_at"]).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError("created_at must be an ISO timestamp") from exc
    return rule


def validate_action(action: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(action, dict):
        raise ValidationError("action must be an object")
    for field in ("request_id", "household_id", "subject_id", "subject_role", "action", "resource", "audience", "surface", "timestamp", "idempotency_key"):
        _required(action, field)
    if action["subject_role"] not in ROLES - {"any"}:
        raise ValidationError("subject_role must be adult, teen, child, or caregiver")
    if action.get("surface") not in SURFACES:
        raise ValidationError("surface must be a supported simulated surface")
    if action.get("addon", "") not in ADDONS:
        raise ValidationError("addon must be VenueBook, GiftCart, or empty")
    for field in ("plan_id", "beneficiary", "conversation_id"):
        if field in action and action[field] is not None and not isinstance(action[field], str):
            raise ValidationError(f"{field} must be a string")
    if action["action"] not in SUPPORTED_ACTIONS:
        raise ValidationError("unknown action")
    if action.get("amount_cents") is not None and (not isinstance(action["amount_cents"], int) or action["amount_cents"] < 0):
        raise ValidationError("amount_cents must be a non-negative integer")
    if action.get("currency") is not None and action["currency"] != "" and len(str(action["currency"])) != 3:
        raise ValidationError("currency must be a three-letter code")
    if action["action"] in {"purchase", "booking"} and (action.get("amount_cents") is None or not action.get("currency")):
        raise ValidationError("amount and currency are required for purchases and bookings")
    return action

