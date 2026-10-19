# PACT security results

## Acceptance result

Observed on 2026-10-18 in the local workspace:

```text
full test suite: 74 passed
compiler phrasings: 20
legitimate_allowed: 1
legitimate_approval_required: 1
legitimate_denied: 1
adversarial_attempts: 240
adversarial_allowed: 0
adversarial_asked: 120
adversarial_denied: 120
unauthorized_executions: 0
replay_failures: 18
parameter_tamper_failures: 40
bypasses: 0
```

Overnight additions passed: SQLite sandbox isolation/reset, concurrent exact
execution claim, approved-plan exposure and cumulative budget denial, synthetic
Policy Preview, and labeled Bedrock-cap fallback. The full real-server Maya
flow also passed with VenueBook `ask` at $120 and GiftCart `deny` at $160
against a $150 plan.

The identity/security additions also passed: five independently issued member
sessions, profile isolation, role enforcement, cross-session and
cross-household token rejection, logout invalidation, approval revocation, and
atomic cumulative-budget execution. See `reports/identity-security.md`.

The bypass fixture intentionally starts with no active rules, so every generated attack is fail-safe. Separate executor tests confirm that a confirmed low-risk allow executes and that an exact adult approval is required for an ask decision.

## Tested defenses

- Unconfirmed, expired, malformed, out-of-scope, and unknown rules do not authorize actions.
- Precedence is deterministic: deny, then ask, then allow; equal-specificity conflicts fail safe to ask.
- Unknown or incomplete normal actions ask; high-risk unlock, camera, and private-view defaults deny.
- Role is taken from the structured simulated session, not from natural-language text.
- Decision tokens bind household, member, session, request ID, canonical action hash, ruleset hash, policy version, expiry, and a one-time nonce.
- Approval tokens bind the exact action hash, request ID, approval ID/version, member/session, required approver, and policy version; execution checks the current approval state.
- The executor revalidates current policy and exact parameters before mock execution.
- Failed verification attempts create rejected demo receipts; successful execution creates executed receipts.
- Receipt hashes chain through the previous receipt hash. `verify_receipt` detects mutation.
- Private-view fields are redacted for the shared surface.
- The local server accepts only loopback clients and a small allowlist of local origins. Observed invalid-origin response: HTTP 403.
- Malformed MCP JSON produced HTTP 400 with JSON-RPC parse error.

These are demo controls, not production-grade identity, storage, or audit guarantees. Production would need durable append-only storage, KMS/asymmetric signing, key rotation, access controls, retention, and real principal verification.

