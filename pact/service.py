"""Application service shared by MCP tools, the demo API, and tests.

The service is the trust boundary: Bedrock may propose text, but this module
owns confirmation, deterministic policy, plan budgets, signed tokens,
approvals, mock execution, and receipts.
"""

from __future__ import annotations

import copy
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from .canonical import action_hash
from .compiler import BedrockCompiler, deterministic_compile
from .policy import evaluate
from .permissions import check_execution, require
from .receipts import create_receipt
from .schemas import HIGH_RISK_ACTIONS, ValidationError, validate_action, validate_rule
from .state import StateStore, now_iso
from .tokens import TokenError, TokenManager
from .wallet import WalletService
from .marketplace import get_product as catalog_product, product_matches_action, search_catalog
from .payment_providers import PaymentProviderError, PaymentResult, configured_provider, provider_status
from .memory import MemoryService
from .product_discovery import (
    ProductQueryError,
    availability as product_availability,
    compare_products as compare_catalog_products,
    get_product as discovery_product,
    parse_product_query,
    recommendation_context,
    reviews as product_reviews,
    search_products,
    provider_status as catalog_provider_status,
)


class PactService:
    def __init__(
        self,
        store: StateStore | None = None,
        compiler: BedrockCompiler | None = None,
        token_manager: TokenManager | None = None,
        bedrock_gate: Callable[[], bool] | None = None,
    ) -> None:
        self.store = store or StateStore()
        self.compiler = compiler or BedrockCompiler()
        self.tokens = token_manager or TokenManager()
        self.bedrock_gate = bedrock_gate
        self.wallet = WalletService(self.store)
        self.memory = MemoryService(self.store)

    def _record(self, action: dict[str, Any], decision: str, result: str, rule_id: str | None, approval_id: str | None, token_id: str | None, reason: str) -> dict[str, Any]:
        previous = self.store.receipts[-1].get("receipt_hash") if self.store.receipts else None
        receipt = create_receipt(action, decision, result, rule_id, approval_id, token_id, self.store.policy_version, reason, previous)
        self.store.add_receipt(receipt)
        return receipt

    def get_rules(self, caller: dict[str, Any] | None = None) -> dict[str, Any]:
        snapshot = self.store.snapshot()
        household = copy.deepcopy(snapshot["household"])
        safe_members = []
        for member in household.get("members", []):
            safe = {key: copy.deepcopy(value) for key, value in member.items() if key not in {"preferences", "personal_preferences"}}
            safe.setdefault("preferences_shared", bool(safe.get("shared_preferences")))
            safe_members.append(safe)
        household["members"] = safe_members
        return {
            "household": household,
            "rules": snapshot["rules"],
            "proposals": snapshot["proposals"],
            "approvals": snapshot["approvals"],
            "plans": snapshot["plans"],
            "plan_actions": snapshot["plan_actions"],
            "trust_events": snapshot["trust_events"],
            "mcp_events": snapshot["mcp_events"],
            "payment_orders": snapshot["payment_orders"],
            "policy_version": snapshot["policy_version"],
            "compiler_status": copy.deepcopy(self.compiler.status),
            "usage": copy.deepcopy(snapshot["usage"]),
            "caller": {"member_id": caller.get("member_id"), "role": caller.get("role"), "session_bound": bool(caller.get("session_id")), "household_bound": bool(caller.get("household_id"))} if caller else None,
            "memory": self.memory.context(caller) if caller else {"private": [], "shared": [], "scope": "none"},
        }

    def get_memory_context(self, caller: dict[str, Any]) -> dict[str, Any]:
        return self.memory.context(caller)

    def remember_preference(self, caller: dict[str, Any], key: Any, value: Any, **kwargs: Any) -> dict[str, Any]:
        return self.memory.remember(caller, key, value, **kwargs)

    def forget_preference(self, caller: dict[str, Any], memory_id: str) -> dict[str, Any]:
        return self.memory.forget(caller, memory_id)

    def _compile_with_budget(self, source_text: str, created_by: str) -> dict[str, Any]:
        if self.bedrock_gate is not None and not self.bedrock_gate():
            compiled = deterministic_compile(source_text, created_by)
            compiled["compiler"] = "deterministic-cap-fallback"
            compiled["fallback_reason"] = "Bedrock daily call or token cap reached"
            self.compiler.status["fallback_reason"] = compiled["fallback_reason"]
            return compiled
        return self.compiler.compile(source_text, created_by)

    def propose_rule(self, source_text: str, created_by: str = "siva") -> dict[str, Any]:
        compiled = self._compile_with_budget(source_text, created_by)
        if compiled.get("status") == "candidate":
            validate_rule(compiled["rule"])
            self.store.save_proposal(compiled)
        return compiled

    def policy_preview(self, proposal_hash: str) -> dict[str, Any]:
        proposal = self.store.get_proposal(proposal_hash)
        if not proposal or proposal.get("status") != "candidate":
            raise ValidationError("proposal not found or not previewable")
        rule = copy.deepcopy(proposal["rule"])
        rule["confirmed"] = True
        conditions = rule.get("conditions", {})
        threshold = int(conditions.get("amount_gt_cents", conditions.get("amount_lte_cents", conditions.get("cumulative_limit_cents", 5000))))
        subject_role = rule.get("subject", {}).get("value", "any")
        role = subject_role if subject_role != "any" else "teen"
        subject_id = {"adult": "siva", "teen": "maya", "child": "leo", "caregiver": "nora"}.get(role, "maya")
        base = {
            "household_id": self.store.household_id,
            "subject_id": subject_id,
            "subject_role": role,
            "action": rule["action"],
            "resource": rule.get("resource", "*"),
            "merchant": "Synthetic Replay Store",
            "device": conditions.get("device"),
            "audience": conditions.get("audience", "household"),
            "surface": conditions.get("surface", "shared_web_demo"),
            "timestamp": now_iso(),
        }
        if rule["action"] in {"purchase", "booking"}:
            base.update({"currency": conditions.get("currency", "USD"), "amount_cents": max(1, threshold - 1)})
        else:
            base.update({"currency": "", "amount_cents": None})
        scenarios = [
            ("within example", dict(base, request_id="synthetic-within", idempotency_key="synthetic-within")),
            ("boundary or over example", dict(base, request_id="synthetic-over", idempotency_key="synthetic-over", amount_cents=threshold + 1) if rule["action"] in {"purchase", "booking"} else dict(base, request_id="synthetic-high-risk", idempotency_key="synthetic-high-risk")),
        ]
        if rule["action"] in {"purchase", "booking"}:
            scenarios.append(("split purchase attack", dict(base, request_id="synthetic-split", idempotency_key="synthetic-split", amount_cents=max(1, threshold // 2))))
        evaluated = []
        for label, candidate in scenarios:
            validate_action(candidate)
            result = evaluate(candidate, [rule], 0)
            evaluated.append({"label": label, "synthetic_replay": True, "amount_cents": candidate.get("amount_cents"), "decision": result["decision"], "reason": result["reason"]})
        loopholes = [
            "Synthetic replay only: repeated requests must be checked against the cumulative plan budget.",
            "Synthetic split-purchase attempt is included; no real household history is used.",
        ]
        return {
            "proposal_hash": proposal_hash,
            "synthetic_replay": True,
            "actions": evaluated,
            "allowed": [x for x in evaluated if x["decision"] == "allow"],
            "approval_required": [x for x in evaluated if x["decision"] == "ask"],
            "denied": [x for x in evaluated if x["decision"] == "deny"],
            "committed_spending_cents": 0,
            "detected_loopholes": loopholes,
        }

    def confirm_rule(self, proposal_hash: str, confirmer: str = "siva", caller: dict[str, Any] | None = None) -> dict[str, Any]:
        require(caller, "manage_rules")
        if caller is not None:
            confirmer = str(caller["member_id"])
        proposal = self.store.get_proposal(proposal_hash)
        if not proposal or proposal.get("status") != "candidate":
            raise ValidationError("proposal not found or not confirmable")
        rule = copy.deepcopy(proposal["rule"])
        if rule.get("proposal_hash") != proposal_hash or rule.get("confirmed") is not False:
            raise ValidationError("stale or already confirmed proposal")
        if confirmer != rule.get("created_by") and confirmer != "siva":
            raise ValidationError("only the simulated household owner can confirm")
        rule["confirmed"] = True
        rule["confirmed_by"] = confirmer
        rule["confirmed_at"] = now_iso()
        validate_rule(rule)
        self.store.add_rule(rule)
        return {"status": "confirmed", "rule": rule, "policy_version": self.store.policy_version}

    def create_plan(self, title: str = "Maya's birthday", budget_cents: int = 15000, beneficiary: str = "maya", conversation_id: str | None = None) -> dict[str, Any]:
        if budget_cents <= 0:
            raise ValidationError("plan budget must be positive")
        plan = {
            "plan_id": "plan-" + uuid.uuid4().hex[:10],
            "title": title,
            "budget_cents": budget_cents,
            "beneficiary": beneficiary,
            "household_id": self.store.household_id,
            "status": "active",
            "conversation_id": conversation_id,
            "created_at": now_iso(),
        }
        self.store.save_plan(plan)
        return plan

    def get_plan(self, plan_id: str) -> dict[str, Any]:
        plan = self.store.get_plan(plan_id)
        if not plan:
            raise ValidationError("plan not found")
        exposure = self.plan_exposure(plan_id)
        return {**plan, "exposure_cents": exposure, "remaining_cents": max(0, int(plan["budget_cents"]) - exposure), "actions": self.store.plan_actions_for(plan_id)}

    def plan_exposure(self, plan_id: str, exclude_hash: str | None = None) -> int:
        total = 0
        seen: set[str] = set()
        for item in self.store.plan_actions_for(plan_id):
            digest = item.get("action_hash")
            if digest in seen or digest == exclude_hash:
                continue
            if item.get("status") in {"pending", "approved", "executed"}:
                seen.add(digest)
                total += int(item.get("amount_cents") or 0)
        return total

    def _track_plan_action(self, action: dict[str, Any], status: str, decision: str | None = None) -> None:
        plan_id = action.get("plan_id")
        if not plan_id or not self.store.get_plan(plan_id):
            return
        digest = action_hash(action)
        existing = self.store.get_plan_action(digest) or {
            "action_hash": digest,
            "plan_id": plan_id,
            "addon": action.get("addon", ""),
            "beneficiary": action.get("beneficiary") or action.get("subject_id"),
            "action": action.get("action"),
            "amount_cents": action.get("amount_cents") or 0,
            "merchant": action.get("merchant"),
            "request_id": action.get("request_id"),
            "created_at": now_iso(),
        }
        existing.update({"status": status, "decision": decision or existing.get("decision")})
        self.store.save_plan_action(existing)

    def _plan_budget_result(self, action: dict[str, Any]) -> dict[str, Any] | None:
        plan_id = action.get("plan_id")
        if not plan_id:
            return None
        plan = self.store.get_plan(plan_id)
        if not plan:
            return {"decision": "deny", "rule_id": None, "reason": "Plan is missing or no longer active.", "approver": "siva", "conflict": False}
        if plan.get("status") != "active":
            return {"decision": "deny", "rule_id": None, "reason": "Plan is not active.", "approver": "siva", "conflict": False}
        current = self.plan_exposure(plan_id, action_hash(action))
        amount = int(action.get("amount_cents") or 0)
        if current + amount > int(plan["budget_cents"]):
            return {"decision": "deny", "rule_id": None, "reason": f"Plan budget would be exceeded: ${current / 100:.2f} committed plus ${amount / 100:.2f} requested over ${int(plan['budget_cents']) / 100:.2f}.", "approver": "siva", "conflict": False}
        return None

    def _action_for(self, payload: dict[str, Any]) -> dict[str, Any]:
        action = dict(payload)
        action.setdefault("request_id", "req-" + uuid.uuid4().hex[:8])
        action.setdefault("household_id", self.store.household_id)
        action.setdefault("member_id", "")
        action.setdefault("session_id", "")
        action.setdefault("actor_role", "")
        action.setdefault("timestamp", now_iso())
        action.setdefault("idempotency_key", action["request_id"])
        action.setdefault("resource", "*")
        action.setdefault("merchant", "")
        action.setdefault("merchant_type", "")
        action.setdefault("payment_method_id", "")
        action.setdefault("category", action.get("resource", ""))
        action.setdefault("spending_period", "")
        action.setdefault("device", None)
        action.setdefault("amount_cents", None)
        action.setdefault("currency", "")
        action.setdefault("audience", "household")
        action.setdefault("surface", "shared_web_demo")
        action.setdefault("plan_id", "")
        action.setdefault("addon", "")
        action.setdefault("beneficiary", action.get("subject_id", ""))
        action.setdefault("conversation_id", "")
        action.setdefault("device_id", "")
        action.setdefault("provider", "")
        action.setdefault("product_id", "")
        action.setdefault("product_revision", "")
        action.setdefault("quantity", 1)
        action.setdefault("shipping_option", "standard")
        action.setdefault("payment_provider", "mock")
        action.setdefault("catalog_provider", "")
        action.setdefault("rule_version", self.store.policy_version)
        validate_action(action)
        return action

    def search_catalog(self, query: str = "", category: str = "", limit: int = 6, filters: dict[str, Any] | None = None, caller: dict[str, Any] | None = None) -> dict[str, Any]:
        if filters and isinstance(filters.get("compare_product_ids"), list):
            comparison = self.compare_products([str(item) for item in filters["compare_product_ids"]])
            return {"catalog": "PACT Sandbox Catalog", "provider": catalog_provider_status(), "simulated": True, "retrieved_at": now_iso(), "comparison": comparison, "products": comparison.get("products", []), "spoken_summary": "I compared the selected simulated products.", "visual_summary": {"comparison": True}, "next_step": "create_purchase_request"}
        query_text = query or category or ""
        parsed = parse_product_query(query_text, filters)
        if category and category.lower() not in {"laptop", "electronics"}:
            parsed = parse_product_query(query_text, {**(filters or {}), "category": category})
        products = search_products(parsed, limit)
        # Preserve the original seeded marketplace search for existing add-on
        # demos; laptop discovery is deterministic and evidence-rich.
        if not products and not parsed.contradictions and not filters and not query_text:
            products = search_catalog(query, category, limit)
        return {
            "catalog": "PACT Sandbox Catalog",
            "provider": catalog_provider_status(),
            "simulated": True,
            "retrieved_at": now_iso(),
            "query": parsed.as_dict(),
            "products": products,
            "spoken_summary": f"I found {len(products)} simulated products.",
            "visual_summary": {"count": len(products), "category": parsed.category, "provider": "PACT Sandbox Catalog"},
            "next_step": "compare_products or get_product" if products else "clarify_requirements",
            "clarification": "Please resolve the contradictory requirements before I search." if parsed.contradictions else None,
        }

    def get_product(self, product_id: str) -> dict[str, Any]:
        product = catalog_product(product_id)
        if product is None:
            raise ValidationError("product not found in the local PACT Marketplace catalog")
        return {"catalog": "PACT Sandbox Catalog", "provider": catalog_provider_status(), "simulated": True, "retrieved_at": now_iso(), "product": product, "spoken_summary": f"{product['title']} is available for review; I have not ordered it.", "visual_summary": {"product_id": product["product_id"], "price_cents": product.get("price_cents", product.get("amount_cents")), "availability": product.get("availability")}, "next_step": "create_purchase_request"}

    def compare_products(self, product_ids: list[str]) -> dict[str, Any]:
        value = compare_catalog_products(product_ids)
        value.update({"provider": catalog_provider_status(), "retrieved_at": now_iso(), "spoken_summary": f"I compared {len(product_ids)} simulated products.", "visual_summary": {"product_ids": product_ids}, "next_step": "create_purchase_request"})
        return value

    def get_availability(self, product_id: str) -> dict[str, Any]:
        value = product_availability(product_id)
        value.update({"spoken_summary": f"Availability is {value['availability']}.", "visual_summary": {"product_id": product_id, "availability": value["availability"]}, "next_step": "revalidate_before_order"})
        return value

    def get_product_reviews(self, product_id: str) -> dict[str, Any]:
        value = product_reviews(product_id)
        value.update({"spoken_summary": "Review text is unavailable from this provider." if not value["review_text_available"] else "The provider supplied review evidence.", "visual_summary": {"rating": value.get("rating"), "review_count": value.get("review_count"), "review_text_available": value["review_text_available"]}, "next_step": "compare_products"})
        return value

    def get_product_recommendation_context(self, query: str, caller: dict[str, Any] | None = None, filters: dict[str, Any] | None = None) -> dict[str, Any]:
        return recommendation_context(query, self.get_memory_context(caller) if caller else None, filters)

    def create_purchase_request(self, product_id: str, quantity: int = 1, shipping_option: str = "standard", payment_method_id: str = "", device_id: str = "", caller: dict[str, Any] | None = None, filters: dict[str, Any] | None = None) -> dict[str, Any]:
        if caller is None:
            raise ValidationError("authenticated member required")
        product = catalog_product(product_id) or discovery_product(product_id)
        if not product:
            raise ValidationError("product not found in the configured catalog")
        if product.get("availability") != "in_stock":
            raise ValidationError("product availability is not verified in stock; no order request was created")
        if int(quantity) < 1:
            raise ValidationError("quantity must be positive")
        if shipping_option not in set(product.get("shipping_options", ["standard"])):
            raise ValidationError("shipping option is not supplied by the provider")
        if not payment_method_id:
            cards = self.wallet.dashboard(caller).get("cards", [])
            payment_method_id = str(cards[0].get("payment_method_id")) if cards else ""
        amount_cents = int(product.get("price_cents", product.get("amount_cents", 0))) * int(quantity)
        action = {
            "request_id": "purchase-" + uuid.uuid4().hex[:10],
            "household_id": caller["household_id"],
            "member_id": caller["member_id"],
            "session_id": caller["session_id"],
            "actor_role": caller["role"],
            "subject_id": caller["member_id"],
            "subject_role": caller["role"],
            "action": "purchase",
            "resource": "laptop" if product.get("category") == "laptop" else product.get("category", "product"),
            "merchant": product.get("merchant", "PACT Sandbox Catalog"),
            "merchant_type": product.get("merchant_type", "catalog"),
            "category": product.get("category", "product"),
            "amount_cents": amount_cents,
            "currency": product.get("currency", "USD"),
            "surface": "shared_web_demo",
            "payment_method_id": payment_method_id,
            "payment_provider": "mock",
            "provider": "mock",
            "catalog_provider": product.get("provider", "pact_sandbox"),
            "product_id": product["product_id"],
            "product_revision": product.get("product_revision", ""),
            "quantity": int(quantity),
            "shipping_option": shipping_option,
            "device_id": device_id or f"browser-{caller['member_id']}",
            "idempotency_key": "purchase-once-" + uuid.uuid4().hex[:10],
            "rule_version": self.store.policy_version,
            "timestamp": now_iso(),
            "audience": "household",
            "beneficiary": caller["member_id"],
        }
        checked = self.check_action(action, caller=caller)
        return {"request": action, "product": product, "decision": checked, "evidence": product.get("evidence"), "spoken_summary": "The product is selected. PACT is checking household rules before any order.", "visual_summary": {"product_id": product["product_id"], "amount_cents": amount_cents, "revision": product.get("product_revision")}, "next_step": "request_approval" if checked["decision"] == "ask" else "execute_action" if checked["decision"] == "allow" else "none"}

    def payment_provider_status(self) -> dict[str, Any]:
        return provider_status()

    def prepare_checkout(self, payload: dict[str, Any], decision_token: str, approval_token: str | None = None, caller: dict[str, Any] | None = None) -> dict[str, Any]:
        """Prepare a provider checkout without claiming that payment succeeded."""
        action = self._action_for(self._bind_caller(payload.get("action", payload), caller))
        product = catalog_product(str(action.get("product_id", "")))
        if product is None or not product_matches_action(product, action):
            raise ValidationError("checkout action does not exactly match a local catalog product")
        with self.store.lock:
            decision = self.tokens.verify_decision(decision_token, action, self.store.current_ruleset_hash(), self.store.policy_version)
            if decision.get("decision") == "deny":
                raise PaymentProviderError("denied actions cannot start checkout")
            if decision.get("decision") == "ask":
                if not approval_token:
                    raise PaymentProviderError("approval token required before checkout")
                approval = self.store.get_approval(self.tokens._unpack(approval_token).get("approval_id"))
                self.tokens.verify_approval(approval_token, action, self.store.policy_version, approval)
            provider = configured_provider()
            if provider.name == "mock":
                result = PaymentResult("pending", provider.name, "mock-checkout-" + uuid.uuid4().hex[:12], "Mock checkout is ready for the final execute_action step.")
            else:
                return_url = str(payload.get("return_url", ""))
                creator = getattr(provider, "create_checkout_session", None)
                if creator is None:
                    raise PaymentProviderError("selected provider cannot prepare checkout")
                result = creator(action, product, return_url)
            order_id = "order-" + uuid.uuid4().hex[:12]
            order = {"order_id": order_id, "household_id": action["household_id"], "member_id": action["member_id"], "product_id": product["product_id"], "product_revision": product.get("product_revision", ""), "quantity": action.get("quantity", 1), "shipping_option": action.get("shipping_option", "standard"), "amount_cents": action["amount_cents"], "currency": product["currency"], "provider": result.provider, "provider_reference": result.provider_reference, "status": result.status, "message": result.message, "checkout_url": result.checkout_url, "action_hash": action_hash(action), "created_at": now_iso(), "updated_at": now_iso()}
            self.store.payment_orders[order_id] = order
            self.store._persist()
            return {"order": copy.deepcopy(order), "provider": self.payment_provider_status()}

    def get_order_status(self, order_id: str, caller: dict[str, Any] | None = None) -> dict[str, Any]:
        order = self.store.payment_orders.get(str(order_id))
        if not order or (caller and order.get("household_id") != caller.get("household_id")):
            raise ValidationError("order not found")
        return {"order": copy.deepcopy(order), "provider": self.payment_provider_status()}

    def _bind_caller(self, payload: dict[str, Any], caller: dict[str, Any] | None) -> dict[str, Any]:
        if caller is None:
            return dict(payload)
        action = dict(payload)
        # Identity is always taken from the resolved server context, never from
        # caller-controlled action fields or MCP arguments.
        action.update({
            "household_id": caller["household_id"],
            "member_id": caller["member_id"],
            "session_id": caller["session_id"],
            "actor_role": caller["role"],
        })
        return action

    def check_action(self, payload: dict[str, Any], caller: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = self._bind_caller(payload, caller)
        try:
            action = self._action_for(payload)
        except Exception as exc:
            action = dict(payload)
            action.setdefault("household_id", self.store.household_id)
            action.setdefault("action", payload.get("action", "unknown"))
            result = {"decision": "deny" if action.get("action") in HIGH_RISK_ACTIONS else "ask", "rule_id": None, "reason": f"invalid action: {exc}", "approver": "siva", "conflict": False}
            return {**result, "action": action, "decision_token": None, "expires_at": ""}
        wallet_rules, wallet_error = self.wallet.policy_context(action)
        budget_result = self._plan_budget_result(action)
        if wallet_error:
            result = {"decision": "deny", "rule_id": None, "reason": wallet_error, "approver": "siva", "conflict": False}
        elif budget_result:
            result = budget_result
        else:
            cumulative = self._cumulative_spending(action)
            result = evaluate(action, self.store.rules + wallet_rules, cumulative)
        token = None if result["decision"] == "deny" else self.tokens.issue_decision(action, self.store.current_ruleset_hash(), self.store.policy_version, result["decision"], result.get("approver"))
        self._track_plan_action(action, "pending" if result["decision"] == "ask" else "allowed" if result["decision"] == "allow" else "denied", result["decision"])
        payload = {**result, "action": action, "decision_token": token, "expires_at": self._token_expiry(token) if token else "", "caller": {"member_id": caller.get("member_id"), "role": caller.get("role"), "session_id": caller.get("session_id")} if caller else None}
        self._record(action, result["decision"], "pending" if result["decision"] == "ask" else "blocked", result.get("rule_id"), None, self._token_id(token), result["reason"])
        return payload

    def _token_id(self, token: str | None) -> str | None:
        if not token:
            return None
        try:
            return self.tokens._unpack(token).get("token_id")
        except Exception:
            return None

    def _token_expiry(self, token: str | None) -> str:
        if not token:
            return ""
        return str(self.tokens._unpack(token).get("expires_at", ""))

    def request_approval(self, payload: dict[str, Any], decision_token: str, caller: dict[str, Any] | None = None) -> dict[str, Any]:
        action = self._action_for(self._bind_caller(payload, caller))
        decision = self.tokens.verify_decision(decision_token, action, self.store.current_ruleset_hash(), self.store.policy_version)
        if decision.get("decision") != "ask":
            raise TokenError("only ask decisions can request approval")
        approval_id = "approval-" + uuid.uuid4().hex[:8]
        approval = {
            "approval_id": approval_id,
            "request_hash": action_hash(action),
            "request_id": action["request_id"],
            "household_id": action["household_id"],
            "approver": decision.get("approver") or "siva",
            "policy_version": self.store.policy_version,
            "plan_id": action.get("plan_id", ""),
            "addon": action.get("addon", ""),
            "beneficiary": action.get("beneficiary", action.get("subject_id")),
            "action": action.get("action", ""),
            "status": "pending",
            "approval_version": 1,
            "member_id": action.get("member_id", ""),
            "session_id": action.get("session_id", ""),
            "created_at": now_iso(),
        }
        self.store.save_approval(approval)
        self._track_plan_action(action, "pending", "ask")
        return {"approval": approval, "action": action, "decision_token": decision_token}

    def approve(self, approval_id: str, approver: str, approved: bool = True, caller: dict[str, Any] | None = None) -> dict[str, Any]:
        require(caller, "approve")
        if caller is not None:
            approver = str(caller["member_id"])
        with self.store.lock:
            approval = self.store.get_approval(approval_id)
            if not approval:
                raise ValidationError("approval request not found")
            if approver != approval["approver"]:
                raise ValidationError("only the required simulated approver can approve")
            approval["approval_version"] = int(approval.get("approval_version", 1)) + 1
            approval["status"] = "approved" if approved else "rejected"
            approval["approved_by"] = approver
            approval["approved_at"] = now_iso()
            self.store.save_approval(approval)
            for item in self.store.plan_actions_for(approval.get("plan_id", "")):
                if item.get("action_hash") == approval.get("request_hash"):
                    item["status"] = "approved" if approved else "rejected"
                    self.store.save_plan_action(item)
            if approved:
                self.store.add_trust_event({"event": "approval", "approval_id": approval_id, "action_hash": approval["request_hash"], "action": approval.get("action", ""), "beneficiary": approval.get("beneficiary", ""), "approver": approver, "timestamp": now_iso()})
            token = self.tokens.issue_approval(approval) if approved else None
            return {"approval": approval, "approval_token": token}

    def _cumulative_spending(self, action: dict[str, Any]) -> int:
        period = str(action.get("spending_period", "")).lower()
        cutoff = None
        if period in {"day", "week", "month"}:
            cutoff = datetime.now(timezone.utc) - timedelta(days={"day": 1, "week": 7, "month": 30}[period])
        return sum(
            int(receipt.get("redacted_parameters", {}).get("amount_cents") or 0)
            for receipt in self.store.receipts
            if receipt.get("household_id") == action.get("household_id")
            and receipt.get("subject_id") == action.get("subject_id")
            and receipt.get("action") == action.get("action")
            and receipt.get("result") == "executed"
            and (cutoff is None or self._receipt_after(receipt, cutoff))
        )

    @staticmethod
    def _receipt_after(receipt: dict[str, Any], cutoff: datetime) -> bool:
        try:
            return datetime.fromisoformat(str(receipt.get("timestamp", "")).replace("Z", "+00:00")) >= cutoff
        except ValueError:
            return False

    def _current_policy_still_matches(self, action: dict[str, Any], expected_decision: str) -> bool:
        budget = self._plan_budget_result(action)
        wallet_rules, wallet_error = self.wallet.policy_context(action)
        current = {"decision": "deny", "reason": wallet_error} if wallet_error else budget or evaluate(action, self.store.rules + wallet_rules, self._cumulative_spending(action))
        return current.get("decision") == expected_decision

    def execute_action(self, payload: dict[str, Any], decision_token: str, approval_token: str | None = None, caller: dict[str, Any] | None = None) -> dict[str, Any]:
        action = self._bind_caller(payload, caller)
        try:
            action = self._action_for(action)
            # The state lock covers policy recheck, nonce/idempotency claims,
            # plan reservation, and receipt creation as one critical section.
            with self.store.lock:
                decision = self.tokens.verify_decision(decision_token, action, self.store.current_ruleset_hash(), self.store.policy_version)
                check_execution(caller, action, decision["decision"])
                if not self._current_policy_still_matches(action, decision["decision"]):
                    raise TokenError("current policy decision changed")
                approval_id = None
                if decision["decision"] == "ask":
                    if not approval_token:
                        raise TokenError("approval token required")
                    approval = self.store.get_approval(self.tokens._unpack(approval_token).get("approval_id"))
                    approval = self.tokens.verify_approval(approval_token, action, self.store.policy_version, approval)
                    approval_id = approval["approval_id"]
                if not self.store.consume_nonce(decision["nonce"]):
                    raise TokenError("token replay detected")
                if not self.store.claim_idempotency(action["idempotency_key"]):
                    raise TokenError("duplicate execution request")
                payment: dict[str, Any] | None = None
                if action.get("product_id"):
                    product = catalog_product(str(action["product_id"]))
                    if product is None or not product_matches_action(product, action):
                        raise TokenError("payment product no longer matches the exact approved action")
                    try:
                        provider = configured_provider()
                        result_value = provider.checkout(action, product)
                    except PaymentProviderError as exc:
                        raise TokenError(str(exc)) from exc
                    payment = {"status": result_value.status, "provider": result_value.provider, "provider_reference": result_value.provider_reference, "message": result_value.message}
                    if result_value.status != "success":
                        raise TokenError(result_value.message)
                    order_id = "order-" + uuid.uuid4().hex[:12]
                    order = {"order_id": order_id, "household_id": action["household_id"], "member_id": action["member_id"], "product_id": product["product_id"], "product_revision": product.get("product_revision", ""), "quantity": action.get("quantity", 1), "shipping_option": action.get("shipping_option", "standard"), "amount_cents": action["amount_cents"], "currency": product["currency"], "provider": result_value.provider, "provider_reference": result_value.provider_reference, "status": result_value.status, "message": result_value.message, "action_hash": action_hash(action), "created_at": now_iso(), "updated_at": now_iso()}
                    self.store.payment_orders[order_id] = order
                    action["order_id"] = order_id
                    self.store._persist()
                result = {"executed": True, "message": f"Simulated {action['action']} completed.", "action": action, **({"payment": payment} if payment else {}), **({"order": order} if action.get("product_id") else {})}
                self._track_plan_action(action, "executed", decision["decision"])
                self.store.add_trust_event({"event": "execution", "action_hash": action_hash(action), "timestamp": now_iso(), "approved": bool(approval_id) or decision["decision"] == "allow"})
                receipt = self._record(action, decision["decision"], "executed", None, approval_id, decision.get("token_id"), (payment or {}).get("message", "Mock add-on executed after policy verification."))
                return {**result, "receipt": receipt}
        except Exception as exc:
            token_id = self._token_id(decision_token)
            receipt = self._record(action, "deny", "rejected", None, None, token_id, str(exc))
            return {"executed": False, "error": str(exc), "receipt": receipt}

    def get_receipts(self, limit: int = 100, caller: dict[str, Any] | None = None) -> dict[str, Any]:
        receipts = self.store.get_receipts(max(1, min(limit, 100)))
        if caller is not None and not caller.get("can_access_private"):
            receipts = [item for item in receipts if item.get("action") != "view_private"]
        return {"receipts": receipts, "integrity": [self._receipt_valid(r) for r in receipts]}

    def _receipt_valid(self, receipt: dict[str, Any]) -> bool:
        from .receipts import verify_receipt
        return verify_receipt(receipt)

    def trust_summary(self) -> dict[str, Any]:
        events = self.store.trust_events
        approvals = [e for e in events if e.get("event") == "approval"]
        denials = [r for r in self.store.receipts if r.get("decision") == "deny"]
        return {"synthetic_replay": True, "matching_approvals": len(approvals), "denials": len(denials), "events": copy.deepcopy(events)}

    def autonomy_proposal(self, action: str, beneficiary: str, max_days: int = 30) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=max_days)
        events = [e for e in self.store.trust_events if e.get("event") == "approval" and e.get("action") == action and e.get("beneficiary") == beneficiary]
        denials = [r for r in self.store.receipts if r.get("decision") == "deny" and r.get("action") == action]
        valid = [e for e in events if datetime.fromisoformat(str(e.get("timestamp")).replace("Z", "+00:00")) >= cutoff]
        eligible = len(valid) >= 5 and not denials
        return {"status": "eligible" if eligible else "not_eligible", "activated": False, "requires_adult_confirmation": True, "matching_approvals": len(valid), "denials": len(denials), "action": action, "beneficiary": beneficiary, "reason": "Five matching approvals, zero denials, same beneficiary, and a 30-day window are required."}
