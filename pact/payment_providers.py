"""Server-side payment provider boundary for the PACT Marketplace.

Mock mode is deterministic and is the default.  The Amazon Pay adapter uses
the documented Checkout Session API only when all server-side configuration is
present.  It never turns an open/pending checkout into a successful receipt.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx


class PaymentProviderError(RuntimeError):
    pass


@dataclass(frozen=True)
class PaymentResult:
    status: str
    provider: str
    provider_reference: str | None
    message: str
    raw_status: str | None = None
    checkout_url: str | None = None


class PaymentProvider:
    name = "unknown"

    def status(self) -> dict[str, Any]:
        raise NotImplementedError

    def checkout(self, action: dict[str, Any], product: dict[str, Any]) -> PaymentResult:
        raise NotImplementedError


class MockPaymentProvider(PaymentProvider):
    name = "mock"

    def status(self) -> dict[str, Any]:
        outcome = os.getenv("PACT_MOCK_PAYMENT_OUTCOME", "success").strip().lower()
        if outcome not in {"success", "declined", "abandoned", "cancelled"}:
            outcome = "success"
        return {"name": self.name, "available": True, "environment": "local", "simulated": True, "outcome": outcome}

    def checkout(self, action: dict[str, Any], product: dict[str, Any]) -> PaymentResult:
        outcome = self.status()["outcome"]
        reference = "mock-order-" + hashlib.sha256(str(action["idempotency_key"]).encode()).hexdigest()[:16]
        messages = {
            "success": "Mock payment provider verified the simulated checkout.",
            "declined": "Mock payment provider declined the simulated checkout.",
            "abandoned": "Mock checkout was abandoned before payment completion.",
            "cancelled": "Mock checkout was cancelled before payment completion.",
        }
        return PaymentResult(outcome, self.name, reference, messages[outcome], raw_status=outcome)


def _amazon_region(value: str) -> tuple[str, str]:
    key = value.strip().lower()
    mapping = {"na": ("na", "pay-api.amazon.com"), "us": ("na", "pay-api.amazon.com"), "eu": ("eu", "pay-api.amazon.eu"), "jp": ("jp", "pay-api.amazon.jp")}
    return mapping.get(key, ("na", "pay-api.amazon.com"))


class AmazonPaySandboxProvider(PaymentProvider):
    name = "amazon_pay_sandbox"
    algorithm = "AMZN-PAY-RSASSA-PSS-V2"

    def __init__(self) -> None:
        self.environment = os.getenv("AMAZON_PAY_ENV", "sandbox").strip().lower() or "sandbox"
        self.region, self.host = _amazon_region(os.getenv("AMAZON_PAY_REGION", "na"))
        self.merchant_id = os.getenv("AMAZON_PAY_MERCHANT_ID", "").strip()
        self.public_key_id = os.getenv("AMAZON_PAY_PUBLIC_KEY_ID", "").strip()
        self.private_key_path = os.getenv("AMAZON_PAY_PRIVATE_KEY_PATH", "").strip()

    def status(self) -> dict[str, Any]:
        config_present = bool(self.merchant_id and self.public_key_id and self.private_key_path)
        key_readable = bool(self.private_key_path and Path(self.private_key_path).is_file())
        configured = self.environment == "sandbox" and config_present and key_readable
        return {
            "name": self.name,
            "available": configured,
            "configured": config_present,
            "environment": self.environment,
            "region": self.region,
            "endpoint": f"https://{self.host}/{self.environment}/v2",
            "reason": None if configured else "sandbox merchant/key configuration is incomplete",
            "simulated": False,
        }

    def _require_config(self) -> None:
        status = self.status()
        if not status["available"]:
            raise PaymentProviderError(str(status["reason"]))

    @staticmethod
    def _header_value(value: str) -> str:
        return re.sub(r"\s+", " ", value.strip())

    def _authorization(self, method: str, path: str, body: bytes, headers: dict[str, str]) -> str:
        self._require_config()
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding

        signed = {key.lower(): self._header_value(value) for key, value in headers.items()}
        signed["x-amz-pay-host"] = self.host
        signed = dict(sorted(signed.items()))
        canonical_headers = "".join(f"{key}:{value}\n" for key, value in signed.items())
        signed_headers = ";".join(signed)
        payload_hash = hashlib.sha256(body).hexdigest()
        canonical = "\n".join([method.upper(), quote(path, safe="/-_.~"), "", canonical_headers, signed_headers, payload_hash])
        digest = hashlib.sha256(canonical.encode()).hexdigest()
        string_to_sign = f"{self.algorithm}\n{digest}"
        private_key = serialization.load_pem_private_key(Path(self.private_key_path).read_bytes(), password=None)
        signature = private_key.sign(string_to_sign.encode(), padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=20), hashes.SHA256())
        encoded = base64.b64encode(signature).decode()
        return f"{self.algorithm} PublicKeyId={self.public_key_id}, SignedHeaders={signed_headers}, Signature={encoded}"

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None, idempotency_key: str | None = None) -> dict[str, Any]:
        self._require_config()
        payload = json.dumps(body or {}, separators=(",", ":"), ensure_ascii=False).encode()
        date = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        headers = {"accept": "application/json", "content-type": "application/json", "x-amz-pay-date": date, "x-amz-pay-region": self.region}
        if idempotency_key:
            headers["x-amz-pay-idempotency-key"] = idempotency_key
        headers["x-amz-pay-host"] = self.host
        headers["authorization"] = self._authorization(method, path, payload, headers)
        url = f"https://{self.host}/{self.environment}/v2{path}"
        try:
            response = httpx.request(method, url, headers=headers, content=payload, timeout=12.0)
        except httpx.HTTPError as exc:
            raise PaymentProviderError(f"Amazon Pay Sandbox request failed: {type(exc).__name__}") from exc
        if not response.is_success:
            raise PaymentProviderError(f"Amazon Pay Sandbox returned HTTP {response.status_code}")
        try:
            value = response.json()
        except ValueError as exc:
            raise PaymentProviderError("Amazon Pay Sandbox returned invalid JSON") from exc
        if not isinstance(value, dict):
            raise PaymentProviderError("Amazon Pay Sandbox returned an invalid response")
        return value

    def create_checkout_session(self, action: dict[str, Any], product: dict[str, Any], return_url: str) -> PaymentResult:
        if not (return_url.startswith("http://localhost") or return_url.startswith("https://")):
            raise PaymentProviderError("return_url must be localhost HTTP or HTTPS")
        body = {
            "storeId": self.merchant_id,
            "webCheckoutDetails": {"checkoutReviewReturnUrl": return_url, "checkoutResultReturnUrl": return_url, "checkoutCancelUrl": return_url, "checkoutMode": "ProcessOrder"},
            "paymentDetails": {"paymentIntent": "AuthorizeWithCapture", "canHandlePendingAuthorization": False, "chargeAmount": {"amount": f"{int(product['amount_cents']) / 100:.2f}", "currencyCode": product["currency"]}},
            "merchantMetadata": {"merchantReferenceId": str(action["idempotency_key"])[:256], "merchantStoreName": "PACT Marketplace", "noteToBuyer": product["title"][:255]},
        }
        response = self._request("POST", "/checkoutSessions", body, str(action["idempotency_key"]))
        session = response.get("checkoutSession", response)
        session_id = session.get("checkoutSessionId")
        redirect = (session.get("webCheckoutDetails") or {}).get("amazonPayRedirectUrl")
        return PaymentResult("pending", self.name, session_id, "Amazon Pay Sandbox checkout session created; buyer completion is still required.", raw_status=(session.get("statusDetails") or {}).get("state"), checkout_url=redirect)

    def checkout(self, action: dict[str, Any], product: dict[str, Any]) -> PaymentResult:
        raise PaymentProviderError("Amazon Pay Sandbox requires an interactive checkout session; call prepare checkout first")


def configured_provider() -> PaymentProvider:
    selected = os.getenv("PACT_PAYMENT_PROVIDER", "mock").strip().lower()
    if selected in {"amazon_pay", "amazonpay", "amazon_pay_sandbox"}:
        return AmazonPaySandboxProvider()
    if selected != "mock":
        raise PaymentProviderError("PACT_PAYMENT_PROVIDER must be mock or amazon_pay_sandbox")
    return MockPaymentProvider()


def provider_status() -> dict[str, Any]:
    try:
        provider = configured_provider()
        return provider.status()
    except PaymentProviderError as exc:
        return {"name": "unavailable", "available": False, "configured": False, "reason": str(exc), "simulated": False}
