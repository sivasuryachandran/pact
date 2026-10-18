import base64
import json
from datetime import datetime, timedelta, timezone

import pytest

from pact.canonical import action_hash
from pact.tokens import TokenError, TokenManager


def test_tamper_parameter_and_replay_rejected():
    manager = TokenManager("secret")
    action = {"request_id":"r","household_id":"h","subject_id":"s","subject_role":"teen","action":"purchase","resource":"x","merchant":"m","amount_cents":100,"currency":"USD","device":None,"audience":"household","surface":"shared_web_demo","timestamp":"2026-10-17T00:00:00Z","idempotency_key":"i"}
    token = manager.issue_decision(action, "sha256:rules", 1, "allow", None)
    assert manager.verify_decision(token, action, "sha256:rules", 1, lambda _: True)["decision"] == "allow"
    with pytest.raises(TokenError, match="replay"):
        manager.verify_decision(token, action, "sha256:rules", 1, lambda _: False)
    token2 = manager.issue_decision(action, "sha256:rules", 1, "allow", None)
    changed = {**action, "amount_cents": 101}
    with pytest.raises(TokenError, match="action binding"):
        manager.verify_decision(token2, changed, "sha256:rules", 1, lambda _: True)


def test_expiry_policy_and_signature_rejected():
    manager = TokenManager("secret")
    action = {"request_id":"r","household_id":"h","subject_id":"s","subject_role":"teen","action":"purchase","resource":"x","merchant":"m","amount_cents":100,"currency":"USD","device":None,"audience":"household","surface":"shared_web_demo","timestamp":"2026-10-17T00:00:00Z","idempotency_key":"i"}
    token = manager.issue_decision(action, "sha256:rules", 1, "allow", None, ttl_seconds=-1)
    with pytest.raises(TokenError, match="expired"):
        manager.verify_decision(token, action, "sha256:rules", 1, lambda _: True)
    token2 = manager.issue_decision(action, "sha256:rules", 1, "allow", None)
    body, sig = token2.split(".")
    forged = body + "." + sig[:-1] + ("x" if sig[-1] != "x" else "y")
    with pytest.raises(TokenError, match="signature"):
        manager.verify_decision(forged, action, "sha256:rules", 1, lambda _: True)


def test_approval_exact_binding():
    manager = TokenManager("secret")
    action = {"request_id":"r","household_id":"h","subject_id":"s","subject_role":"teen","action":"booking","resource":"x","merchant":"m","amount_cents":4200,"currency":"USD","device":"tv","audience":"household","surface":"shared_web_demo","timestamp":"2026-10-17T00:00:00Z","idempotency_key":"i"}
    approval = {"approval_id":"a","request_hash":action_hash(action),"request_id":"r","household_id":"h","approver":"siva","policy_version":1,"status":"approved"}
    token = manager.issue_approval(approval)
    with pytest.raises(TokenError, match="binding"):
        manager.verify_approval(token, {**action, "device":"other"}, 1)

