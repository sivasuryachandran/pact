"""HMAC decision and approval tokens with exact request binding."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from .canonical import action_hash


class TokenError(ValueError):
    pass


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class TokenManager:
    def __init__(self, secret: str | None = None) -> None:
        configured = secret or os.getenv("PACT_TOKEN_SECRET")
        # A process-local key keeps the demo runnable without making a reusable
        # signing secret part of the source tree. Set PACT_TOKEN_SECRET for a
        # stable multi-process deployment.
        self.ephemeral = configured is None
        self.secret = configured.encode() if configured is not None else secrets.token_bytes(32)

    def _sign(self, body: str) -> str:
        return _b64(hmac.new(self.secret, body.encode(), hashlib.sha256).digest())

    def _pack(self, payload: dict[str, Any]) -> str:
        body = _b64(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode())
        return body + "." + self._sign(body)

    def _unpack(self, token: str) -> dict[str, Any]:
        try:
            body, signature = token.split(".", 1)
            expected = self._sign(body)
            if not hmac.compare_digest(signature, expected):
                raise TokenError("invalid token signature")
            return json.loads(_unb64(body))
        except TokenError:
            raise
        except Exception as exc:
            raise TokenError("malformed token") from exc

    def issue_decision(self, action: dict[str, Any], ruleset_hash: str, policy_version: int, decision: str, approver: str | None, ttl_seconds: int = 30) -> str:
        issued = datetime.now(timezone.utc).replace(microsecond=0)
        payload = {
            "kind": "decision",
            "token_id": "tok-" + secrets.token_hex(8),
            "household_id": action["household_id"],
            "request_id": action["request_id"],
            "action_hash": action_hash(action),
            "ruleset_hash": ruleset_hash,
            "policy_version": policy_version,
            "decision": decision,
            "approver": approver,
            "issued_at": issued.isoformat().replace("+00:00", "Z"),
            "expires_at": (issued + timedelta(seconds=ttl_seconds)).isoformat().replace("+00:00", "Z"),
            "nonce": secrets.token_urlsafe(16),
        }
        return self._pack(payload)

    def issue_approval(self, approval: dict[str, Any], ttl_seconds: int = 60) -> str:
        issued = datetime.now(timezone.utc).replace(microsecond=0)
        payload = {**approval, "kind": "approval", "issued_at": issued.isoformat().replace("+00:00", "Z"), "expires_at": (issued + timedelta(seconds=ttl_seconds)).isoformat().replace("+00:00", "Z")}
        return self._pack(payload)

    def verify_decision(self, token: str, action: dict[str, Any], ruleset_hash: str, policy_version: int, consume_nonce: Any | None = None) -> dict[str, Any]:
        payload = self._unpack(token)
        if payload.get("kind") != "decision":
            raise TokenError("not a decision token")
        if payload.get("household_id") != action.get("household_id") or payload.get("request_id") != action.get("request_id"):
            raise TokenError("token request binding mismatch")
        if payload.get("action_hash") != action_hash(action):
            raise TokenError("token action binding mismatch")
        if payload.get("ruleset_hash") != ruleset_hash or payload.get("policy_version") != policy_version:
            raise TokenError("token policy is stale")
        try:
            if datetime.fromisoformat(payload["expires_at"].replace("Z", "+00:00")) <= datetime.now(timezone.utc):
                raise TokenError("token expired")
        except KeyError as exc:
            raise TokenError("token missing expiry") from exc
        if payload.get("decision") == "deny":
            raise TokenError("denied decision cannot execute")
        if consume_nonce is not None and payload.get("nonce") and not consume_nonce(payload["nonce"]):
            raise TokenError("token replay detected")
        return payload

    def verify_approval(self, token: str, action: dict[str, Any], policy_version: int) -> dict[str, Any]:
        payload = self._unpack(token)
        if payload.get("kind") != "approval" or payload.get("request_hash") != action_hash(action):
            raise TokenError("approval request binding mismatch")
        if payload.get("policy_version") != policy_version or payload.get("status") != "approved":
            raise TokenError("approval is stale or not approved")
        if datetime.fromisoformat(payload["expires_at"].replace("Z", "+00:00")) <= datetime.now(timezone.utc):
            raise TokenError("approval expired")
        return payload

