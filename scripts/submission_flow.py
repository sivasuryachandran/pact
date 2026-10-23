#!/usr/bin/env python3
"""End-to-end laptop purchase flow against a running PACT server, over real HTTP and MCP.

Five household accounts in five separate authenticated sessions: Maya asks for a laptop, PACT
returns ASK, Maya cannot self-approve, Siva approves from his own session, the unchanged request
executes once, and the receipt and MCP trace are checked. Prints PASS/FAIL per step and exits
nonzero if any step fails. Passwords are throwaway values created for this run and never printed.

Usage: PACT_URL=http://127.0.0.1:8830 python3 scripts/submission_flow.py [--json out.json]
"""

from __future__ import annotations

import copy
import json
import os
import re
import secrets
import sys
import time
from typing import Any

import httpx

BASE = os.environ.get("PACT_URL", "http://127.0.0.1:8787").rstrip("/")
PROTOCOL = "2025-11-25"
DEMO_QUERY = "I need a laptop for Python development, 16 GB RAM minimum, under $900, good battery life, and strong reviews"
RESULTS: list[dict[str, Any]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append({"step": name, "passed": bool(ok), "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not ok else ""))
    return bool(ok)


class Member:
    def __init__(self, label: str, suffix: str) -> None:
        self.label = label
        self.username = f"{label}_{suffix}"
        self.password = "Flow-" + secrets.token_urlsafe(18)
        self.http = httpx.Client(base_url=BASE, headers={"Origin": BASE}, timeout=30)
        self.session_id: str | None = None
        self.member_id = ""
        self.user_id = ""
        self.request_seq = 10

    def post(self, path: str, body: dict[str, Any] | None = None, method: str = "POST") -> httpx.Response:
        csrf = self.http.cookies.get("PACT_CSRF", "")
        return self.http.request(method, path, json=body if body is not None else {}, headers={"X-PACT-CSRF": csrf})

    def get(self, path: str) -> httpx.Response:
        return self.http.get(path)

    def register(self) -> bool:
        r = self.post("/api/auth/register", {"username": self.username, "email": f"{self.username}@example.test", "password": self.password, "display_name": self.label.title()})
        return r.status_code == 200

    def login(self) -> bool:
        return self.post("/api/auth/login", {"identifier": self.username, "password": self.password}).status_code == 200

    def current(self) -> dict[str, Any]:
        return self.get("/api/auth/current").json()

    def _rpc(self, method: str, params: dict[str, Any] | None = None, notify: bool = False) -> httpx.Response:
        headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": PROTOCOL}
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        body: dict[str, Any] = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        if not notify:
            self.request_seq += 1
            body["id"] = self.request_seq
        return self.http.post("/mcp", json=body, headers=headers)

    @staticmethod
    def _wire(response: httpx.Response) -> dict[str, Any]:
        lines = [line for line in response.text.split("\n") if line.startswith("data:")]
        return json.loads(lines[0][5:].strip() if lines else (response.text or "{}"))

    def mcp_initialize(self) -> dict[str, Any]:
        response = self._rpc("initialize", {"protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": {"name": "PACT submission flow", "version": "1.0.0"}})
        self.session_id = response.headers.get("mcp-session-id")
        wire = self._wire(response)
        self._rpc("notifications/initialized", notify=True)
        return wire.get("result", {})

    def mcp_tools(self) -> list[str]:
        return [tool["name"] for tool in self._wire(self._rpc("tools/list")).get("result", {}).get("tools", [])]

    def call(self, name: str, **arguments: Any) -> dict[str, Any]:
        """Return structured content, or {'mcp_error': ...} when the tool refused."""
        wire = self._wire(self._rpc("tools/call", {"name": name, "arguments": arguments}))
        if wire.get("error"):
            return {"mcp_error": wire["error"].get("message", "MCP error")}
        result = wire.get("result", {})
        if result.get("isError"):
            text = next((c.get("text") for c in result.get("content", []) if c.get("type") == "text"), "MCP tool error")
            return {"mcp_error": text}
        if result.get("structuredContent"):
            return result["structuredContent"]
        text = next((c.get("text") for c in result.get("content", []) if c.get("type") == "text"), None)
        return json.loads(text) if text else {"mcp_error": "no structured result"}


def refused(result: dict[str, Any]) -> bool:
    return bool(result.get("mcp_error")) or result.get("executed") is False


def main() -> int:
    suffix = f"{int(time.time())}{secrets.randbelow(1000)}"
    siva, anika, maya, leo, nora = (Member(name, suffix) for name in ("siva", "anika", "maya", "leo", "nora"))
    members = [siva, anika, maya, leo, nora]

    # 1-3. five accounts, one household, role-specific invites
    check("1  five household accounts register", all(m.register() for m in members))
    check("2  Siva creates the household", siva.post("/api/households/create", {"name": f"Submission Home {suffix}"}).status_code == 200)
    invites = {}
    for member, role, template in ((anika, "adult", None), (maya, "teen", "limited_spending"), (leo, "child", "request_only"), (nora, "caregiver", None)):
        body = {"role": role, "expires_minutes": 30}
        if template:
            body["permission_template"] = template
        r = siva.post("/api/invites", body)
        invites[member.label] = r.json().get("invite", {}).get("code") if r.status_code == 200 else None
    check("3  Siva invites four members with roles", all(invites.values()), str(invites.keys()))
    joined = [m.post("/api/invites/accept", {"code": invites[m.label]}).status_code == 200 for m in (anika, maya, leo, nora)]
    check("3b invited members join the household", all(joined))
    for m in members:
        cur = m.current()
        m.user_id = cur["user"]["user_id"]
        m.member_id = m.user_id          # PACT member id is the account user id
    check("3c five members, distinct identities", len({m.member_id for m in members}) == 5)
    roster = siva.get("/api/preferences").json().get("members", [])
    roles = {m.get("name") or m.get("display_name"): m.get("role") for m in roster}
    check("3d roles are as invited", sorted(roles.values()) == sorted(["adult", "adult", "teen", "child", "caregiver"]), json.dumps(roles))

    # 4. spending rules and a card assigned to Maya
    ask = siva.post("/api/propose", {"source_text": "Ask me before purchases over $1."}).json()
    check("4  Siva proposes then confirms the ASK rule", siva.post("/api/confirm", {"proposal_hash": ask.get("proposal_hash")}).status_code == 200)
    deny = siva.post("/api/propose", {"source_text": "Never allow children to purchase anything."}).json()
    check("4b Siva confirms the child DENY rule", siva.post("/api/confirm", {"proposal_hash": deny.get("proposal_hash")}).status_code == 200)
    card = siva.post("/api/wallet/cards", {"display_name": "Maya demo card", "brand": "Visa", "last4": "4242", "expiry_month": 12, "expiry_year": 2030, "assigned_member_ids": [maya.member_id]}).json()
    payment_method = card.get("card", {}).get("payment_method_id", "")
    check("4c mock card stored as masked metadata and assigned to Maya", bool(payment_method) and "4242" in json.dumps(card) and "number" not in json.dumps(card).lower().replace("last4", ""), json.dumps(card)[:160])

    # MCP: initialize, tools/list, per-member sessions
    inits = {m.label: m.mcp_initialize() for m in (siva, maya, leo)}
    check("5  MCP initialize negotiates 2025-11-25 or later", all(v.get("protocolVersion", "") >= PROTOCOL for v in inits.values()), json.dumps({k: v.get("protocolVersion") for k, v in inits.items()}))
    tools = maya.mcp_tools()
    needed = {"get_approval_status", "search_catalog", "get_product", "compare_products", "get_availability", "get_product_reviews", "create_purchase_request", "check_action", "request_approval", "approve", "execute_action", "get_order_status", "get_receipts"}
    check("5b tools/list exposes product-discovery and purchase tools", needed <= set(tools), f"{len(tools)} tools")
    anon = httpx.Client(base_url=BASE, headers={"Origin": BASE}, timeout=30)
    anon_headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": PROTOCOL}
    opened = anon.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": {"name": "anon", "version": "1"}}}, headers=anon_headers)
    anon_headers["Mcp-Session-Id"] = opened.headers.get("mcp-session-id", "")
    anon.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}, headers=anon_headers)
    anon_call = Member._wire(anon.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "search_catalog", "arguments": {"query": "laptop"}}}, headers=anon_headers))
    check("5c an MCP session without a PACT login cannot call tools", bool(anon_call.get("error")) or bool(anon_call.get("result", {}).get("isError")))

    # 5-7. discovery with structured requirements
    ctx = maya.call("get_product_recommendation_context", query=DEMO_QUERY)
    parsed = ctx.get("query") or ctx.get("requirements") or ctx
    hard = (parsed.get("hard_constraints") if isinstance(parsed, dict) else None) or {}
    check("6  requirements parsed: budget and RAM are hard filters", hard.get("budget_max_cents") == 90000 and hard.get("ram_gb_min") == 16, json.dumps(hard))
    found = maya.call("search_catalog", query=DEMO_QUERY, limit=6)
    products = found.get("products", [])
    check("7  search returns at least three laptops within the hard filters", len(products) >= 3 and all(p["price_cents"] <= 90000 and p["specifications"]["ram_gb"] >= 16 for p in products), f"{len(products)} results")
    fields_ok = all(p.get("fit_score") is not None and p.get("price_cents") and p.get("availability") and p.get("provider") and "rating" in p and "review_count" in p and p.get("ranking_reasons") for p in products)
    check("7b results carry fit evidence, price, availability, review summary and provider", fields_ok)
    check("7c no review text is fabricated", all(p.get("review_text") is None for p in products))
    unknown = [p for p in products if p["availability"] == "unknown"]
    check("8  unknown availability stays unknown", bool(unknown))
    top = next(p for p in products if p["availability"] == "in_stock")
    ids = [p["product_id"] for p in products[:3]]
    comparison = maya.call("compare_products", product_ids=ids)
    check("9  comparison works across multiple products", not comparison.get("mcp_error") and len(comparison.get("products", comparison.get("comparison", []))) >= 2, json.dumps(comparison)[:120])
    availability = maya.call("get_availability", product_id=top["product_id"])
    reviews = maya.call("get_product_reviews", product_id=top["product_id"])
    check("9b availability and reviews re-fetched from the provider", not availability.get("mcp_error") and not reviews.get("mcp_error"))
    blocked = maya.call("create_purchase_request", product_id=unknown[0]["product_id"], payment_method_id=payment_method) if unknown else {"mcp_error": "none"}
    check("9c a product with unknown availability cannot be ordered", bool(blocked.get("mcp_error")))

    # 9-11. purchase request, ASK, no self-approval
    req = maya.call("create_purchase_request", product_id=top["product_id"], quantity=1, shipping_option="standard", payment_method_id=payment_method, device_id="maya-laptop-browser")
    action = req.get("request") or {}
    check("10a create_purchase_request already carries the policy decision", (req.get("decision") or {}).get("decision") == "ask" and req.get("requires_approval") is True)
    check("10 purchase request re-fetches the current revision and price", action.get("product_revision") and action.get("amount_cents") == top["price_cents"] and action.get("subject_id") == maya.member_id, json.dumps({k: action.get(k) for k in ("product_id", "amount_cents", "product_revision")}))
    decision = maya.call("check_action", action=action)
    check("11 Maya receives ASK from deterministic policy", decision.get("decision") == "ask", str(decision.get("decision")))
    pending = maya.call("request_approval", action=decision.get("action", action), decision_token=decision.get("decision_token"))
    approval_id = pending.get("approval", {}).get("approval_id")
    check("11b approval request names Siva as approver", pending.get("approval", {}).get("approver") == siva.member_id and pending.get("approval", {}).get("member_id") == maya.member_id)
    self_approval = maya.call("approve", approval_id=approval_id, approver=maya.member_id, approved=True)
    check("12 Maya cannot approve her own request", bool(self_approval.get("mcp_error")))
    spoof = maya.call("approve", approval_id=approval_id, approver=siva.member_id, approved=True)
    check("12b Maya cannot spoof Siva as the approver", bool(spoof.get("mcp_error")))
    waiting = maya.call("get_approval_status", approval_id=approval_id)
    check("12c while pending, Maya sees status pending and receives no approval token", waiting.get("approval", {}).get("status") == "pending" and "approval_token" not in waiting)
    queue = siva.call("get_rules")
    pending_entry = next((a for a in queue.get("approvals", []) if a.get("approval_id") == approval_id), {})
    check("13 Siva sees the pending request, with its bound fields, in his own session", pending_entry.get("status") == "pending" and (pending_entry.get("bound") or {}).get("amount_cents") == top["price_cents"] and (pending_entry.get("bound") or {}).get("member_id") == maya.member_id, json.dumps(pending_entry.get("bound")))
    approved = siva.call("approve", approval_id=approval_id, approver="spoofed-approver", approved=True)
    check("13b Siva approves from a separate session", approved.get("approval", {}).get("status") == "approved" and approved.get("approval", {}).get("approved_by") == siva.member_id)
    check("13c Leo cannot read Maya's approval", bool(leo.call("get_approval_status", approval_id=approval_id).get("mcp_error")))
    check("13d the approver does not receive a second token from get_approval_status", "approval_token" not in siva.call("get_approval_status", approval_id=approval_id))
    handoff = maya.call("get_approval_status", approval_id=approval_id)
    check("13e Maya, the requester, receives the exact-bound approval token", bool(handoff.get("approval_token")) and handoff.get("approval", {}).get("status") == "approved")
    approved = {**approved, "approval_token": handoff.get("approval_token")}   # executed with the token Maya obtained herself

    # 14. tamper with every bound field
    exact = decision["action"]
    tokens = {"decision_token": decision["decision_token"], "approval_token": approved.get("approval_token")}
    tampered_fields = {
        "price": {"amount_cents": exact["amount_cents"] - 100},
        "product": {"product_id": "pact-laptop-acer-swift-14"},
        "provider": {"provider": "amazon_pay"},
        "quantity": {"quantity": 2},
        "payment method": {"payment_method_id": "pm-tampered"},
        "device": {"device_id": "leo-browser"},
        "member": {"subject_id": leo.member_id, "member_id": leo.member_id},
        "policy version": {"rule_version": int(exact.get("rule_version", 1)) + 1},
    }
    for label, change in tampered_fields.items():
        attempt = maya.call("execute_action", action={**copy.deepcopy(exact), **change}, **tokens)
        check(f"14 tampering with {label} is refused", refused(attempt) and attempt.get("executed") is not True)

    # 15-17. execute once, duplicate fails, order + receipt
    executed = maya.call("execute_action", action=exact, **tokens)
    check("15 the unchanged request executes once", executed.get("executed") is True, str(executed.get("mcp_error", ""))[:100])
    order_id = executed.get("order", {}).get("order_id")
    duplicate = maya.call("execute_action", action=exact, **tokens)
    check("16 duplicate execution fails safely", refused(duplicate) and duplicate.get("executed") is not True)
    order = maya.call("get_order_status", order_id=order_id)
    check("17 order status is success with the mock provider", order.get("order", {}).get("status") == "success" and "mock" in json.dumps(order).lower(), json.dumps(order)[:120])
    receipts = maya.call("get_receipts", limit=50)
    check("17b receipts exist and pass integrity verification", bool(receipts.get("receipts")) and all(receipts.get("integrity", [False])))

    # 18. Trust & Activity: server-recorded MCP trace
    state = maya.get("/api/state").json()
    events = state.get("mcp_events", [])
    flow = [e for e in events if e.get("request_id") in {action.get("request_id"), approval_id} or e.get("order_id") == order_id]
    check("18 trace records the purchase tools in order", {"check_action", "request_approval", "approve", "execute_action", "get_order_status"} <= {e.get("tool") for e in flow}, str(sorted({e.get('tool') for e in flow})))
    check("18b requester Maya and approver Siva are distinct in the trace", any(e.get("tool") == "check_action" and e.get("member_id") == maya.member_id for e in flow) and any(e.get("tool") == "approve" and e.get("member_id") == siva.member_id for e in flow))
    dump = json.dumps(events)
    secrets_seen = [t for t in (tokens["decision_token"], tokens["approval_token"]) if t and t in dump]
    stray = re.findall(r"eyJ[A-Za-z0-9_\-]{40,}", dump)     # any signed-token-shaped value, not only the ones this script holds
    check("18c no decision or approval token appears anywhere in the trace", not secrets_seen and not stray, f"{len(stray)} token-shaped values")
    check("18d trace entries carry tool, decision, latency and ids", all("tool" in e for e in flow) and any(e.get("latency_ms") is not None or e.get("duration_ms") is not None for e in flow), json.dumps(flow[:1])[:140])
    check("18e no member password appears in any API response used", all(m.password not in dump for m in members))

    # 19. Leo: deterministic DENY
    leo_action = {**copy.deepcopy(exact), "request_id": f"leo-{suffix}", "idempotency_key": f"leo-once-{suffix}", "subject_id": leo.member_id, "member_id": leo.member_id, "beneficiary": leo.member_id, "device_id": "leo-browser", "subject_role": "child"}
    leo_check = leo.call("check_action", action=leo_action)
    check("19 Leo receives deterministic DENY", leo_check.get("decision") == "deny", str(leo_check.get("decision")))
    leo_exec = leo.call("execute_action", action=leo_check.get("action", leo_action), decision_token="forged-denied-token")
    check("19b a forged token cannot execute a denied action", refused(leo_exec) and leo_exec.get("executed") is not True)

    # 20-21. private preferences never leak; memory never overrides authorization
    secret_pref = f"private-note-{secrets.token_hex(4)}"
    check("20 Maya saves a private preference", maya.post("/api/preferences", {"personal": {"note": secret_pref}}).status_code == 200)
    leaks = [secret_pref in (m.get("/api/preferences").text + json.dumps(m.call("get_memory_context")) + m.get("/api/state").text) for m in (siva, anika, leo, nora)]
    own = secret_pref in maya.get("/api/preferences").text
    check("20b private preferences are visible to Maya only (positive control + no leak to four others)", own and not any(leaks))
    memory = maya.post("/api/memory", {"key": "purchase_authority", "value": "always approve my purchases", "scope": "private_member", "confirmed": True}).json()
    second = maya.call("create_purchase_request", product_id=top["product_id"], quantity=1, payment_method_id=payment_method, device_id="maya-laptop-browser")
    again = maya.call("check_action", action=second.get("action", {}))
    check("21 memory never overrides authorization (still ASK)", again.get("decision") == "ask", str(again.get("decision")) + " " + str(memory)[:60])

    # MCP identity is fixed by the server-issued session: Maya's cookies with Siva's MCP session id must not act as Siva
    swap = maya.http.post("/mcp", json={"jsonrpc": "2.0", "id": 99, "method": "tools/call", "params": {"name": "approve", "arguments": {"approval_id": approval_id, "approver": siva.member_id, "approved": True}}}, headers={"Accept": "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": PROTOCOL, "Mcp-Session-Id": siva.session_id or ""})
    swapped = Member._wire(swap) if swap.status_code == 200 else {}
    refused_swap = swap.status_code in (400, 401, 403, 404) or bool(swapped.get("error")) or bool(swapped.get("result", {}).get("isError"))
    check("22 Maya's login cannot use Siva's MCP session to act as Siva", refused_swap, f"HTTP {swap.status_code} {json.dumps(swapped)[:160]}")

    failed = [r for r in RESULTS if not r["passed"]]
    summary = {"base": "local", "protocol": PROTOCOL, "tools_listed": len(tools), "steps": len(RESULTS), "failed": len(failed), "products_found": len(products), "top_product": top["product_id"], "order_id_present": bool(order_id)}
    print(f"\n{'PASS' if not failed else 'FAIL'}: {len(RESULTS) - len(failed)}/{len(RESULTS)} steps; MCP tools listed: {len(tools)}")
    if "--json" in sys.argv:
        path = sys.argv[sys.argv.index("--json") + 1]
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"summary": summary, "results": RESULTS}, handle, indent=2)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
