"""Mock Alexa+ add-ons. Every action they create must go through PACT."""

from __future__ import annotations

from typing import Any


class VenueBook:
    name = "VenueBook"

    def reservation_action(self, *, household_id: str, requester: str, requester_role: str, plan_id: str, conversation_id: str, surface: str, request_id: str, idempotency_key: str, timestamp: str) -> dict[str, Any]:
        return {
            "request_id": request_id,
            "household_id": household_id,
            "subject_id": requester,
            "subject_role": requester_role,
            "action": "booking",
            "resource": "funzone",
            "merchant": self.name,
            "amount_cents": 12000,
            "currency": "USD",
            "device": None,
            "audience": "household",
            "surface": surface,
            "plan_id": plan_id,
            "addon": self.name,
            "beneficiary": "maya",
            "conversation_id": conversation_id,
            "timestamp": timestamp,
            "idempotency_key": idempotency_key,
        }


class GiftCart:
    name = "GiftCart"

    def purchase_action(self, *, household_id: str, requester: str, requester_role: str, plan_id: str, conversation_id: str, surface: str, request_id: str, idempotency_key: str, timestamp: str) -> dict[str, Any]:
        return {
            "request_id": request_id,
            "household_id": household_id,
            "subject_id": requester,
            "subject_role": requester_role,
            "action": "purchase",
            "resource": "decorations",
            "merchant": self.name,
            "amount_cents": 4000,
            "currency": "USD",
            "device": None,
            "audience": "household",
            "surface": surface,
            "plan_id": plan_id,
            "addon": self.name,
            "beneficiary": "maya",
            "conversation_id": conversation_id,
            "timestamp": timestamp,
            "idempotency_key": idempotency_key,
        }
