def test_private_information_is_surface_bound(service):
    proposal = service.propose_rule("Show private orders only in my personal view.")
    service.confirm_rule(proposal["proposal_hash"])
    private = {"request_id":"p1","household_id":"house-1","subject_id":"siva","subject_role":"adult","action":"view_private","resource":"orders","merchant":"Mock Store","amount_cents":None,"currency":"","device":None,"audience":"owner","surface":"personal","timestamp":"2026-10-17T12:00:00Z","idempotency_key":"once-p1"}
    assert service.check_action(private)["decision"] == "allow"
    shared = {**private,"request_id":"p2","surface":"shared_web_demo","audience":"household","idempotency_key":"once-p2"}
    assert service.check_action(shared)["decision"] == "deny"

