"""SQLite-backed sandbox state with an in-memory test-compatible default."""

from __future__ import annotations

import copy
import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any

from .canonical import ruleset_hash
from .identity import seeded_demo_members
from .settings import default_settings


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class StateStore:
    def __init__(self, household_id: str = "house-1") -> None:
        self.lock = threading.RLock()
        self.household_id = household_id
        self.policy_version = 1
        self.rules: list[dict[str, Any]] = []
        self.proposals: dict[str, dict[str, Any]] = {}
        self.approvals: dict[str, dict[str, Any]] = {}
        self.receipts: list[dict[str, Any]] = []
        self.used_nonces: set[str] = set()
        self.executed_idempotency: set[str] = set()
        self.plans: dict[str, dict[str, Any]] = {}
        self.plan_actions: dict[str, dict[str, Any]] = {}
        self.conversations: dict[str, dict[str, Any]] = {}
        self.trust_events: list[dict[str, Any]] = []
        self.usage = {"bedrock_calls": 0, "bedrock_tokens": 0, "rate_events": []}
        self.settings = default_settings()  # survives reset(); wiped only by clear_all()
        self.household = {
            "household_id": household_id,
            "members": seeded_demo_members(),
        }
        self.personal_profiles = {member["id"]: copy.deepcopy(member.get("preferences", {})) for member in self.household["members"]}

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return copy.deepcopy({
                "household": self.household,
                "rules": self.rules,
                "proposals": list(self.proposals.values()),
                "approvals": list(self.approvals.values()),
                "receipts": self.receipts,
                "plans": list(self.plans.values()),
                "plan_actions": list(self.plan_actions.values()),
                "conversations": list(self.conversations.values()),
                "trust_events": self.trust_events,
                "usage": self.usage,
                "policy_version": self.policy_version,
                "personal_profiles": self.personal_profiles,
            })

    def _persist(self) -> None:
        """Persistence hook; the fixture store intentionally stays in memory."""

    def current_ruleset_hash(self) -> str:
        with self.lock:
            return ruleset_hash(self.rules)

    def add_rule(self, rule: dict[str, Any]) -> None:
        with self.lock:
            self.rules.append(copy.deepcopy(rule))
            self.policy_version += 1
            self._persist()

    def save_proposal(self, proposal: dict[str, Any]) -> None:
        with self.lock:
            self.proposals[proposal["proposal_hash"]] = copy.deepcopy(proposal)
            self._persist()

    def get_proposal(self, proposal_hash: str) -> dict[str, Any] | None:
        with self.lock:
            item = self.proposals.get(proposal_hash)
            return copy.deepcopy(item) if item else None

    def save_approval(self, approval: dict[str, Any]) -> None:
        with self.lock:
            self.approvals[approval["approval_id"]] = copy.deepcopy(approval)
            self._persist()

    def get_approval(self, approval_id: str) -> dict[str, Any] | None:
        with self.lock:
            item = self.approvals.get(approval_id)
            return copy.deepcopy(item) if item else None

    def consume_nonce(self, nonce: str) -> bool:
        with self.lock:
            if nonce in self.used_nonces:
                return False
            self.used_nonces.add(nonce)
            return True

    def idempotency_seen(self, key: str) -> bool:
        with self.lock:
            return key in self.executed_idempotency

    def mark_idempotency(self, key: str) -> None:
        with self.lock:
            self.executed_idempotency.add(key)
            self._persist()

    def claim_idempotency(self, key: str) -> bool:
        """Atomically claim one exact execution request."""
        with self.lock:
            if key in self.executed_idempotency:
                return False
            self.executed_idempotency.add(key)
            self._persist()
            return True

    def add_receipt(self, receipt: dict[str, Any]) -> None:
        with self.lock:
            self.receipts.append(copy.deepcopy(receipt))
            self._persist()

    def get_receipts(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.lock:
            return copy.deepcopy(self.receipts[-limit:][::-1])

    def save_plan(self, plan: dict[str, Any]) -> None:
        with self.lock:
            self.plans[plan["plan_id"]] = copy.deepcopy(plan)
            self._persist()

    def get_plan(self, plan_id: str) -> dict[str, Any] | None:
        with self.lock:
            return copy.deepcopy(self.plans.get(plan_id))

    def save_plan_action(self, item: dict[str, Any]) -> None:
        with self.lock:
            self.plan_actions[item["action_hash"]] = copy.deepcopy(item)
            self._persist()

    def get_plan_action(self, action_hash_value: str) -> dict[str, Any] | None:
        with self.lock:
            return copy.deepcopy(self.plan_actions.get(action_hash_value))

    def plan_actions_for(self, plan_id: str) -> list[dict[str, Any]]:
        with self.lock:
            return copy.deepcopy([x for x in self.plan_actions.values() if x.get("plan_id") == plan_id])

    def save_conversation(self, conversation: dict[str, Any]) -> None:
        with self.lock:
            self.conversations[conversation["conversation_id"]] = copy.deepcopy(conversation)
            self._persist()

    def get_conversation(self, conversation_id: str) -> dict[str, Any] | None:
        with self.lock:
            return copy.deepcopy(self.conversations.get(conversation_id))

    def add_trust_event(self, event: dict[str, Any]) -> None:
        with self.lock:
            self.trust_events.append(copy.deepcopy(event))
            self._persist()

    def reset(self) -> None:
        with self.lock:
            household_id = self.household_id
            self._init_defaults(household_id)
            self._persist()

    def update_settings(self, settings: dict[str, Any]) -> None:
        with self.lock:
            self.settings = copy.deepcopy(settings)
            self._persist()

    def set_members(self, members: list[dict[str, Any]]) -> None:
        with self.lock:
            self.household["members"] = copy.deepcopy(members)
            self._persist()

    def set_household_members(self, members: list[dict[str, Any]]) -> None:
        """Replace the authorization membership projection used by the service.

        Personal preferences are intentionally not embedded in this projection;
        callers receive only explicitly shared preference fields.
        """
        with self.lock:
            self.household["members"] = copy.deepcopy(members)
            known = {str(member.get("id")) for member in members if member.get("id")}
            self.personal_profiles = {key: value for key, value in self.personal_profiles.items() if key in known}
            for member in members:
                self.personal_profiles.setdefault(str(member.get("id")), {})
            self._persist()

    def get_profile(self, member_id: str) -> dict[str, Any]:
        with self.lock:
            return copy.deepcopy(self.personal_profiles.get(member_id, {}))

    def update_profile(self, member_id: str, profile: dict[str, Any]) -> None:
        with self.lock:
            self.personal_profiles[member_id] = copy.deepcopy(profile)
            self._persist()

    def clear_all(self) -> None:
        """Clear local data: household state AND settings/account."""
        with self.lock:
            self._init_defaults(self.household_id)
            self.settings = default_settings()
            self._persist()

    def _init_defaults(self, household_id: str) -> None:
        self.household_id = household_id
        self.policy_version = 1
        self.rules = []
        self.proposals = {}
        self.approvals = {}
        self.receipts = []
        self.used_nonces = set()
        self.executed_idempotency = set()
        self.plans = {}
        self.plan_actions = {}
        self.conversations = {}
        self.trust_events = []
        self.usage = {"bedrock_calls": 0, "bedrock_tokens": 0, "rate_events": []}
        self.household = {
            "household_id": household_id,
            "members": seeded_demo_members(),
        }
        self.personal_profiles = {member["id"]: copy.deepcopy(member.get("preferences", {})) for member in self.household["members"]}


class SQLiteStateStore(StateStore):
    """One JSON document per cryptographically random demo sandbox.

    SQLite is deliberately local and small for the hackathon. The state shape
    remains the same as the fixture store, so policy and token code have one
    shared surface and the demo survives process restarts.
    """

    def __init__(self, db_path: str | None = None, sandbox_id: str = "default", household_id: str | None = None) -> None:
        self.db_path = db_path or os.getenv("PACT_SQLITE_PATH", "pact-data.sqlite3")
        self.sandbox_id = sandbox_id
        self._db_lock = threading.RLock()
        with sqlite3.connect(self.db_path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS pact_sandboxes (sandbox_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)")
        super().__init__(household_id or f"house-{sandbox_id[:10]}")
        self._load_or_persist()

    def _serialize(self) -> dict[str, Any]:
        return {
            "household_id": self.household_id,
            "policy_version": self.policy_version,
            "rules": self.rules,
            "proposals": self.proposals,
            "approvals": self.approvals,
            "receipts": self.receipts,
            "used_nonces": sorted(self.used_nonces),
            "executed_idempotency": sorted(self.executed_idempotency),
            "household": self.household,
            "plans": self.plans,
            "plan_actions": self.plan_actions,
            "conversations": self.conversations,
            "trust_events": self.trust_events,
            "usage": self.usage,
            "settings": self.settings,
            "personal_profiles": self.personal_profiles,
        }

    def _load_or_persist(self) -> None:
        with self._db_lock, sqlite3.connect(self.db_path) as db:
            row = db.execute("SELECT state_json FROM pact_sandboxes WHERE sandbox_id = ?", (self.sandbox_id,)).fetchone()
            if not row:
                self._persist()
                return
            value = json.loads(row[0])
            self.household_id = value.get("household_id", self.household_id)
            self.policy_version = int(value.get("policy_version", 1))
            self.rules = value.get("rules", [])
            self.proposals = value.get("proposals", {})
            self.approvals = value.get("approvals", {})
            self.receipts = value.get("receipts", [])
            self.used_nonces = set(value.get("used_nonces", []))
            self.executed_idempotency = set(value.get("executed_idempotency", []))
            self.household = value.get("household", self.household)
            # Migrate older local demo sandboxes that only seeded three members.
            seeded = {item["id"]: item for item in seeded_demo_members()}
            existing = {item.get("id"): item for item in self.household.get("members", []) if item.get("id")}
            for member_id, member in seeded.items():
                existing.setdefault(member_id, member)
            self.household["members"] = list(existing.values())
            seeded_profiles = {member_id: copy.deepcopy(member.get("preferences", {})) for member_id, member in seeded.items()}
            self.personal_profiles = {**seeded_profiles, **value.get("personal_profiles", {})}
            self.plans = value.get("plans", {})
            self.plan_actions = value.get("plan_actions", {})
            self.conversations = value.get("conversations", {})
            self.trust_events = value.get("trust_events", [])
            self.usage = value.get("usage", {"bedrock_calls": 0, "bedrock_tokens": 0, "rate_events": []})
            self.settings = {**default_settings(), **value.get("settings", {})}

    def _persist(self) -> None:
        payload = json.dumps(self._serialize(), sort_keys=True, separators=(",", ":"))
        with self._db_lock, sqlite3.connect(self.db_path) as db:
            db.execute("INSERT INTO pact_sandboxes(sandbox_id,state_json,updated_at) VALUES(?,?,?) ON CONFLICT(sandbox_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at", (self.sandbox_id, payload, now_iso()))

    def consume_nonce(self, nonce: str) -> bool:
        with self.lock:
            if nonce in self.used_nonces:
                return False
            self.used_nonces.add(nonce)
            self._persist()
            return True

    def reset(self) -> None:
        with self.lock:
            self._init_defaults(self.household_id)
            self._persist()


class DynamoDBPersistenceAdapter:
    """Optional adapter seam. Local StateStore remains the default for demo reliability."""

    def __init__(self, table_name: str | None = None, region: str | None = None) -> None:
        self.table_name = table_name or os.getenv("PACT_DYNAMODB_TABLE")
        self.region = region or os.getenv("PACT_AWS_REGION")
        self.enabled = bool(self.table_name)
        self._table = None

    def connect(self) -> bool:
        if not self.enabled:
            return False
        try:
            import boto3
            self._table = boto3.resource("dynamodb", region_name=self.region).Table(self.table_name)
            return True
        except Exception:
            self._table = None
            return False

    def put(self, item: dict[str, Any]) -> bool:
        if self._table is None and not self.connect():
            return False
        try:
            self._table.put_item(Item=item)
            return True
        except Exception:
            return False

