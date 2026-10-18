"""Provider status and the optional NVIDIA Nemotron comparison client.

Nemotron is an NVIDIA model, not an Amazon model. It is informational only: it never compiles
rules, never decides policy and is never required. Keys come from the environment and are never
returned, logged or included in error text.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Callable

from .qloo_client import QlooClient, redact

NVIDIA_DEFAULT_BASE = "https://integrate.api.nvidia.com/v1"
STATES = ("connected", "demo", "unavailable")


def _nvidia_cfg() -> tuple[str, str, str]:
    return os.getenv("NVIDIA_API_KEY", ""), os.getenv("NVIDIA_MODEL_ID", ""), (os.getenv("NVIDIA_API_BASE_URL") or NVIDIA_DEFAULT_BASE).rstrip("/")


def nvidia_compare(question: str, opener: Callable[..., Any] | None = None, timeout: float = 8.0) -> dict[str, Any]:
    """Ask Nemotron the same question for side-by-side comparison. Never raises, never required."""
    key, model, base = _nvidia_cfg()
    base_result = {"provider": "nvidia", "label": "NVIDIA Nemotron comparison", "informational_only": True}
    if not key or not model:
        return {**base_result, "available": False, "reason": "NVIDIA_API_KEY or NVIDIA_MODEL_ID is not set"}
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": question[:500]}], "max_tokens": 200}).encode()
    request = urllib.request.Request(f"{base}/chat/completions", data=body, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with (opener or urllib.request.urlopen)(request, timeout=timeout) as response:
            payload = json.loads(response.read(262144).decode("utf-8"))
        text = payload["choices"][0]["message"]["content"]
        if not isinstance(text, str):
            raise ValueError("bad shape")
        return {**base_result, "available": True, "answer": text[:1200], "model": model}
    except urllib.error.HTTPError as exc:
        return {**base_result, "available": False, "reason": f"NVIDIA service returned HTTP {exc.code}"}
    except Exception as exc:
        return {**base_result, "available": False, "reason": redact(f"NVIDIA service unavailable ({type(exc).__name__})", key)}


def provider_status(compiler_status: dict[str, Any], qloo: QlooClient | Any, settings: dict[str, Any]) -> dict[str, Any]:
    """Safe status cards. Contains no secret values, only booleans and public config names."""
    bedrock_ok = bool(compiler_status.get("available"))
    nkey, nmodel, _ = _nvidia_cfg()
    qloo_on = settings.get("qloo_enabled", True) and settings.get("personalization", True)
    return {
        "bedrock": {
            "name": "Amazon Bedrock", "purpose": "Rule compilation", "state": "connected" if bedrock_ok else "demo",
            "detail": f"{compiler_status.get('model_id')} · {compiler_status.get('region')}" if bedrock_ok else (compiler_status.get("reason") or "Deterministic compiler in use"),
            "receives": "Your rule wording only. Never approval history or tokens.", "fallback": "Deterministic compiler",
        },
        "qloo": {
            "name": "Qloo", "purpose": "Taste and recommendations",
            "state": ("connected" if getattr(qloo, "configured", False) else "demo") if qloo_on else "demo",
            "detail": "Key found in environment" if getattr(qloo, "configured", False) and qloo_on else ("Switched off in Settings" if not qloo_on else "No QLOO_API_KEY: Demo recommendations"),
            "receives": "Recommendation context (category and your city). Not your PACT rules or approval history.", "fallback": "Local demo recommendations",
        },
        "nvidia": {
            "name": "NVIDIA Nemotron", "purpose": "Comparison only", "state": "connected" if (nkey and nmodel) else "unavailable",
            "detail": "Configured (informational comparison)" if (nkey and nmodel) else "Not configured. Optional; PACT does not need it.",
            "receives": "Only a question you explicitly send to compare. Never PACT data.", "fallback": "No comparison mode",
        },
    }
