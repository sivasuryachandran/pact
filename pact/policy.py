"""Deterministic policy evaluation. This module does not call an LLM."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .schemas import HIGH_RISK_ACTIONS, validate_action


def _in_time_window(action: dict[str, Any], conditions: dict[str, Any]) -> bool:
    window = conditions.get("time_window")
    if not window:
        return True
    timestamp = str(action.get("timestamp", ""))
    try:
        hour = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).hour
    except ValueError:
        return False
    start, end = window.split("-", 1)
    start_hour, end_hour = int(start), int(end)
    return start_hour <= hour < end_hour if start_hour <= end_hour else hour >= start_hour or hour < end_hour


def _matches(rule: dict[str, Any], action: dict[str, Any], cumulative_cents: int = 0) -> tuple[bool, str]:
    if rule.get("subject", {}).get("value") not in {"any", action.get("subject_role")}:
        return False, "subject mismatch"
    if rule.get("action") != action.get("action"):
        return False, "action mismatch"
    resource = rule.get("resource", "*")
    if resource != "*" and resource.lower() != str(action.get("resource", "")).lower():
        return False, "resource mismatch"
    conditions = rule.get("conditions", {})
    if conditions.get("currency") and conditions["currency"] != action.get("currency"):
        return False, "currency mismatch"
    if conditions.get("member_id") and str(conditions["member_id"]) != str(action.get("subject_id")):
        return False, "member mismatch"
    if conditions.get("payment_method_id") and str(conditions["payment_method_id"]) != str(action.get("payment_method_id", "")):
        return False, "payment method mismatch"
    if conditions.get("category") and str(conditions["category"]).lower() not in {str(action.get("category", "")).lower(), str(action.get("resource", "")).lower()}:
        return False, "category mismatch"
    if conditions.get("merchant_type") and str(conditions["merchant_type"]).lower() != str(action.get("merchant_type", "")).lower():
        return False, "merchant type mismatch"
    if "amount_gt_cents" in conditions:
        if action.get("amount_cents") is None:
            return False, "missing amount"
        if action["amount_cents"] <= conditions["amount_gt_cents"]:
            return False, "amount is not over threshold"
    if "amount_lte_cents" in conditions:
        if action.get("amount_cents") is None:
            return False, "missing amount"
        if action["amount_cents"] > conditions["amount_lte_cents"]:
            return False, "amount exceeds threshold"
    if "cumulative_limit_cents" in conditions and cumulative_cents + int(action.get("amount_cents") or 0) > conditions["cumulative_limit_cents"]:
        # An allow rule is a ceiling, not permission to exceed the ceiling.
        # The caller then falls back to ask/deny rather than fail open.
        return rule.get("effect") == "deny", "cumulative limit exceeded"
    if conditions.get("merchant_allowlist") and str(action.get("merchant", "")).lower() not in {x.lower() for x in conditions["merchant_allowlist"]}:
        return False, "merchant is not allowed"
    if conditions.get("merchant_denylist") and str(action.get("merchant", "")).lower() in {x.lower() for x in conditions["merchant_denylist"]}:
        return True, "merchant is denied"
    if conditions.get("device") not in (None, "*") and str(action.get("device", "")).lower() != str(conditions["device"]).lower():
        return False, "device mismatch"
    if conditions.get("audience") and conditions["audience"] != action.get("audience"):
        return False, "audience mismatch"
    if conditions.get("surface") and conditions["surface"] != action.get("surface"):
        return False, "surface mismatch"
    if not _in_time_window(action, conditions):
        return False, "outside time window"
    return True, "matched"


def _specificity(rule: dict[str, Any]) -> int:
    conditions = rule.get("conditions", {})
    return (0 if rule.get("subject", {}).get("value") == "any" else 1) + (0 if rule.get("resource") == "*" else 1) + len(conditions)


def evaluate(action: dict[str, Any], rules: list[dict[str, Any]], cumulative_cents: int = 0) -> dict[str, Any]:
    """Return allow/ask/deny; unknown and high-risk cases fail closed."""
    try:
        validate_action(action)
    except Exception as exc:
        return {"decision": "deny" if action.get("action") in HIGH_RISK_ACTIONS else "ask", "rule_id": None, "reason": f"invalid or incomplete action: {exc}", "approver": "siva", "conflict": False}
    now = datetime.now(timezone.utc)
    applicable: list[dict[str, Any]] = []
    for rule in rules:
        if rule.get("confirmed") is not True:
            continue
        expires = rule.get("expires_at")
        if expires:
            try:
                if datetime.fromisoformat(expires.replace("Z", "+00:00")) <= now:
                    continue
            except ValueError:
                continue
        matched, _ = _matches(rule, action, cumulative_cents)
        if matched:
            applicable.append(rule)
    if not applicable:
        default_decision = "deny" if action.get("action") in HIGH_RISK_ACTIONS else "ask"
        return {"decision": default_decision, "rule_id": None, "reason": "No confirmed rule matched; default fail-safe decision.", "approver": "siva", "conflict": False}
    max_specificity = max(_specificity(rule) for rule in applicable)
    top = [rule for rule in applicable if _specificity(rule) == max_specificity]
    effects = {rule["effect"] for rule in top}
    if len(effects) > 1:
        return {"decision": "ask", "rule_id": None, "reason": "Equal-specificity rules conflict; adult confirmation required.", "approver": "siva", "conflict": True}
    # Conflict handling is scoped to equal-specificity rules. Once that
    # ambiguity is absent, the visible global precedence is deny > ask > allow.
    for effect in ("deny", "ask", "allow"):
        winners = [r for r in applicable if r["effect"] == effect]
        if winners:
            rule = sorted(winners, key=lambda r: r.get("rule_id", ""))[0]
            reason = {"deny": "A confirmed deny rule matched.", "ask": "A confirmed ask rule matched.", "allow": "A confirmed allow rule matched."}[effect]
            return {"decision": effect, "rule_id": rule["rule_id"], "reason": reason, "approver": rule.get("approver"), "conflict": False}
    return {"decision": "ask", "rule_id": None, "reason": "No safe decision could be determined.", "approver": "siva", "conflict": False}

