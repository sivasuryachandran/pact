"""Lambda entrypoint wrapper; the adapter remains isolated from PACT policy."""

from alexa.adapter import lambda_handler, handle_event, PactAlexaClient

__all__ = ["lambda_handler", "handle_event", "PactAlexaClient"]
