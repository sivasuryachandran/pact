from pact.canonical import sha256_prefixed


def add_rule(service, phrase):
    proposal = service.propose_rule(phrase)
    assert proposal["status"] == "candidate"
    service.confirm_rule(proposal["proposal_hash"])


def test_allow_executes_and_denied_never_executes(service, make_action=None):
    add_rule(service, "Allow Maya to purchase snacks under $20.")
    action = {"request_id":"r1","household_id":"house-1","subject_id":"maya","subject_role":"teen","action":"purchase","resource":"snack","merchant":"Mock Store","amount_cents":1200,"currency":"USD","device":None,"audience":"household","surface":"shared_web_demo","timestamp":"2026-10-17T12:00:00Z","idempotency_key":"once-r1"}
    decision = service.check_action(action)
    assert decision["decision"] == "allow"
    assert service.execute_action(action, decision["decision_token"])["executed"] is True
    denied = {**action, "request_id":"r2", "amount_cents":2500, "idempotency_key":"once-r2"}
    result = service.check_action(denied)
    assert result["decision"] in {"ask", "deny"}
    assert service.execute_action(denied, result.get("decision_token") or "forged")["executed"] is False


def test_ask_requires_exact_approval(service):
    add_rule(service, "Ask me before booking anything over $100.")
    action = {"request_id":"r3","household_id":"house-1","subject_id":"leo","subject_role":"child","action":"booking","resource":"hotel","merchant":"Mock Travel","amount_cents":15000,"currency":"USD","device":None,"audience":"household","surface":"shared_web_demo","timestamp":"2026-10-17T12:00:00Z","idempotency_key":"once-r3"}
    decision = service.check_action(action)
    assert decision["decision"] == "ask"
    pending = service.request_approval(action, decision["decision_token"])
    assert service.execute_action(action, decision["decision_token"])["executed"] is False
    approved = service.approve(pending["approval"]["approval_id"], "siva")
    assert service.execute_action(action, decision["decision_token"], approved["approval_token"])["executed"] is True


def test_receipt_integrity_detects_mutation(service):
    add_rule(service, "Allow Maya to purchase snacks under $20.")
    action = {"request_id":"r4","household_id":"house-1","subject_id":"maya","subject_role":"teen","action":"purchase","resource":"snack","merchant":"Mock Store","amount_cents":1200,"currency":"USD","device":None,"audience":"household","surface":"shared_web_demo","timestamp":"2026-10-17T12:00:00Z","idempotency_key":"once-r4"}
    decision = service.check_action(action)
    receipt = service.execute_action(action, decision["decision_token"])["receipt"]
    from pact.receipts import verify_receipt
    assert verify_receipt(receipt)
    receipt["result"] = "executed-but-modified"
    assert not verify_receipt(receipt)

