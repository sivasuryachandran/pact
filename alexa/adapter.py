"""Thin, un-deployed Alexa adapter for PACT.

This module has no policy or approval logic. Account linking is required, and
Alexa slots never select a household member. Network calls stay behind the
PactAlexaClient seam so the adapter can be tested without credentials.
"""

from __future__ import annotations

from typing import Any, Callable


class AlexaAdapterError(RuntimeError):
    pass


def _access_token(event: dict[str, Any]) -> str | None:
    session = event.get("session") or {}
    user = session.get("user") or {}
    token = user.get("accessToken")
    if isinstance(token, str) and token.strip():
        return token.strip()
    system_user = (((event.get("context") or {}).get("System") or {}).get("user") or {})
    token = system_user.get("accessToken")
    return token.strip() if isinstance(token, str) and token.strip() else None


class PactAlexaClient:
    def __init__(self, call: Callable[[str, dict[str, Any], str], dict[str, Any]] | None = None):
        self._call = call

    def call(self, tool: str, arguments: dict[str, Any], access_token: str) -> dict[str, Any]:
        if self._call is None:
            raise AlexaAdapterError("PACT Alexa account-link client is not configured")
        return self._call(tool, arguments, access_token)


def _speech(text: str, should_end: bool = False) -> dict[str, Any]:
    return {"version": "1.0", "response": {"outputSpeech": {"type": "PlainText", "text": text}, "shouldEndSession": should_end}}


def handle_event(event: dict[str, Any], client: PactAlexaClient | None = None) -> dict[str, Any]:
    token = _access_token(event)
    if not token:
        return _speech("Link your PACT account before using household permissions.")
    client = client or PactAlexaClient()
    intent = (((event.get("request") or {}).get("intent") or {}).get("name") or "")
    slots = (((event.get("request") or {}).get("intent") or {}).get("slots") or {})
    if intent in {"LaunchRequest", "AMAZON.LaunchRequest"}:
        return _speech("PACT is ready. Ask me to check a household action.")
    if intent in {"AMAZON.StopIntent", "AMAZON.CancelIntent"}:
        return _speech("Okay. Nothing was changed.", True)
    if intent == "AMAZON.HelpIntent":
        return _speech("You can ask PACT to check an action, ask for status, or remember a preference.")
    if intent == "AskPACTIntent":
        request = str((slots.get("request") or {}).get("value") or "").strip()
        if not request:
            return _speech("What should I check?")
        result = client.call("command", {"text": request}, token)
        return _speech(str(result.get("spoken_summary") or result.get("assistant_text") or "PACT returned a result."))
    if intent == "ApprovePACTIntent":
        result = client.call("approve", {}, token)
        return _speech(str(result.get("spoken_summary") or "PACT checked the approval."))
    if intent == "StatusPACTIntent":
        result = client.call("get_order_status", {}, token)
        return _speech(str(result.get("spoken_summary") or "PACT checked the current status."))
    if intent == "RememberPACTIntent":
        request = str((slots.get("request") or {}).get("value") or "").strip()
        result = client.call("remember_preference", {"request": request}, token)
        return _speech(str(result.get("spoken_summary") or "PACT needs confirmation before saving that."))
    if intent == "ForgetPACTIntent":
        result = client.call("forget_preference", {}, token)
        return _speech(str(result.get("spoken_summary") or "PACT checked your saved memories."))
    return _speech("I can check a household action, approval, status, or explicit memory request.")


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    return handle_event(event)
