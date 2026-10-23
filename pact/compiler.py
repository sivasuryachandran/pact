"""Bedrock-backed rule compiler with deterministic, testable fallback."""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from .canonical import sha256_prefixed
from .schemas import ValidationError, validate_rule
from .state import now_iso


def _money(text: str) -> int | None:
    match = re.search(r"(?:\$|usd\s*)(\d+(?:\.\d{1,2})?)", text.lower())
    if not match:
        return None
    return int(round(float(match.group(1)) * 100))


def _subject(text: str) -> tuple[str, str]:
    lowered = text.lower()
    if "child" in lowered or "kids" in lowered or "kid" in lowered or "leo" in lowered:
        return "role", "child"
    if "teen" in lowered or "maya" in lowered:
        return "role", "teen"
    if "caregiver" in lowered or "nora" in lowered:
        return "role", "caregiver"
    if "adult" in lowered:
        return "role", "adult"
    return "role", "any"


def deterministic_compile(source_text: str, created_by: str = "siva") -> dict[str, Any]:
    """Parse the supported demo language; ambiguity is a first-class result."""
    text = " ".join(source_text.strip().split())
    lower = text.lower()
    if not text:
        return {"status": "rejected", "reason": "Rule text cannot be empty."}
    if any(term in lower for term in ("ignore the rules", "bypass", "forget policy", "override p a c t")):
        return {"status": "rejected", "reason": "Policy-changing instructions inside a rule are not accepted."}
    if ("small things" in lower or "a few things" in lower) and not _money(lower):
        return {"status": "clarification", "question": "What maximum amount, currency, scope, and approver should apply?"}

    action = None
    if any(word in lower for word in ("booking", "book", "reservation", "reserve")):
        action = "booking"
    elif any(word in lower for word in ("purchase", "buy", "spend", "shopping")):
        action = "purchase"
    elif any(word in lower for word in ("unlock", "lock the")):
        action = "unlock"
    elif any(word in lower for word in ("camera", "cameras")):
        action = "camera"
    elif any(word in lower for word in ("private order", "private orders", "private data")):
        action = "view_private"
    elif any(word in lower for word in ("thermostat", "lights", "light", "device", "tv")):
        action = "device_control"
    if action is None:
        return {"status": "clarification", "question": "Which supported action should this rule cover: purchase, booking, device control, private view, unlock, or camera?"}

    if action == "view_private":
        personal = "only in my personal" in lower or "personal view" in lower
        effect = "allow" if personal else ("deny" if any(x in lower for x in ("don't", "do not", "never", "must not")) else "ask")
        conditions = {"audience": "owner", "surface": "personal"} if personal else ({"audience": "household", "surface": "shared_web_demo"} if effect == "deny" and "shared" in lower else {})
        approver = created_by if effect == "ask" else None
    else:
        effect = "deny" if any(x in lower for x in ("don't allow", "do not allow", "never", "must never", "not allowed", "block")) else ("ask" if any(x in lower for x in ("ask me", "ask an adult", "need approval", "confirm")) else "allow")
        approver = created_by if effect == "ask" else None
        amount = _money(lower)
        conditions: dict[str, Any] = {}
        if amount is not None:
            if any(x in lower for x in ("over", "more than", "above", "greater than")):
                conditions["amount_gt_cents"] = amount
            elif any(x in lower for x in ("under", "less than", "up to", "at most", "below")):
                conditions["amount_lte_cents"] = amount
            else:
                return {"status": "clarification", "question": "Should the dollar amount be a strict upper bound, lower bound, or exact amount?"}
            conditions["currency"] = "USD"
        if "per day" in lower or "each day" in lower:
            limit = amount
            if limit is None:
                return {"status": "clarification", "question": "What daily cumulative amount should apply?"}
            conditions["cumulative_limit_cents"] = limit
            conditions["cumulative_window"] = "day"
            conditions.pop("amount_gt_cents", None)
            conditions.pop("amount_lte_cents", None)
            conditions["currency"] = "USD"
        if action == "device_control":
            if "thermostat" in lower:
                conditions["device"] = "thermostat"
            elif "living room" in lower and "light" in lower:
                conditions["device"] = "living_room_lights"
            elif "light" in lower:
                conditions["device"] = "lights"
            else:
                conditions["device"] = "*"
        if action == "unlock" and "front door" in lower:
            conditions["device"] = "front_door"
        if action in {"unlock", "camera"} and not any(x in lower for x in ("allow", "ask", "deny", "don't", "do not", "never", "must")):
            return {"status": "clarification", "question": "Should this high-risk action be allowed, asked about, or denied?"}

    subject_kind, subject_value = _subject(lower)
    rule_id = "rule-" + uuid.uuid4().hex[:8]
    rule = {
        "rule_id": rule_id,
        "version": 1,
        "source_text": text,
        "subject": {"kind": subject_kind, "value": subject_value},
        "action": action,
        "resource": "*",
        "conditions": conditions,
        "effect": effect,
        "approver": approver,
        "confirmed": False,
        "proposal_hash": "",
        "created_by": created_by,
        "created_at": now_iso(),
    }
    rule["proposal_hash"] = sha256_prefixed({k: v for k, v in rule.items() if k != "proposal_hash"})
    validate_rule(rule)
    read_back = _read_back(rule)
    return {"status": "candidate", "rule": rule, "proposal_hash": rule["proposal_hash"], "read_back": read_back, "compiler": "deterministic-stub"}


def _read_back(rule: dict[str, Any]) -> str:
    subject = rule["subject"]["value"]
    who = "any household member" if subject == "any" else subject
    effect = {"allow": "allow", "ask": "ask an adult before", "deny": "never allow"}[rule["effect"]]
    conditions = rule["conditions"]
    if rule["action"] == "view_private":
        if conditions.get("surface") == "shared_web_demo" and rule["effect"] == "deny":
            return "Private data is never shown on the shared household surface. Correct?"
        return "Only the owner’s personal view may show private orders. Correct?"
    if "cumulative_limit_cents" in conditions:
        target = f"${conditions['cumulative_limit_cents'] / 100:.2f} per {conditions.get('cumulative_window', 'day')}"
    elif "amount_gt_cents" in conditions:
        target = f"over ${conditions['amount_gt_cents'] / 100:.2f}"
    elif "amount_lte_cents" in conditions:
        target = f"up to ${conditions['amount_lte_cents'] / 100:.2f}"
    elif conditions.get("device"):
        target = f"on {conditions['device']}"
    else:
        target = ""
    return f"For {who}, {effect} {rule['action'].replace('_', ' ')} {target}. Correct?".replace("  ", " ")


class BedrockCompiler:
    def __init__(self) -> None:
        self.region = os.getenv("PACT_AWS_REGION") or os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or ""
        self.model_id = os.getenv("PACT_BEDROCK_MODEL_ID") or ""
        self.enabled = os.getenv("PACT_BEDROCK_ENABLED", "1").lower() not in {"0", "false", "no"}
        self.status: dict[str, Any] = {"attempted": False, "available": False, "region": self.region or None, "model_id": self.model_id or None, "failure_count": 0, "last_latency_ms": None}
        self._client = None
        self._discover()

    def _discover(self) -> None:
        if not self.enabled:
            self.status["reason"] = "disabled by PACT_BEDROCK_ENABLED"
            return
        try:
            import boto3
            session = boto3.Session(profile_name=os.getenv("AWS_PROFILE") or None, region_name=self.region or None)
            if not session.region_name:
                self.status["reason"] = "AWS region is not configured"
                return
            self.region = session.region_name
            self.status["region"] = self.region
            if session.get_credentials() is None:
                self.status["reason"] = "AWS credentials are unavailable"
                return
            from botocore.config import Config
            self._client = session.client(
                "bedrock-runtime",
                region_name=self.region,
                config=Config(retries={"max_attempts": 5, "mode": "adaptive"}),
            )
            if not self.model_id:
                catalog = session.client("bedrock", region_name=self.region).list_foundation_models()
                # Bedrock's foundation-model catalog reports deployment modes
                # (ON_DEMAND / INFERENCE_PROFILE), not a literal CONVERSE type.
                # Converse support is exercised by the runtime call below.
                candidates = [
                    x for x in catalog.get("modelSummaries", [])
                    if set(x.get("inferenceTypesSupported", [])) & {"ON_DEMAND", "INFERENCE_PROFILE"}
                    and "embed" not in x.get("modelId", "").lower()
                ]
                preferred = [x for x in candidates if x.get("modelId", "").startswith(("amazon.nova", "anthropic.claude"))]
                self.model_id = (preferred or candidates)[0]["modelId"] if (preferred or candidates) else ""
            self.status.update({"available": bool(self.model_id), "model_id": self.model_id or None, "reason": "ready" if self.model_id else "no Converse model discovered"})
        except Exception as exc:
            self.status["reason"] = f"Bedrock unavailable: {type(exc).__name__}"
            self._client = None

    def compile(self, source_text: str, created_by: str = "siva") -> dict[str, Any]:
        # Obvious policy-changing or empty input is rejected before the model
        # sees it. The model remains a proposer for valid/ambiguous language;
        # this is a deterministic safety guard, not an authorization decision.
        preflight = deterministic_compile(source_text, created_by)
        if preflight.get("status") == "rejected":
            preflight["compiler"] = "deterministic-input-guard"
            return preflight
        if self._client is not None and self.model_id:
            started = time.perf_counter()
            self.status["attempted"] = True
            prompt = (
                "Return ONLY one JSON object and no markdown. The top-level object must be either "
                "{\"status\":\"clarification\",\"question\":\"...\"} or a candidate with exactly "
                "{\"status\":\"candidate\",\"rule\":{\"rule_id\":\"...\",\"version\":1,"
                "\"source_text\":\"...\",\"subject\":{\"kind\":\"role\",\"value\":\"adult|teen|child|caregiver|any\"},"
                "\"action\":\"purchase|booking|device_control|view_private|unlock|camera\","
                "\"resource\":\"*\",\"conditions\":{},\"effect\":\"allow|ask|deny\","
                "\"approver\":null,\"confirmed\":false,\"proposal_hash\":\"\","
                "\"created_by\":\"siva\",\"created_at\":\"...\"},"
                "\"read_back\":\"...\"}. Effects are only candidate rule data; never authorize an action. "
                "If amount, currency, scope, or approver is ambiguous, use clarification instead of guessing. "
                "Interpret clear PACT conventions deterministically in the candidate: a dollar sign means USD, "
                "'ask me' means approver=created_by, no named role means subject.value=any, and 'over $N' means "
                "conditions.amount_gt_cents=N*100. "
                "For example, the exact text 'Ask me before booking anything over $100.' is a candidate with "
                "action=booking, subject.value=any, effect=ask, approver=siva, conditions.amount_gt_cents=10000, "
                "and conditions.currency=USD; do not ask for facts already clear from that wording. "
                "PACT supported actions are purchase, booking, device_control, view_private, unlock, camera. "
                "User text: " + source_text
            )
            try:
                response = self._client.converse(modelId=self.model_id, messages=[{"role": "user", "content": [{"text": prompt}]}], inferenceConfig={"temperature": 0, "maxTokens": 700})
                raw = "".join(part.get("text", "") for part in response.get("output", {}).get("message", {}).get("content", []))
                data = json.loads(raw[raw.find("{"):raw.rfind("}") + 1])
                if data.get("status") not in {"candidate", "clarification", "rejected"}:
                    raise ValidationError("Bedrock returned an unsupported compiler status")
                if data.get("status") == "candidate":
                    if not isinstance(data.get("rule"), dict):
                        raise ValidationError("Bedrock candidate is missing rule JSON")
                    data["rule"]["created_by"] = created_by
                    # The approver is decided by code, never by the model: "ask me" means the person who wrote the rule.
                    # (A model can copy an example value such as "siva" from the prompt, which names nobody in a real household.)
                    data["rule"]["approver"] = created_by if data["rule"].get("effect") == "ask" else None
                    data["rule"]["confirmed"] = False
                    data["rule"]["created_at"] = now_iso()
                    data["rule"]["proposal_hash"] = sha256_prefixed({k: v for k, v in data["rule"].items() if k != "proposal_hash"})
                    validate_rule(data["rule"])
                    if not data.get("read_back"):
                        data["read_back"] = _read_back(data["rule"])
                    data["proposal_hash"] = data["rule"]["proposal_hash"]
                    # Keep ambiguity fail-safe even if the model guesses. The
                    # Bedrock call still proposes; this deterministic lint is
                    # the final guard before a proposal can be confirmed.
                    ambiguity = deterministic_compile(source_text, created_by)
                    if ambiguity.get("status") in {"clarification", "rejected"}:
                        self.status["last_latency_ms"] = round((time.perf_counter() - started) * 1000, 1)
                        ambiguity["compiler"] = "bedrock+deterministic-ambiguity-guard"
                        return ambiguity
                data["compiler"] = "bedrock"
                self.status["last_latency_ms"] = round((time.perf_counter() - started) * 1000, 1)
                return data
            except Exception:
                self.status["failure_count"] += 1
                self.status["last_latency_ms"] = round((time.perf_counter() - started) * 1000, 1)
        return deterministic_compile(source_text, created_by)

