"""Safe conversational presentation helpers.

This module formats deterministic service results for voice and visual clients.
It never creates an authorization decision and never executes an action.
"""

from __future__ import annotations

import re
from typing import Any


def spoken_text(value: Any, limit: int = 420) -> str:
    text = " ".join(str(value or "").split())
    text = re.sub(r"(?:decision|approval|session|household|member|token|receipt|order|request)_?[a-z_]*\s*[:=]\s*[^,; ]+", "", text, flags=re.I)
    return text.strip()[:limit]


def voice_fields(assistant_text: str, card: dict[str, Any] | None = None, trace: list[str] | None = None) -> dict[str, Any]:
    card = card or {}
    decision = card.get("decision") or {}
    if isinstance(decision, dict):
        decision_name = str(decision.get("decision") or "").lower()
    else:
        decision_name = ""
    approval = card.get("approval") or {}
    if isinstance(approval, dict):
        approval_data = approval.get("approval") if isinstance(approval.get("approval"), dict) else approval
        approval_status = str(approval_data.get("status") or "")
    else:
        approval_status = ""
    if decision_name == "ask" or approval_status == "pending":
        next_step = "adult_approval"
        requires_approval = True
    elif decision_name == "deny" or card.get("status") == "denied":
        next_step = "none"
        requires_approval = False
    elif decision_name == "allow" or approval_status == "approved":
        next_step = "execute_exact_action"
        requires_approval = False
    elif card.get("kind") == "rule_candidate":
        next_step = "confirm_rule"
        requires_approval = False
    else:
        next_step = "none"
        requires_approval = False
    return {
        "spoken_summary": spoken_text(assistant_text),
        "visual_summary": {"kind": card.get("kind", "message"), "decision": decision_name or None, "approval_status": approval_status or None, "trace": list(trace or [])},
        "requires_approval": requires_approval,
        "next_step": next_step,
    }


def follow_up_response(text: str, conversation: dict[str, Any]) -> str | None:
    """Answer safe context questions without treating context as authority."""
    lower = " ".join(text.lower().split())
    turns = conversation.get("turns") or []
    last = turns[-1] if turns else {}
    if lower in {"why", "why?"}:
        return "The last request was evaluated by the current household rules. I can show the detailed decision and approval evidence on screen."
    if "who has to approve" in lower or "who approves" in lower:
        return "An authorized adult household member must approve this exact request."
    if "how much" in lower:
        return "The exact amount and remaining household budget are shown in the action card."
    if lower in {"cancel", "cancel that", "stop"}:
        return "Cancelled the conversational follow-up. No action was executed."
    if lower in {"do it", "do that", "yes"}:
        return "I can continue only with the current signed action and any required approval. I will not bypass PACT’s execution checks."
    if last.get("assistant_text") and lower.startswith("what about"):
        return "I will re-check the current household rules for that person or item before taking any action."
    return None
