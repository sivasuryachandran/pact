from datetime import datetime, timezone, timedelta

from pact.canonical import sha256_prefixed
from pact.policy import evaluate


def rule(rule_id, effect, action="purchase", subject="any", conditions=None, confirmed=True, **extra):
    return {"rule_id": rule_id, "version": 1, "source_text": rule_id, "subject": {"kind": "role", "value": subject}, "action": action, "resource": "*", "conditions": conditions or {}, "effect": effect, "approver": "siva" if effect == "ask" else None, "confirmed": confirmed, "proposal_hash": sha256_prefixed(rule_id), "created_by": "siva", "created_at": "2026-10-17T00:00:00Z", **extra}


def action(**changes):
    value = {"request_id":"r","household_id":"house-1","subject_id":"maya","subject_role":"teen","action":"purchase","resource":"snack","merchant":"Mock Store","amount_cents":2000,"currency":"USD","device":None,"audience":"household","surface":"shared_web_demo","timestamp":"2026-10-17T12:00:00Z","idempotency_key":"once"}
    value.update(changes)
    return value


def test_precedence_deny_over_ask_over_allow():
    rules = [rule("allow", "allow"), rule("ask", "ask", conditions={"merchant_allowlist":["Mock Store"]}), rule("deny", "deny", conditions={"merchant_allowlist":["Mock Store"], "device":"*"})]
    assert evaluate(action(), rules)["decision"] == "deny"
    assert evaluate(action(), [rule("allow", "allow"), rule("ask", "ask", conditions={"merchant_allowlist":["Mock Store"]})])["decision"] == "ask"
    assert evaluate(action(), [rule("allow", "allow")])["decision"] == "allow"


def test_conflict_unknown_and_high_risk_fail_safe():
    assert evaluate(action(), [rule("a", "allow", subject="any"), rule("b", "deny", subject="teen")])["decision"] == "deny"
    conflict = evaluate(action(), [rule("a", "allow", subject="teen", conditions={"merchant_allowlist":["Mock Store"]}), rule("b", "deny", subject="teen", conditions={"merchant_allowlist":["Mock Store"]})])
    assert conflict["decision"] == "ask" and conflict["conflict"]
    assert evaluate(action(action="camera", resource="camera", amount_cents=None, currency=""), [])["decision"] == "deny"
    assert evaluate(action(amount_cents=None, currency=""), [])["decision"] == "ask"


def test_unconfirmed_expired_and_scope_mismatch_ignored():
    expired = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat().replace("+00:00", "Z")
    assert evaluate(action(), [rule("u", "allow", confirmed=False)])["decision"] == "ask"
    assert evaluate(action(), [rule("e", "allow", expires_at=expired)])["decision"] == "ask"
    assert evaluate(action(), [rule("d", "allow", action="booking")])["decision"] == "ask"


def test_cumulative_limit_boundary():
    r = rule("daily", "allow", conditions={"cumulative_limit_cents": 3000, "cumulative_window":"day", "currency":"USD"})
    assert evaluate(action(amount_cents=2000), [r], cumulative_cents=0)["decision"] == "allow"
    assert evaluate(action(amount_cents=1000), [r], cumulative_cents=2000)["decision"] == "allow"  # exactly 30
    assert evaluate(action(amount_cents=1001), [r], cumulative_cents=2000)["decision"] == "ask"  # no rule matches after limit

