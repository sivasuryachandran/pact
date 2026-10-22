from alexa.adapter import PactAlexaClient, handle_event


def event(intent, token="linked-token", slots=None):
    return {"session": {"user": {"accessToken": token}}, "request": {"type": "IntentRequest", "intent": {"name": intent, "slots": slots or {}}}}


def test_unlinked_user_cannot_use_adapter():
    result = handle_event(event("AMAZON.LaunchRequest", token=""))
    assert "Link your PACT account" in result["response"]["outputSpeech"]["text"]


def test_member_slot_is_not_sent_as_identity():
    calls = []

    def fake(tool, args, token):
        calls.append((tool, args, token))
        return {"spoken_summary": "The request needs approval."}

    result = handle_event(event("AskPACTIntent", slots={"request": {"value": "buy headphones"}, "member": {"value": "siva"}}), PactAlexaClient(fake))
    assert "approval" in result["response"]["outputSpeech"]["text"]
    assert calls == [("command", {"text": "buy headphones"}, "linked-token")]


def test_adapter_delegates_approval_without_reimplementing_policy():
    calls = []
    result = handle_event(event("ApprovePACTIntent"), PactAlexaClient(lambda tool, args, token: calls.append(tool) or {"spoken_summary": "Approved exact request."}))
    assert result["response"]["outputSpeech"]["text"] == "Approved exact request."
    assert calls == ["approve"]
